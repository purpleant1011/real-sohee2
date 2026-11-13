import { describe, expect, it } from 'vitest'
import { recommendBlogTopics, type TopicFact } from './blog-topic-recommender'

const fact = (id: string, category: string, content: string): TopicFact => ({ id, category, content })
const facts = [
  fact('f1', 'service', '속눈썹 펌은 약 60분 소요됩니다.'),
  fact('f2', 'price', '속눈썹 펌 가격은 5만 원입니다.'),
  fact('f3', 'policy', '예약은 하루 전까지 변경할 수 있습니다.'),
  fact('f4', 'location', '매장은 합정역 4번 출구 도보 3분입니다.'),
]

describe('recommendBlogTopics', () => {
  it('서로 다른 근거로 정확히 3개를 추천한다', () => {
    const topics = recommendBlogTopics({ facts })
    expect(topics).toHaveLength(3)
    expect(new Set(topics.map(t => t.title)).size).toBe(3)
    expect(new Set(topics.map(t => t.evidence.join('|'))).size).toBe(3)
  })

  it('근거는 승인된 사실 원문만 사용하고 id를 함께 돌려준다', () => {
    for (const topic of recommendBlogTopics({ facts })) {
      expect(topic.evidence.length).toBeGreaterThan(0)
      for (const content of topic.evidence) expect(facts.map(f => f.content)).toContain(content)
      expect(topic.factIds.every(id => facts.some(f => f.id === id))).toBe(true)
    }
  })

  it('같은 입력이면 같은 결과다(순서 무관)', () => {
    expect(recommendBlogTopics({ facts: [...facts].reverse() })).toEqual(recommendBlogTopics({ facts }))
  })

  it('사실이 1개뿐이어도 제목이 다른 3개를 만든다', () => {
    const topics = recommendBlogTopics({ facts: [facts[0]] })
    expect(topics).toHaveLength(3)
    expect(new Set(topics.map(t => t.title)).size).toBe(3)
  })

  it('사실이 없으면 빈 배열이다', () => {
    expect(recommendBlogTopics({ facts: [] })).toEqual([])
  })

  it('검색 신호가 없으면 NOT_OBSERVED이고 점수를 지어내지 않는다', () => {
    for (const topic of recommendBlogTopics({ facts })) {
      expect(topic.keywordSignal).toEqual({ status: 'NOT_OBSERVED', keyword: null })
    }
  })

  it('관측된 검색 지표는 표시만 하고 순위를 바꾸지 않는다', () => {
    const base = recommendBlogTopics({ facts })
    const target = base[base.length - 1].primaryKeyword
    const shown = recommendBlogTopics({ facts, keywordObservations: [{ keyword: target, monthlySearches: 12000, competition: 0.2 }] })
    expect(shown.map(t => t.primaryKeyword)).toEqual(base.map(t => t.primaryKeyword))
    expect(shown.map(t => t.rank)).toEqual(base.map(t => t.rank))
    expect(shown.find(t => t.primaryKeyword === target)!.keywordSignal).toEqual(
      { status: 'OBSERVED', keyword: target, monthlySearches: 12000, competition: 0.2 })
  })

  it('금지 표현(1위·최고·보장·후기)을 제목에 쓰지 않는다', () => {
    for (const topic of recommendBlogTopics({ facts }))
      expect(topic.title).not.toMatch(/1위|최고|보장|후기|체험/)
  })

  it('Blog DNA 어조 힌트를 각 주제에 전달한다', () => {
    const topics = recommendBlogTopics({ facts, blogDna: { tone: '친근한 존댓말', avoid: ['과장'] } })
    for (const topic of topics) expect(topic.voice).toEqual({ tone: '친근한 존댓말', avoid: ['과장'] })
  })

  describe('1st-party keyword scoring (ANI-1914 wiring)', () => {
    const workspaceId = '10000000-0000-4000-8000-000000000001'
    const uuidFact = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    const scored = [
      { id: uuidFact(1), category: 'service', content: '속눈썹 펌은 약 60분 소요됩니다.', observedAt: '2026-10-20T00:00:00+09:00' },
      { id: uuidFact(2), category: 'price', content: '속눈썹 펌 가격은 5만 원입니다.', observedAt: '2026-10-20T00:00:00+09:00' },
      { id: uuidFact(3), category: 'policy', content: '예약은 하루 전까지 변경할 수 있습니다.', observedAt: '2026-10-20T00:00:00+09:00' },
      { id: uuidFact(4), category: 'location', content: '매장은 합정역 4번 출구 도보 3분입니다.', observedAt: '2026-10-20T00:00:00+09:00' },
    ]
    const scoring = { workspaceId, datasetMode: 'ACTUAL' as const }

    it('attaches an internal score, policy version and unmeasured items to each topic', () => {
      const topics = recommendBlogTopics({ facts: scored, scoring })
      expect(topics).toHaveLength(3)
      for (const topic of topics) {
        expect(topic.keywordScore).toMatchObject({ policyVersion: 'keyword-score-v1' })
        expect(topic.keywordScore!.unmeasured).toContain('demand')
        expect(topic.rank).toBeCloseTo(topic.keywordScore!.score / 100, 2)
      }
    })

    it('is deterministic and still ignores external search observations for ranking', () => {
      const base = recommendBlogTopics({ facts: scored, scoring })
      const shown = recommendBlogTopics({ facts: scored, scoring, keywordObservations: [{ keyword: base[2]!.primaryKeyword, monthlySearches: 99999, competition: 0.1 }] })
      expect(shown.map(t => [t.primaryKeyword, t.rank])).toEqual(base.map(t => [t.primaryKeyword, t.rank]))
      expect(recommendBlogTopics({ facts: [...scored].reverse(), scoring })).toEqual(base)
    })

    it('drops a topic whose keyword contains an owner-excluded claim', () => {
      const base = recommendBlogTopics({ facts: scored, scoring })
      const banned = base[0]!.primaryKeyword
      const topics = recommendBlogTopics({ facts: scored, scoring: { ...scoring, excludedClaims: [banned] } })
      expect(topics.map(t => t.primaryKeyword)).not.toContain(banned)
    })

    it('leaves the score out when no scoring context is supplied', () => {
      for (const topic of recommendBlogTopics({ facts })) expect(topic.keywordScore).toBeUndefined()
    })
  })
})
