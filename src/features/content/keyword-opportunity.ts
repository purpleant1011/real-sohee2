import { z } from 'zod'

/**
 * 블로그 키워드 후보 점수 엔진 (ANI-1914).
 *
 * 약관 경계(docs/architecture/dotoli-clean-room-and-collection-terms.md): 네이버 검색·데이터랩·광고 API 결과는
 * 저장·AI 입력·점수 산출에 쓸 수 없다. 따라서 입력은 소희가 직접 가진 1st-party 신호로 한정하고,
 * 알 수 없는 필드(외부 지표 포함)는 스키마에서 거절한다. 경쟁도·검색량·노출확률 같은 수치는 만들지 않는다.
 */
export const KEYWORD_SCORE_POLICY = Object.freeze({
  version: 'keyword-score-v1',
  // BusinessDNA(사업 정체성) / 주제 경계 / 확인된 고유 정보 / 수요(실제 질문) / 기존 글 보완성
  weights: Object.freeze({ businessFit: 25, topicBoundary: 25, uniqueInfo: 20, demand: 15, complement: 15 }),
  demandBySource: Object.freeze({
    verified_owner: 1, consented_inquiry: 1, public_observed: 0.7, keyword_inferred: 0.3, synthetic_test: 0.1,
  } as const),
})

const text = (max: number) => z.string().trim().min(1).max(max)
const uuid = z.string().uuid()
const datetime = z.string().datetime({ offset: true })

const inputSchema = z.object({
  workspaceId: uuid,
  datasetMode: z.enum(['ACTUAL', 'SHOWCASE_DEMO', 'TEST']),
  businessTerms: z.array(text(100)).max(30),
  offeredServices: z.array(text(100)).max(50),
  unavailableServices: z.array(text(100)).max(50).default([]),
  excludedClaims: z.array(text(100)).max(30).default([]),
  approvedFacts: z.array(z.object({ id: uuid, text: text(1_000), observedAt: datetime }).strict()).max(100).default([]),
  questions: z.array(z.object({
    id: uuid,
    text: text(500),
    source: z.enum(['verified_owner', 'consented_inquiry', 'public_observed', 'keyword_inferred', 'synthetic_test']),
    observedAt: datetime.nullable(),
    evidenceRef: text(500),
  }).strict()).max(200).default([]),
  existingPosts: z.array(z.object({ title: text(300), keywords: z.array(text(100)).max(30) }).strict()).max(500).optional(),
  candidates: z.array(z.object({
    keyword: text(100),
    origin: z.enum(['owner_input', 'approved_question', 'approved_fact_term', 'existing_post']),
  }).strict()).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  if (value.datasetMode === 'ACTUAL' && value.questions.some((question) => question.source === 'synthetic_test')) {
    ctx.addIssue({ code: 'custom', path: ['questions'], message: '실제 사업장 점수에는 합성 질문을 사용할 수 없습니다.' })
  }
})

export type KeywordRankingInput = z.input<typeof inputSchema>
export type KeywordComponent = Readonly<{ points: number; weight: number; measured: boolean }>
export type KeywordOpportunity = Readonly<{
  keyword: string
  origin: string
  score: number
  /** 측정된 항목의 가중치 합(0~100). 낮으면 점수의 근거가 얇다는 뜻이다. */
  coverage: number
  components: Readonly<Record<keyof typeof KEYWORD_SCORE_POLICY.weights, KeywordComponent>>
  unmeasured: readonly (keyof typeof KEYWORD_SCORE_POLICY.weights)[]
  evidence: Readonly<{
    facts: readonly Readonly<{ id: string; observedAt: string }>[]
    questions: readonly Readonly<{ id: string; source: string; observedAt: string | null; evidenceRef: string }>[]
  }>
}>
export type ExcludedKeyword = Readonly<{ keyword: string; reason: 'EXCLUDED_CLAIM' | 'UNAVAILABLE_SERVICE' }>
export type KeywordRanking = Readonly<{
  policyVersion: string
  ranked: readonly KeywordOpportunity[]
  excluded: readonly ExcludedKeyword[]
}>

const squash = (value: string) => value.replace(/\s+/gu, '').toLowerCase()
const tokens = (value: string) => value.split(/\s+/u).map((token) => token.trim().toLowerCase()).filter((token) => token.length >= 2)
const round = (value: number) => Math.round(value * 100) / 100

function vocabulary(terms: readonly string[]) {
  return terms.flatMap((term) => tokens(term))
}

