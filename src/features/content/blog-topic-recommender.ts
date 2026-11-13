// 승인된 가게 사실에서 블로그 주제 후보를 고르는 순수 모듈이다.
// 검색 지표는 표시 전용이다. 순위·점수에 반영하지 않는다(docs/architecture/dotoli-clean-room-and-collection-terms.md §3·§5).
// 관측이 없으면 NOT_OBSERVED로 두고 값을 만들지 않는다. 외부 도구의 코드는 가져오지 않았다.
// scoring 이 있으면 1st-party 점수 엔진(keyword-opportunity)으로 순위를 매긴다. 외부 검색 지표는 여기에도 들어가지 않는다.
import { rankKeywordOpportunities, type KeywordOpportunity, type KeywordRankingInput } from './keyword-opportunity'

export type TopicFact = { id: string; category: string; content: string; observedAt?: string }
export type TopicScoringContext = Pick<KeywordRankingInput, 'workspaceId' | 'datasetMode' | 'unavailableServices' | 'excludedClaims' | 'questions' | 'existingPosts'>
export type TopicKeywordScore = Readonly<Pick<KeywordOpportunity, 'score' | 'coverage' | 'unmeasured'> & { policyVersion: string }>
export type KeywordObservation = { keyword: string; monthlySearches: number | null; competition: number | null }
export type BlogDna = { tone: string; avoid: readonly string[] }
export type KeywordSignal =
  | { status: 'NOT_OBSERVED'; keyword: null }
  | { status: 'OBSERVED'; keyword: string; monthlySearches: number | null; competition: number | null }
export type RecommendedTopic = {
  title: string
  angle: AngleKey
  primaryKeyword: string
  evidence: string[]
  factIds: string[]
  keywordSignal: KeywordSignal
  rank: number
  voice: BlogDna | null
  keywordScore?: TopicKeywordScore
}
type AngleKey = 'service' | 'price' | 'policy' | 'location' | 'faq'

const ANGLES: Record<AngleKey, { title: string; intent: string; match: RegExp }> = {
  service: { title: '이용 전에 알아두면 좋은 서비스 안내', intent: '안내', match: /service|서비스|메뉴|시술|상품/i },
  price: { title: '이용 비용 안내와 확인할 점', intent: '가격', match: /price|가격|비용|요금/i },
  policy: { title: '예약·변경 규정 한눈에 보기', intent: '예약', match: /policy|규정|예약|환불|정책/i },
  location: { title: '찾아오시는 길과 이용 시간 안내', intent: '위치', match: /location|위치|주소|시간|영업/i },
  faq: { title: '자주 문의하시는 내용 정리', intent: '문의', match: /^$/ },
}
const FALLBACK_ORDER: AngleKey[] = ['service', 'faq', 'policy', 'price', 'location']
const JOSA = /(은|는|이|가|을|를|의|에|도|로|과|와|입니다|합니다)$/
const STOP = new Set(['약', '매장', '가능', '있습니다', '됩니다', '입니다'])

function angleOf(category: string): AngleKey {
  return (Object.keys(ANGLES) as AngleKey[]).find(key => ANGLES[key].match.test(category)) ?? 'faq'
}

function subjectOf(facts: readonly TopicFact[]): string {
  const counts = new Map<string, number>()
  for (const fact of facts) for (const raw of fact.content.match(/[가-힣]{2,}/g) ?? []) {
    const token = raw.replace(JOSA, '')
    if (token.length >= 2 && !STOP.has(token)) counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ''
}

export function recommendBlogTopics(input: {
  facts: readonly TopicFact[]; keywordObservations?: readonly KeywordObservation[]; blogDna?: BlogDna; scoring?: TopicScoringContext
}): RecommendedTopic[] {
  const facts = [...input.facts].sort((a, b) => a.id.localeCompare(b.id))
  if (!facts.length) return []
  const subject = subjectOf(facts)
  const groups = new Map<AngleKey, TopicFact[]>()
  for (const fact of facts) groups.set(angleOf(fact.category), [...(groups.get(angleOf(fact.category)) ?? []), fact])
  const used = new Set(groups.keys())
  // 사실 묶음이 3개 미만이면 남은 각도로 채운다. 근거는 같은 사실을 다시 쓰되 제목·키워드는 달라진다.
  for (const key of FALLBACK_ORDER) if (groups.size < 3 && !groups.has(key)) groups.set(key, facts.slice(0, 3))
  const observed = new Map((input.keywordObservations ?? []).map(o => [o.keyword, o]))
  const scoreByKeyword = new Map<string, TopicKeywordScore>()
  const excludedKeywords = new Set<string>()
  if (input.scoring) {
    const keywords = [...groups.keys()].map(angle => [subject, ANGLES[angle].intent].filter(Boolean).join(' '))
    const ranking = rankKeywordOpportunities({
      ...input.scoring,
      businessTerms: subject ? [subject] : [],
      offeredServices: facts.filter(fact => angleOf(fact.category) === 'service').map(fact => fact.content.slice(0, 100)),
      approvedFacts: facts.filter(fact => fact.observedAt).map(fact => ({ id: fact.id, text: fact.content, observedAt: fact.observedAt! })),
      candidates: keywords.map(keyword => ({ keyword, origin: 'approved_fact_term' as const })),
    })
    for (const item of ranking.ranked) {
      scoreByKeyword.set(item.keyword, { score: item.score, coverage: item.coverage, unmeasured: item.unmeasured, policyVersion: ranking.policyVersion })
    }
    for (const item of ranking.excluded) excludedKeywords.add(item.keyword)
  }
  const candidates = [...groups].filter(([angle]) => !excludedKeywords.has([subject, ANGLES[angle].intent].filter(Boolean).join(' '))).map(([angle, group], index) => {
    const primaryKeyword = [subject, ANGLES[angle].intent].filter(Boolean).join(' ')
    const seen = observed.get(primaryKeyword)
    const base = 0.3 * Math.min(1, (used.has(angle) ? group.length : 0) / 3)
    const keywordSignal: KeywordSignal = seen
      ? { status: 'OBSERVED', keyword: primaryKeyword, monthlySearches: seen.monthlySearches, competition: seen.competition }
      : { status: 'NOT_OBSERVED', keyword: null }
    const picked = group.slice(0, 3)
    const keywordScore = scoreByKeyword.get(primaryKeyword)
    return { index, topic: {
      title: ANGLES[angle].title, angle, primaryKeyword, evidence: picked.map(f => f.content), factIds: picked.map(f => f.id),
      keywordSignal, rank: keywordScore ? Math.round(keywordScore.score * 10) / 1000 : Math.round(base * 1000) / 1000, voice: input.blogDna ?? null,
      ...(keywordScore ? { keywordScore } : {}),
    } satisfies RecommendedTopic }
  })
  return candidates.sort((a, b) => b.topic.rank - a.topic.rank || a.index - b.index).slice(0, 3).map(c => c.topic)
}
