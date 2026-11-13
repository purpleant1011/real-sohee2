import { describe, expect, it } from 'vitest'
import { buildBlogStrategyBrief, blogStrategyBriefSchema, findExcludedClaimViolations, extractExcludedClaims, ensureFocusKeyword } from './blog-strategy-brief'

import { marketingStrategyFixture as marketing } from './blog-strategy-brief.fixture'

const scope = { workspaceId: marketing.workspaceId, datasetMode: marketing.datasetMode, lineage: marketing.lineage }

describe('MarketingStrategyBrief → BlogStrategyBrief', () => {
  it('preserves the exact goal, opportunity, evidence and existing mission/run without manufacturing outcomes', () => {
    const result = buildBlogStrategyBrief(marketing, scope)
    expect(result).toEqual({
      schemaVersion: 1, channel: 'naver_blog', workspaceId: marketing.workspaceId,
      datasetMode: 'ACTUAL', lineage: marketing.lineage,
      sourceBrief: { id: marketing.id, revision: 2 },
      businessGoal: marketing.businessGoal, opportunity: marketing.opportunity,
      targetAudience: marketing.targetAudience, questions: marketing.questions,
      evidence: marketing.evidence, nextAction: marketing.nextAction,
    })
    expect(blogStrategyBriefSchema.safeParse(result).success).toBe(true)
    expect(Object.isFrozen(result.questions[0])).toBe(true)
    expect(result).not.toHaveProperty('measuredValue')
  })

  it.each(['workspaceId', 'datasetMode', 'conversationId', 'missionId', 'runId'])('rejects a mismatched %s', (field) => {
    const mismatched = field === 'workspaceId' ? { ...scope, workspaceId: marketing.id }
      : field === 'datasetMode' ? { ...scope, datasetMode: 'TEST' as const }
        : { ...scope, lineage: { ...scope.lineage, [field]: marketing.id } }
    expect(() => buildBlogStrategyBrief(marketing, mismatched)).toThrow()
  })

  it.each(['questions', 'evidence'] as const)('rejects synthetic %s in ACTUAL', (field) => {
    expect(() => buildBlogStrategyBrief({ ...marketing, [field]: marketing[field].map((row) => ({ ...row, source: 'synthetic_test' })) }, scope)).toThrow()
  })

  it.each([
    { consentScope: 'internal_only' }, { piiRedacted: false }, { ownerApproved: false },
    { evidenceRef: '' }, { observedAt: null, source: 'public_observed' },
  ])('rejects a question not safe for public content: %j', (change) => {
    expect(() => buildBlogStrategyBrief({ ...marketing, questions: [{ ...marketing.questions[0], ...change }] }, scope)).toThrow()
  })

  it.each(['questions', 'evidence'] as const)('rejects repeated %s IDs rather than multiplying the same source', field => {
    expect(() => buildBlogStrategyBrief({ ...marketing, [field]: [marketing[field][0], marketing[field][0]] }, scope)).toThrow()
  })

  it('rejects conflicting question revisions sharing the same ID', () => {
    expect(() => buildBlogStrategyBrief({ ...marketing, questions: [
      marketing.questions[0], { ...marketing.questions[0], text: '다른 질문', source: 'keyword_inferred', observedAt: null },
    ] }, scope)).toThrow()
  })

  it('allows an inferred question without presenting it as an observed customer inquiry', () => {
    const result = buildBlogStrategyBrief({ ...marketing, questions: [{ ...marketing.questions[0], source: 'keyword_inferred', observedAt: null }] }, scope)
    expect(result.questions[0]).toMatchObject({ source: 'keyword_inferred', observedAt: null })
  })

  it('works with minimal approved facts and no observed questions or external search', () => {
    const result = buildBlogStrategyBrief({ ...marketing, questions: [] }, scope)
    expect(result.evidence).toEqual(marketing.evidence)
    expect(result.questions).toEqual([])
  })

  it('requires at least one grounded fact instead of inventing a business profile', () => {
    expect(() => buildBlogStrategyBrief({ ...marketing, evidence: [] }, scope)).toThrow()
  })
})

