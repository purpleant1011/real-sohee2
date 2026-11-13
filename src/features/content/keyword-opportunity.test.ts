import { describe, expect, it } from 'vitest'
import { KEYWORD_SCORE_POLICY, rankKeywordOpportunities } from './keyword-opportunity'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const factId = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const qId = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function input(over: Record<string, unknown> = {}) {
  return {
    workspaceId,
    datasetMode: 'ACTUAL',
    businessTerms: ['성수동', '헤어살롱'],
    offeredServices: ['남자 커트', '펌'],
    unavailableServices: ['탈색'],
    excludedClaims: ['1위'],
    approvedFacts: [
      { id: factId(1), text: '성수동 남자 커트 전문 디자이너가 상담부터 마무리까지 진행', observedAt: '2026-10-20T00:00:00+09:00' },
      { id: factId(2), text: '펌 시술 전 모발 진단 제공', observedAt: '2026-10-20T00:00:00+09:00' },
    ],
    questions: [
      { id: qId(1), text: '성수동 남자 커트 가격이 궁금해요', source: 'consented_inquiry', observedAt: '2026-10-21T00:00:00+09:00', evidenceRef: 'inquiry:1' },
    ],
    existingPosts: [{ title: '펌 관리법', keywords: ['펌 관리'] }],
    candidates: [
      { keyword: '성수동 남자 커트', origin: 'owner_input' },
      { keyword: '펌 후기', origin: 'owner_input' },
      { keyword: '탈색 잘하는 곳', origin: 'owner_input' },
      { keyword: '성수동 1위 헤어살롱', origin: 'owner_input' },
    ],
    ...over,
  }
}

describe('ANI-1914: first-party keyword opportunity ranking', () => {
  it('excludes unavailable services and owner-excluded claims before any scoring', () => {
    const result = rankKeywordOpportunities(input())
    const excluded = Object.fromEntries(result.excluded.map(item => [item.keyword, item.reason]))
    expect(excluded['탈색 잘하는 곳']).toBe('UNAVAILABLE_SERVICE')
    expect(excluded['성수동 1위 헤어살롱']).toBe('EXCLUDED_CLAIM')
    expect(result.ranked.map(item => item.keyword)).not.toContain('탈색 잘하는 곳')
  })

  it('ranks the keyword backed by owner questions and approved facts first with dated evidence', () => {
    const result = rankKeywordOpportunities(input())
    expect(result.ranked[0]!.keyword).toBe('성수동 남자 커트')
    const top = result.ranked[0]!
    expect(top.evidence.facts.map(fact => fact.id)).toContain(factId(1))
    expect(top.evidence.questions[0]).toMatchObject({ id: qId(1), source: 'consented_inquiry' })
    expect(top.evidence.facts[0]!.observedAt).toBe('2026-10-20T00:00:00+09:00')
    expect(top.score).toBeGreaterThan(result.ranked[1]!.score)
  })

  it('uses the registered 25/25/20/15/15 policy and reports the version', () => {
    expect(KEYWORD_SCORE_POLICY.version).toBe('keyword-score-v1')
    expect(Object.values(KEYWORD_SCORE_POLICY.weights).reduce((sum, weight) => sum + weight, 0)).toBe(100)
    expect(rankKeywordOpportunities(input()).policyVersion).toBe('keyword-score-v1')
  })

  it('never invents demand: no matching question means demand is unmeasured with zero contribution', () => {
    const result = rankKeywordOpportunities(input({ questions: [] }))
    const top = result.ranked.find(item => item.keyword === '성수동 남자 커트')!
    expect(top.components.demand).toMatchObject({ measured: false, points: 0 })
    expect(top.unmeasured).toContain('demand')
  })

  it('does not count keyword-inferred demand like an owner-verified question', () => {
    const verified = rankKeywordOpportunities(input()).ranked.find(item => item.keyword === '성수동 남자 커트')!
    const inferred = rankKeywordOpportunities(input({
      questions: [{ id: qId(1), text: '성수동 남자 커트 가격이 궁금해요', source: 'keyword_inferred', observedAt: null, evidenceRef: 'infer:1' }],
    })).ranked.find(item => item.keyword === '성수동 남자 커트')!
    expect(inferred.components.demand.points).toBeLessThan(verified.components.demand.points)
  })

  it('rejects synthetic questions for ACTUAL workspaces but allows them in TEST', () => {
    const synthetic = [{ id: qId(2), text: '합성 질문', source: 'synthetic_test', observedAt: null, evidenceRef: 'synthetic' }]
    expect(() => rankKeywordOpportunities(input({ questions: synthetic }))).toThrow()
    expect(() => rankKeywordOpportunities(input({ datasetMode: 'TEST', questions: synthetic }))).not.toThrow()
  })

  it('penalizes keywords the owner already covers in an existing post', () => {
    const covered = rankKeywordOpportunities(input({
      existingPosts: [{ title: '성수동 남자 커트 가이드', keywords: ['성수동 남자 커트'] }],
    })).ranked.find(item => item.keyword === '성수동 남자 커트')!
    const fresh = rankKeywordOpportunities(input()).ranked.find(item => item.keyword === '성수동 남자 커트')!
    expect(covered.components.complement.points).toBeLessThan(fresh.components.complement.points)
  })

  it('exposes no competition, search volume or ranking-probability numbers', () => {
    const top = rankKeywordOpportunities(input()).ranked[0]!
    const serialized = JSON.stringify(top)
    for (const forbidden of ['competition', 'searchVolume', 'probability', 'rankChance', 'exposure']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('refuses external search metrics and unknown fields (they are not allowed in scoring or AI input)', () => {
    expect(() => rankKeywordOpportunities(input({ externalMetrics: { '성수동 남자 커트': 12000 } }))).toThrow()
    expect(() => rankKeywordOpportunities(input({ candidates: [{ keyword: '펌', origin: 'naver_search_api' }] }))).toThrow()
  })

  it('dedupes candidates, caps the list and is deterministic', () => {
    const repeated = Array.from({ length: 5 }, () => ({ keyword: '펌 후기', origin: 'owner_input' }))
    const a = rankKeywordOpportunities(input({ candidates: repeated }))
    const b = rankKeywordOpportunities(input({ candidates: repeated }))
    expect(a.ranked).toHaveLength(1)
    expect(a).toEqual(b)
    expect(() => rankKeywordOpportunities(input({ candidates: Array.from({ length: 101 }, (_, i) => ({ keyword: `키워드${i}`, origin: 'owner_input' })) }))).toThrow()
  })

  it('ranks nothing when every candidate is outside the approved business scope', () => {
    const result = rankKeywordOpportunities(input({ candidates: [{ keyword: '코인 투자', origin: 'owner_input' }] }))
    expect(result.ranked[0]?.score ?? 0).toBeLessThan(20)
    expect(result.ranked[0]?.components.topicBoundary.points ?? 0).toBe(0)
  })
})
