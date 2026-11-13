import { z } from 'zod'

const text = (max: number) => z.string().trim().min(1).max(max)
const uuid = z.string().uuid()
const datasetMode = z.enum(['ACTUAL', 'SHOWCASE_DEMO', 'TEST'])
const lineageSchema = z.object({ conversationId: uuid, missionId: uuid, runId: uuid }).strict().readonly()
const goalSchema = z.object({
  id: uuid,
  outcome: z.enum(['valid_inquiry', 'confirmed_booking', 'verified_sale']),
  description: text(500),
}).strict().readonly()
const questionSchema = z.object({
  id: uuid,
  text: text(500),
  source: z.enum(['verified_owner', 'consented_inquiry', 'public_observed', 'keyword_inferred', 'synthetic_test']),
  observedAt: z.string().datetime({ offset: true }).nullable(),
  evidenceRef: text(500),
  consentScope: z.literal('approved_content'),
  piiRedacted: z.literal(true),
  ownerApproved: z.literal(true),
}).strict().superRefine((question, ctx) => {
  if (question.source !== 'keyword_inferred' && question.source !== 'synthetic_test' && !question.observedAt) {
    ctx.addIssue({ code: 'custom', path: ['observedAt'], message: '관측한 질문은 관측 시각이 필요합니다.' })
  }
}).readonly()
const evidenceSchema = z.object({
  id: uuid,
  summary: text(1_000),
  source: z.enum(['verified_owner', 'public_observed', 'synthetic_test']),
  sourceRef: text(500),
  observedAt: z.string().datetime({ offset: true }),
}).strict().readonly()

function rejectDuplicateIds(rows: readonly { id: string }[], ctx: z.RefinementCtx) {
  const seen = new Set<string>()
  rows.forEach((row, index) => {
    if (seen.has(row.id)) {
      ctx.addIssue({ code: 'custom', path: [index, 'id'], message: '같은 출처 ID를 중복해서 사용할 수 없습니다.' })
    }
    seen.add(row.id)
  })
}

const sharedShape = {
  workspaceId: uuid,
  datasetMode,
  lineage: lineageSchema,
  businessGoal: goalSchema,
  opportunity: z.object({ id: uuid, description: text(500) }).strict().readonly(),
  targetAudience: text(500),
  questions: z.array(questionSchema).max(20).superRefine(rejectDuplicateIds).readonly(),
  evidence: z.array(evidenceSchema).min(1).max(30).superRefine(rejectDuplicateIds).readonly(),
  nextAction: z.object({ kind: z.enum(['inquire', 'book', 'buy']), instruction: text(500) }).strict().readonly(),
  // 대화에서 사장님이 원고에 쓰지 말라고 한 표현·주장. 없으면 제한 없음.
  excludedClaims: z.array(text(100)).max(30).readonly().optional(),
  // 사장님이 고른 주제의 핵심 키워드. searchStatus가 NOT_OBSERVED면 검색 수요를 측정하지 않은 것이고,
  // internalScore는 소희 내부 1st-party 점수일 뿐 검색 노출·순위 예측이 아니다.
  focusKeyword: z.object({
    keyword: text(100), searchStatus: z.enum(['OBSERVED', 'NOT_OBSERVED']), internalScore: z.number().min(0).max(100).optional(),
  }).strict().readonly().optional(),
}

function rejectSyntheticActual(
  brief: { datasetMode: string; questions: readonly { source: string }[]; evidence: readonly { source: string }[] },
  ctx: z.RefinementCtx,
) {
  if (brief.datasetMode !== 'ACTUAL') return
  for (const field of ['questions', 'evidence'] as const) {
    if (brief[field].some((row) => row.source === 'synthetic_test')) {
      ctx.addIssue({ code: 'custom', path: [field], message: '실제 사업장 원고에는 합성 자료를 사용할 수 없습니다.' })
    }
  }
}

export const marketingStrategyBriefSchema = z.object({
  schemaVersion: z.literal(1), id: uuid, revision: z.number().int().positive(), ...sharedShape,
}).strict().superRefine(rejectSyntheticActual).readonly()

