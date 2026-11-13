import { createHash } from 'node:crypto'
import type { FactClaimCategory, FactProvenanceItem } from '@/features/content/approved-fact-basis'
import type { ApprovedFactSnapshot } from '@/features/knowledge/approved-fact-resolver'
import { checkBusinessClaims } from '../claim-guard'
import type { GroundedBusinessContext } from '../types'

const normalize = (text: string) => text.normalize('NFKC').replace(/[\s\p{Cf}\p{Cc},]/gu, '').toLowerCase()
function containsClaim(evidence: string, claim: string): boolean {
  const escaped = claim.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?<![\\d.])${escaped}(?!\\d|\\.\\d)`, 'u').test(normalize(evidence))
}

const additionalClaims = [
  { pattern: /(?:평점|별점)\d+(?:\.\d+)?(?:점)?|\d+(?:\.\d+)?점(?:평점|만점)|(?:방문자)?리뷰\d+(?:개|건)/gu, category: 'RATING', reason: '평점·리뷰 수의 확인된 출처가 필요해요.' },
  { pattern: /\d+년(?:이상|간|의)?(?:경력|경험)|경력\d+년/gu, category: 'EXPERIENCE', reason: '경력을 확인한 자료가 필요해요.' },
  { pattern: /(?:제가|저는|내가).*(?:방문|받아봤|다녀왔|이용했|이용해봤)|직접(?:방문했|방문해서|받아봤|다녀왔|다녀온)/gu, category: 'VISIT', reason: '실제 방문 근거 없이 체험 후기를 작성할 수 없어요.' },
  // 방문 없이 쓴 체험담: "제가"가 생략된 1인칭 경험 표현도 같은 방문 근거를 요구한다.
  { pattern: /(?:먹어봤|써봤|써보니|받아봤|받아보니|가봤|이용해보니|사용해보니|체험해보니|경험해보니|방문해보니|시술받고(?:왔|와)|다녀온(?:소감|후기))[^\s]*/gu, category: 'VISIT', reason: '실제 방문 근거 없이 체험 후기를 작성할 수 없어요.' },
  { pattern: /(?:실제)?(?:고객|손님|단골|회원)(?:님)?(?:들)?(?:의)?후기|(?:고객|손님|단골|회원)(?:님)?(?:들)?(?:은|이|께서)?(?:모두)?(?:만족|극찬)[^\s]*/gu, category: 'CUSTOMER_REVIEW', reason: '승인되지 않은 고객 후기·만족 사례는 사실처럼 쓸 수 없어요.' },
  { pattern: /시술전후|전후사진|비포애프터|before.?after|변화사진/gu, category: 'PROCEDURE_PHOTO', reason: '시술 전후 사진은 사진 사용 승인과 실제 시술 근거가 필요해요.' },
  { pattern: /(?:상위\s*노출|상위노출|스마트블록\s*1위|검색\s*1위|노출\s*1위).*(?:보장|확정|약속|장담)/gu, category: 'RANKING_GUARANTEE', reason: '검색 노출 순위나 상위 노출을 단정·보장하는 표현은 사용할 수 없어요.' },
] as const

export function checkApprovedNaverDraft(workspaceId: string, payload: Record<string, unknown>, snapshot: ApprovedFactSnapshot) {
  if (snapshot.workspaceId !== workspaceId || snapshot.facts.some(fact => fact.workspace_id !== workspaceId)) {
    throw new Error('FACT_WORKSPACE_MISMATCH')
  }
  const context: GroundedBusinessContext = {
    businessName: '', industry: '', location: '', tone: { presetKey: null, brandVoice: '' },
    knowledgeVersion: 1, warnings: [],
    // 허위 시술효과·치료 보장(PROCEDURE_EFFECT)은 승인 사실로 저장되어 있어도 사실 게이트에서 배제한다.
    facts: snapshot.facts.filter(fact => {
      const cat = fact.category.toUpperCase()
      return cat !== 'PROHIBITED' && cat !== 'PROCEDURE_EFFECT'
    }).map(fact => ({
      kind: fact.category.toUpperCase() === 'PRICE' || fact.category.toUpperCase() === 'MENU' ? 'offering' : 'policy',
      label: ({ PRICE: '가격', MENU: '메뉴', HOURS: '영업시간' } as Record<string, string>)[fact.category.toUpperCase()] ?? fact.category,
      value: fact.content,
    })),
  }
  const issues: { path: string; text: string; reason: string; remedy: string }[] = []
  const seen = new Set<object>()
  function visit(value: unknown, path: string, depth: number): void {
    if (typeof value === 'string') {
      const reasons = checkBusinessClaims('naver_blog', { text: value }, context).issues
      const text = normalize(value)
      // 소유자 승인이나 모델의 자기평가도 가상의 AI 추천 근거로 승격하지 않는다.
      if (/(?:ai|인공지능|챗gpt|chatgpt|제미나이|gemini|클로드|claude)(?:가|이|에서)?(?:직접)?(?:추천|선정|인정|보증)/u.test(text)) {
        reasons.push('AI가 추천·보증한 서비스로 표현할 수 없어요. 확인 가능한 사실로 바꿔 주세요.')
      }
      for (const rule of additionalClaims) {
        const matches = [...text.matchAll(rule.pattern)]
        if (matches.some(([claim]) => !snapshot.facts.some(fact =>
          fact.category.toUpperCase() === rule.category && containsClaim(fact.content, claim),
        ))) reasons.push(rule.reason)
      }
      for (const prohibitedFact of snapshot.facts) {
        if (prohibitedFact.category.toUpperCase() === 'PROHIBITED') {
          const prohibitedTokens = prohibitedFact.content.normalize('NFKC')
            .split(/(?:주의사항|주의|금지|불가|제한|알레르기|[:,\r\n])/u)
            .map(normalize)
            .filter(t => t.length >= 2)
          for (const token of prohibitedTokens) {
            if (text.includes(token)) {
              reasons.push(`승인된 주의사항·금지 표현("${token}")이 포함되어 있어요.`)
              break
            }
          }
        }
      }
      for (const reason of reasons) issues.push({ path, text: value, reason, remedy: '나의 지식에서 출처와 유효기간을 확인하고 승인하거나 해당 문장을 삭제해 주세요.' })
      return
    }
    if (!value || typeof value !== 'object') return
    if (depth > 8 || seen.has(value) || Object.keys(value).length > 200) {
      issues.push({ path, text: '', reason: '원고 전체를 검사할 수 없어요.', remedy: '원고 구조를 확인한 뒤 다시 작성해 주세요.' })
      return
    }
    seen.add(value)
    for (const [key, part] of Object.entries(value)) visit(part, `${path}.${key}`, depth + 1)
    seen.delete(value)
  }
  visit(payload, '$', 0)
  return {
    status: issues.length ? 'OWNER_CONFIRM_REQUIRED' as const : 'OK' as const,
    snapshotHash: snapshot.hash,
    resolvedAt: snapshot.resolvedAt,
    // 검사에 사용 가능한 승인 사실 목록이며 문장별 외부 검증 성공을 뜻하지 않는다.
    sources: snapshot.facts.map(fact => ({ factId: fact.id, sourceCandidateId: fact.source_candidate_id!, approvedAt: fact.approved_at! })),
    // 승인 사실의 원문을 보존한다. 후보 원본 문서나 문장별 외부 검증의 증거는 아니다.
    provenance: snapshot.facts.map((fact): FactProvenanceItem => ({
      factId: fact.id,
      sourceType: 'owner_approved_fact',
      capturedAt: snapshot.resolvedAt,
      sourceSpan: fact.content,
      sourceHash: createHash('sha256').update(fact.content, 'utf8').digest('hex'),
      // resolver가 해당 관측 시점에 유효한 판본만 제공한다.
      validity: 'active',
      ownerApproval: { approvedByUserId: fact.approved_by_user_id, approvedAt: fact.approved_at },
      claimCategory: ({ PRICE: 'pricing', MENU: 'business_info', HOURS: 'business_info', SERVICE: 'business_info',
        EXPERIENCE: 'business_info', RATING: 'business_info', PROCEDURE_EFFECT: 'procedure_effect',
        CUSTOMER_REVIEW: 'customer_review', EXPERIENCE_TESTIMONY: 'experience_testimony',
      } as Record<string, FactClaimCategory>)[fact.category.toUpperCase()] ?? 'other',
    })),
    issues,
  }
}