describe('ANI-1901: 대화에서 제외하기로 한 주장(excludedClaims)', () => {
  it('제외 주장은 선택 항목이라 기존 저장 브리프도 계속 파싱된다', () => {
    expect(blogStrategyBriefSchema.safeParse(buildBlogStrategyBrief(marketing, scope)).success).toBe(true)
  })

  it('제외 주장을 브리프에 그대로 보존한다', () => {
    const brief = buildBlogStrategyBrief({ ...marketing, excludedClaims: ['할인'] }, scope)
    expect(brief.excludedClaims).toEqual(['할인'])
  })

  it('빈 문자열 제외 주장은 거부한다', () => {
    expect(() => buildBlogStrategyBrief({ ...marketing, excludedClaims: [' '] }, scope)).toThrow()
  })

  it('원고 어느 위치에서든 제외 주장이 나오면 찾아낸다(공백·대소문자 무시)', () => {
    const payload = { title: '안내', sections: [{ heading: '혜택', body: '이번 달 첫 방문 할 인 이벤트' }], cta: { text: 'VIP 상담' } }
    expect(findExcludedClaimViolations(payload, ['할인', 'vip'])).toEqual(['할인', 'vip'])
    expect(findExcludedClaimViolations({ title: '상담 안내' }, ['할인'])).toEqual([])
    expect(findExcludedClaimViolations(payload, [])).toEqual([])
  })
})

describe('ANI-1901: 사장님 조건 문장에서 제외 주장 추출', () => {
  it.each([
    ['할인 내용 제외', ['할인']],
    ['할인, 후기 빼줘', ['할인', '후기']],
    ['가격 언급하지 마세요', ['가격']],
    ['할인 및 이벤트는 쓰지 마', ['할인', '이벤트']],
    ['할인 내용 제외. 친근한 말투로', ['할인']],
  ])('%s → %j', (text, expected) => {
    expect(extractExcludedClaims(text)).toEqual(expected)
  })

  it('제외 의사가 없는 조건에서는 아무것도 추출하지 않는다', () => {
    expect(extractExcludedClaims('친근한 말투로 써 주세요')).toEqual([])
    expect(extractExcludedClaims('')).toEqual([])
  })
})

describe('선택한 주제의 핵심 키워드(focusKeyword)', () => {
  const focusKeyword = { keyword: '강남 눈썹문신 상담', searchStatus: 'NOT_OBSERVED' as const, internalScore: 72 }

  it('핵심 키워드는 선택 항목이라 기존 저장 브리프도 계속 파싱된다', () => {
    expect(buildBlogStrategyBrief(marketing, scope)).not.toHaveProperty('focusKeyword')
  })

  it('승인 단계의 핵심 키워드를 블로그 브리프까지 그대로 보존한다', () => {
    const brief = buildBlogStrategyBrief({ ...marketing, focusKeyword }, scope)
    expect(brief.focusKeyword).toEqual(focusKeyword)
  })

  it.each([
    { keyword: ' ' }, { searchStatus: 'GUARANTEED' }, { internalScore: 101 }, { internalScore: -1 },
  ])('잘못된 핵심 키워드는 거부한다: %j', change => {
    expect(() => buildBlogStrategyBrief({ ...marketing, focusKeyword: { ...focusKeyword, ...change } }, scope)).toThrow()
  })

  it('알 수 없는 노출·순위 필드는 받지 않는다', () => {
    expect(() => buildBlogStrategyBrief({ ...marketing, focusKeyword: { ...focusKeyword, rank: 1 } }, scope)).toThrow()
  })
})

describe('핵심 키워드를 원고 태그 맨 앞에 보장', () => {
  it('없으면 맨 앞에 넣고, 이미 있으면 공백·대소문자 무시로 앞으로 옮긴다', () => {
    expect(ensureFocusKeyword(['눈썹', '반영구'], '강남 눈썹문신 상담')).toEqual(['강남 눈썹문신 상담', '눈썹', '반영구'])
    expect(ensureFocusKeyword(['눈썹', '강남눈썹문신상담'], '강남 눈썹문신 상담')).toEqual(['강남 눈썹문신 상담', '눈썹'])
  })
  it('핵심 키워드가 없으면 태그를 건드리지 않고, 개수 상한을 넘기지 않는다', () => {
    const tags = ['a', 'b']
    expect(ensureFocusKeyword(tags, undefined)).toBe(tags)
    const many = Array.from({ length: 10 }, (_, i) => `태그${i}`)
    const result = ensureFocusKeyword(many, '핵심', 10)
    expect(result).toHaveLength(10)
    expect(result[0]).toBe('핵심')
  })
})
