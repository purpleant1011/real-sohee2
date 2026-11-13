import { describe, expect, it } from 'vitest'
import {
  simulateKnowledgeResponse,
  type SimulateKnowledgeDeps,
} from '../simulate-service'

function createMockClient(factsData: any[], error: any = null) {
  return {
    from: (table: string) => {
      expect(table).toBe('knowledge_facts')
      return {
        select: (cols: string) => {
          expect(cols).toContain('id')
          expect(cols).toContain('category')
          expect(cols).toContain('content')
          return {
            eq: (_field1: string, _val1: string) => ({
              eq: (_field2: string, _val2: string) => ({
                limit: (_n: number) => Promise.resolve({ data: factsData, error }),
              }),
            }),
          }
        },
      }
    },
  }
}

describe('simulateKnowledgeResponse', () => {
  const workspaceId = 'ws-test-123'

  it('활성 팩트가 전혀 없을 때 hasLearnedKnowledge: false와 가르치기 유도 문구를 반환한다', async () => {
    const deps: SimulateKnowledgeDeps = {
      client: createMockClient([]),
    }

    const result = await simulateKnowledgeResponse(
      {
        workspaceId,
        query: '주차 되나요?',
      },
      deps,
    )

    expect(result.hasLearnedKnowledge).toBe(false)
    expect(result.usedFacts).toEqual([])
    expect(result.answer).toBe(
      '사장님, 아직 제가 배운 가게 지식이 없어요! [가르치기] 탭에서 인터뷰에 답해주시거나 자료를 등록해주시면, 손님 응대와 홍보 글 작성을 똑똑하게 도와드릴 수 있어요.',
    )
  })

  it('활성 팩트는 있으나 질의와 매칭되지 않는 경우 솔직한 미학습 안내 문구를 반환한다', async () => {
    const facts = [
      { id: 'fact-1', category: 'MENU', content: '시그니처 바닐라 라떼 6000원' },
    ]
    const deps: SimulateKnowledgeDeps = {
      client: createMockClient(facts),
    }

    const result = await simulateKnowledgeResponse(
      {
        workspaceId,
        query: '수영장 시설이 있나요?',
      },
      deps,
    )

    expect(result.hasLearnedKnowledge).toBe(true)
    expect(result.usedFacts).toEqual([])
    expect(result.answer).toBe(
      '사장님, 여쭤보신 내용에 대해서는 아직 제가 배우지 못했어요. [지식 도서관]에서 해당 내용을 추가해주시면 손님께 정확하게 안내할게요!',
    )
  })

  it('고객 문의(FAQ) 질의 시 매칭된 팩트를 바탕으로 손님 응대 톤의 답변을 합성한다', async () => {
    const facts = [
      { id: 'fact-parking', category: 'PARKING', content: '지하 주차장에 2시간 무료 주차 가능합니다.' },
      { id: 'fact-menu', category: 'MENU', content: '한우 등심 스테이크 45,000원' },
    ]
    const deps: SimulateKnowledgeDeps = {
      client: createMockClient(facts),
    }

    const result = await simulateKnowledgeResponse(
      {
        workspaceId,
        query: '손님이 주차 문의하면?',
        type: 'faq',
      },
      deps,
    )

    expect(result.hasLearnedKnowledge).toBe(true)
    expect(result.usedFacts).toHaveLength(1)
    expect(result.usedFacts[0].id).toBe('fact-parking')
    expect(result.answer).toContain('손님께서 문의주시면 이렇게 답변드릴게요!')
    expect(result.answer).toContain('지하 주차장에 2시간 무료 주차 가능합니다.')
    expect(result.answer).toContain('편하게 방문해 주세요 😊')
  })

  it('마케팅/인스타 질의 또는 type: marketing 시 홍보 카피 말풍선을 합성한다', async () => {
    const facts = [
      { id: 'fact-menu', category: 'MENU', content: '30일 저온 숙성 한우 안심' },
      { id: 'fact-diff', category: 'DIFFERENTIATOR', content: '참숯 직화 구이 전문점' },
    ]
    const deps: SimulateKnowledgeDeps = {
      client: createMockClient(facts),
    }

    const result = await simulateKnowledgeResponse(
      {
        workspaceId,
        query: '인스타 한 줄 써봐',
      },
      deps,
    )

    expect(result.hasLearnedKnowledge).toBe(true)
    expect(result.usedFacts.length).toBeGreaterThan(0)
    expect(result.answer).toContain('사장님! 배운 지식을 살려서 이렇게 인스타 글을 써봤어요 💖')
    expect(result.answer).toContain('매장의 매력이 잘 드러나도록 작성했어요!')
  })

  it('매칭된 팩트는 최대 3개까지만 usedFacts에 포함한다', async () => {
    const facts = [
      { id: 'f1', category: 'MENU', content: '대표 메뉴 아메리카노' },
      { id: 'f2', category: 'MENU', content: '대표 메뉴 카페라떼' },
      { id: 'f3', category: 'MENU', content: '대표 메뉴 카푸치노' },
      { id: 'f4', category: 'MENU', content: '대표 메뉴 바닐라라떼' },
      { id: 'f5', category: 'MENU', content: '대표 메뉴 플랫화이트' },
    ]
    const deps: SimulateKnowledgeDeps = {
      client: createMockClient(facts),
    }

    const result = await simulateKnowledgeResponse(
      {
        workspaceId,
        query: '대표 메뉴가 뭐야?',
      },
      deps,
    )

    expect(result.usedFacts.length).toBe(3)
  })

  it('DB 에러 발생 시 예외를 던진다', async () => {
    const deps: SimulateKnowledgeDeps = {
      client: createMockClient([], { message: 'Database query failed' }),
    }

    await expect(
      simulateKnowledgeResponse(
        {
          workspaceId,
          query: '테스트',
        },
        deps,
      ),
    ).rejects.toThrow('Database query failed')
  })
})