/** 키워드 토큰 중 어휘에 포함되는(서로 부분 문자열) 비율. */
function coverage(keywordTokens: readonly string[], vocab: readonly string[]) {
  if (keywordTokens.length === 0) return 0
  const covered = keywordTokens.filter((token) => vocab.some((word) => word.includes(token) || token.includes(word)))
  return covered.length / keywordTokens.length
}

function overlap(keywordTokens: readonly string[], haystack: string) {
  if (keywordTokens.length === 0) return 0
  const lowered = haystack.toLowerCase()
  return keywordTokens.filter((token) => lowered.includes(token)).length / keywordTokens.length
}

export function rankKeywordOpportunities(rawInput: unknown): KeywordRanking {
  const input = inputSchema.parse(rawInput)
  const { weights, demandBySource } = KEYWORD_SCORE_POLICY
  const identityVocab = vocabulary([...input.businessTerms, ...input.offeredServices])
  const serviceVocab = vocabulary(input.offeredServices)

  const seen = new Set<string>()
  const ranked: KeywordOpportunity[] = []
  const excluded: ExcludedKeyword[] = []

  for (const candidate of input.candidates) {
    const key = squash(candidate.keyword)
    if (seen.has(key)) continue
    seen.add(key)

    // 하드 배제가 점수보다 먼저다. 사장님이 제외한 표현, 제공하지 않는 서비스는 후보가 될 수 없다.
    if (input.excludedClaims.some((claim) => key.includes(squash(claim)))) {
      excluded.push({ keyword: candidate.keyword, reason: 'EXCLUDED_CLAIM' })
      continue
    }
    if (input.unavailableServices.some((service) => key.includes(squash(service)))) {
      excluded.push({ keyword: candidate.keyword, reason: 'UNAVAILABLE_SERVICE' })
      continue
    }

    const keywordTokens = tokens(candidate.keyword)
    const matchedFacts = input.approvedFacts.filter((fact) => overlap(keywordTokens, fact.text) >= 0.5)
    const matchedQuestions = input.questions.filter((question) => overlap(keywordTokens, question.text) >= 0.5)

    const businessFit = coverage(keywordTokens, identityVocab)
    const topicBoundary = coverage(keywordTokens, serviceVocab)
    const uniqueInfo = Math.min(matchedFacts.length, 3) / 3
    const demandMeasured = input.questions.length > 0
    const demand = matchedQuestions.reduce((best, question) => Math.max(best, demandBySource[question.source]), 0)
    const complementMeasured = input.existingPosts !== undefined
    const complement = (() => {
      if (!input.existingPosts) return 0
      const covered = input.existingPosts.some((post) =>
        post.keywords.some((existing) => squash(existing) === key) || squash(post.title).includes(key))
      if (covered) return 0
      const partial = input.existingPosts.some((post) => post.keywords.some((existing) => overlap(keywordTokens, existing) >= 0.5))
      return partial ? 0.5 : 1
    })()

    const component = (value: number, weight: number, measured = true): KeywordComponent =>
      Object.freeze({ points: measured ? round(value * weight) : 0, weight, measured })
    const components = Object.freeze({
      businessFit: component(businessFit, weights.businessFit),
      topicBoundary: component(topicBoundary, weights.topicBoundary),
      uniqueInfo: component(uniqueInfo, weights.uniqueInfo),
      demand: component(demand, weights.demand, demandMeasured),
      complement: component(complement, weights.complement, complementMeasured),
    })
    const entries = Object.entries(components) as [keyof typeof components, KeywordComponent][]
    ranked.push(Object.freeze({
      keyword: candidate.keyword,
      origin: candidate.origin,
      score: round(entries.reduce((sum, [, item]) => sum + item.points, 0)),
      coverage: entries.reduce((sum, [, item]) => sum + (item.measured ? item.weight : 0), 0),
      components,
      unmeasured: Object.freeze(entries.filter(([, item]) => !item.measured).map(([name]) => name)),
      evidence: Object.freeze({
        facts: Object.freeze(matchedFacts.map((fact) => Object.freeze({ id: fact.id, observedAt: fact.observedAt }))),
        questions: Object.freeze(matchedQuestions.map((question) => Object.freeze({
          id: question.id, source: question.source, observedAt: question.observedAt, evidenceRef: question.evidenceRef,
        }))),
      }),
    }))
  }

  ranked.sort((left, right) => right.score - left.score || left.keyword.localeCompare(right.keyword, 'ko'))
  return Object.freeze({ policyVersion: KEYWORD_SCORE_POLICY.version, ranked: Object.freeze(ranked), excluded: Object.freeze(excluded) })
}
