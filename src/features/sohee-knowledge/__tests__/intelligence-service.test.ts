import { describe, expect, it } from 'vitest'
import { analyzeKnowledgeIntelligence } from '../intelligence-service'

function createMockClient(options: {
  profile?: {
    business_name?: string
    industry?: string
    location?: string
    summary?: string
  } | null
  facts?: Array<{
    id: string
    category: string
    content: string
    status?: string
  }>
}) {
  return {
    from: (table: string) => {
      if (table === 'business_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  options.profile !== undefined
                    ? options.profile
                    : {
                        business_name: '맛있는 고기집',
                        industry: '요식업/식당',
                        location: '인천 서구 청라동',
                        summary: '청라 1등 숙성 삼겹살 전문점',
                      },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === 'knowledge_facts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({
                    data: options.facts ?? [],
                    error: null,
                  }),
                }),
                // or just direct resolve if no order/limit chaining
                data: options.facts ?? [],
                error: null,
              }),
            }),
          }),
        }
      }

      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }
    },
  }
}

describe('analyzeKnowledgeIntelligence', () => {
  const WS_ID = 'ws-test-123'

  it('workspaceId가 누락되면 에러를 던진다', async () => {
    await expect(analyzeKnowledgeIntelligence('' as any)).rejects.toThrow(
      'workspaceId is required',
    )
  })

  describe('1) 역질문 (Inquiry) 로직', () => {
    it('식당/요식업 매장에 편의 정보(구워드림/룸/주차 등)가 없으면 고기 굽기 및 편의시설 역질문을 반환한다', async () => {
      const client = createMockClient({
        profile: {
          business_name: '청라 도톰삼겹',
          industry: '식당/요식업',
          location: '인천 서구 청라동',
        },
        facts: [
          {
            id: 'f1',
            category: 'MENU',
            content: '대표메뉴: 삼겹살 15,000원, 목살 15,000원',
          },
        ],
      })

      const result = await analyzeKnowledgeIntelligence(WS_ID, client as any)

      expect(result.inquiry).not.toBeNull()
      expect(result.inquiry?.question).toContain('고기 직접 구워주시나요')
      expect(result.inquiry?.suggestedChips).toEqual(
        expect.arrayContaining(['직접 구워드림', '무료 주차 가능']),
      )
    })

    it('카페/디저트 매장에 디카페인/테라스/포장/원두/애견동반 정보가 없으면 해당 역질문을 반환한다', async () => {
      const client = createMockClient({
        profile: {
          business_name: '모모 카페',
          industry: '카페·디저트',
          location: '서울 성수동',
        },
        facts: [
          {
            id: 'f1',
            category: 'MENU',
            content: '아메리카노 4500원, 라떼 5000원',
          },
        ],
      })

      const result = await analyzeKnowledgeIntelligence(WS_ID, client as any)

      expect(result.inquiry).not.toBeNull()
      expect(result.inquiry?.question).toContain(
        '디카페인 변경이나 테라스/포장이 가능한가요?',
      )
      expect(result.inquiry?.suggestedChips).toEqual(
        expect.arrayContaining(['디카페인 가능']),
      )
    })

    it('미용/뷰티 매장에 예약제/경력/주차/시술시간 정보가 없으면 시술 예약 기준 역질문을 반환한다', async () => {
      const client = createMockClient({
        profile: {
          business_name: '스타일 헤어샵',
          industry: '미용/뷰티',
          location: '경기 분당구',
        },
        facts: [
          {
            id: 'f1',
            category: 'MENU',
            content: '디자인 컷 25000원',
          },
        ],
      })

      const result = await analyzeKnowledgeIntelligence(WS_ID, client as any)

      expect(result.inquiry).not.toBeNull()
      expect(result.inquiry?.question).toContain(
        '하루 최대 시술 인원이나 원장 1:1 맞춤 예약 기준이 어떻게 되나요?',
      )
      expect(result.inquiry?.suggestedChips).toEqual(
        expect.arrayContaining(['100% 예약제', '1:1 원장 맞춤']),
      )
    })

    it('모든 필수 요소 및 FAQ, 차별점이 이미 등록되어 있으면 inquiry는 null을 반환한다', async () => {
      const client = createMockClient({
        profile: {
          business_name: '청라 도톰삼겹',
          industry: '식당/요식업',
          location: '인천 서구 청라동',
        },
        facts: [
          {
            id: 'f1',
            category: 'MENU',
            content: '삼겹살 15,000원',
          },
          {
            id: 'f2',
            category: 'DIFFERENTIATOR',
            content: '전문 그릴러가 고기를 직접 구워드리며, 16석 단체 룸과 아기의자가 있습니다.',
          },
          {
            id: 'f3',
            category: 'FAQ',
            content: '콜키지 프리 무료 지원, 건물 지하 2시간 무료 주차 가능합니다.',
          },
        ],
      })

      const result = await analyzeKnowledgeIntelligence(WS_ID, client as any)

      expect(result.inquiry).toBeNull()
    })
  })

  describe('2) 시즌 트리거 (Seasonality) 로직', () => {
    it('현재 날짜 기준 계절 및 이벤트 시즌 트리거를 올바르게 제안한다', async () => {
      const client = createMockClient({
        profile: {
          business_name: '청라 삼겹살',
          industry: '식당',
          location: '청라동',
        },
        facts: [],
      })

      const result = await analyzeKnowledgeIntelligence(WS_ID, client as any)

      expect(result.seasonTrigger).not.toBeNull()
      expect(result.seasonTrigger?.seasonName).toBeDefined()
      expect(result.seasonTrigger?.title).toBeDefined()
      expect(result.seasonTrigger?.actionPrompt).toBeDefined()
    })
  })

  describe('3) 상권 경쟁력 인텔리전스 (Competitive Insight) 로직', () => {
    it('등록된 팩트에서 핵심 강점(예: 2시간 무료 주차)을 감지하고 지역(청라)과 결합한 추천을 제공한다', async () => {
      const client = createMockClient({
        profile: {
          business_name: '청라 고기본가',
          industry: '요식업',
          location: '인천 서구 청라동 123',
        },
        facts: [
          {
            id: 'f1',
            category: 'FAQ',
            content: '건물 지하 주차장에 2시간 무료 주차 가능합니다.',
          },
        ],
      })

      const result = await analyzeKnowledgeIntelligence(WS_ID, client as any)

      expect(result.competitiveInsight).not.toBeNull()
      expect(result.competitiveInsight?.strengthHighlight).toContain('무료 주차')
      expect(result.competitiveInsight?.recommendation).toContain('청라')
      expect(result.competitiveInsight?.recommendation).toContain('무료 주차')
    })

    it('카페 매장에서 직접 로스팅 강점을 감지하면 성수 지역 맞춤 경쟁력 카피를 제안한다', async () => {
      const client = createMockClient({
        profile: {
          business_name: '성수 빈랩',
          industry: '카페',
          location: '서울 성동구 성수동 456',
        },
        facts: [
          {
            id: 'f1',
            category: 'DIFFERENTIATOR',
            content: '매일 아침 스페셜티 생두를 직접 로스팅합니다.',
          },
        ],
      })

      const result = await analyzeKnowledgeIntelligence(WS_ID, client as any)

      expect(result.competitiveInsight).not.toBeNull()
      expect(result.competitiveInsight?.strengthHighlight).toContain('직접 로스팅')
      expect(result.competitiveInsight?.recommendation).toContain('성수')
    })
  })

  it('lastAnalyzedAt을 ISO 형식으로 반환한다', async () => {
    const client = createMockClient({ facts: [] })
    const result = await analyzeKnowledgeIntelligence(WS_ID, client as any)

    expect(result.lastAnalyzedAt).toBeDefined()
    expect(new Date(result.lastAnalyzedAt).toISOString()).toBe(result.lastAnalyzedAt)
  })
})