export const blogStrategyBriefSchema = z.object({
  schemaVersion: z.literal(1), channel: z.literal('naver_blog'),
  sourceBrief: z.object({ id: uuid, revision: z.number().int().positive() }).strict().readonly(),
  ...sharedShape,
}).strict().superRefine(rejectSyntheticActual).readonly()

export type MarketingStrategyBrief = z.infer<typeof marketingStrategyBriefSchema>
export type BlogStrategyBrief = z.infer<typeof blogStrategyBriefSchema>
export type BlogStrategyScope = Readonly<{
  workspaceId: string
  datasetMode: MarketingStrategyBrief['datasetMode']
  lineage: MarketingStrategyBrief['lineage']
}>

// 인증된 서버 caller의 기존 임무 참조를 보존한다. DB 소유권 조회나 새 임무 생성은 하지 않는다.
export function buildBlogStrategyBrief(input: unknown, scope: BlogStrategyScope): BlogStrategyBrief {
  const brief = marketingStrategyBriefSchema.parse(input)
  if (brief.workspaceId !== scope.workspaceId || brief.datasetMode !== scope.datasetMode
    || (['conversationId', 'missionId', 'runId'] as const).some((key) => brief.lineage[key] !== scope.lineage[key])) {
    throw new Error('BLOG_STRATEGY_SCOPE_MISMATCH')
  }
  const { id, revision, ...content } = brief
  return blogStrategyBriefSchema.parse({
    ...content, channel: 'naver_blog', sourceBrief: { id, revision },
  })
}

const squash = (value: string) => value.replace(/\s+/gu, '').toLowerCase()

/** 핵심 키워드를 태그 맨 앞에 두고 같은 표현(공백·대소문자 무시)은 한 번만 남긴다. 상한을 넘으면 뒤쪽 태그부터 뺀다. */
export function ensureFocusKeyword(keywords: readonly string[], focusKeyword: string | undefined, max = 30): readonly string[] {
  if (!focusKeyword) return keywords
  const key = squash(focusKeyword)
  return [focusKeyword, ...keywords.filter((keyword) => squash(keyword) !== key)].slice(0, max)
}

function collectStrings(value: unknown, out: string[]) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out))
}

/** 원고 전체 문자열(공백·대소문자 무시)에서 사장님이 제외한 표현이 발견된 항목. */
export function findExcludedClaimViolations(payload: unknown, excludedClaims: readonly string[] | undefined): string[] {
  if (!excludedClaims?.length) return []
  const strings: string[] = []
  collectStrings(payload, strings)
  const haystack = strings.map(squash).join('\n')
  return excludedClaims.filter((claim) => haystack.includes(squash(claim)))
}

const EXCLUDE_MARKER = /(?:내용|표현|문구|언급)?\s*(?:은|는|을|를)?\s*(?:제외|빼\s*(?:줘|주세요|고|세요)?|금지|(?:쓰|넣|언급하)지\s*(?:마|말)\S*)\s*$/u

/** "할인 내용 제외"처럼 사장님이 적은 조건 문장에서 원고에 쓰면 안 되는 표현을 뽑는다. 제외 의사가 없으면 빈 목록. */
export function extractExcludedClaims(constraints: string): string[] {
  const claims: string[] = []
  for (const sentence of constraints.split(/[.。\n]/u)) {
    const parts = sentence.split(/[,，、]|\s및\s|(?<=\S)(?:와|과)\s/u).map((part) => part.trim()).filter(Boolean)
    const last = parts.at(-1)
    if (!last || !EXCLUDE_MARKER.test(last)) continue
    for (const part of parts) {
      const term = part.replace(EXCLUDE_MARKER, '').replace(/\s*(?:내용|표현|문구|언급)?\s*(?:은|는|을|를)$/u, '').trim()
      if (term && term.length <= 100 && !claims.includes(term)) claims.push(term)
    }
  }
  return claims.slice(0, 30)
}
