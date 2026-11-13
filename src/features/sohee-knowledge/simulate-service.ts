export type SimulateType = 'faq' | 'marketing'

export interface SimulateKnowledgeInput {
  workspaceId: string
  query: string
  type?: SimulateType
}

export interface MatchedFact {
  id: string
  category: string
  content: string
}

export interface SimulateKnowledgeResult {
  answer: string
  usedFacts: MatchedFact[]
  hasLearnedKnowledge: boolean
}

export interface SimulateKnowledgeDeps {
  client?: any
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  PARKING: ['주차', '주차장', '차량', '발렛', '파킹', '차 대', '차를'],
  HOURS: ['영업', '시간', '오픈', '마감', '휴무', '휴일', '브레이크타임', '몇시', '언제 열', '언제 닫'],
  FAQ: ['예약', '테이블', '룸', '자리', '웨이팅', '문의', '질문', '반려동물', '애견', '아이', '키즈'],
  PRICE: ['가격', '얼마', '비용', '금액', '원', '단가', '할인', '가성비'],
  MENU: ['메뉴', '대표', '시그니처', '음식', '디저트', '음료', '커피', '밥', '요리', '맛', '추천', '인기'],
  DIFFERENTIATOR: ['특징', '소개', '분위기', '차별점', '비법', '스페셜', '장점', '자랑', '어떤 가게', '매력'],
  PROHIBITED: ['금지', '주의', '불가', '제한'],
}

function calculateMatchScore(fact: MatchedFact, normalizedQuery: string): number {
  let score = 0
  const cat = (fact.category || '').toUpperCase().trim()

  // 1. 카테고리 키워드 매칭
  const catKeywords = CATEGORY_KEYWORDS[cat] || []
  for (const kw of catKeywords) {
    if (normalizedQuery.includes(kw)) {
      score += 5
    }
  }

  // 2. 카테고리 영문명 언급 매칭
  if (cat && normalizedQuery.includes(cat.toLowerCase())) {
    score += 3
  }

  // 3. 질문 토큰이 팩트 내용에 포함되는지
  const queryTokens = normalizedQuery
    .replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)

  for (const token of queryTokens) {
    if (fact.content.toLowerCase().includes(token)) {
      score += 4
    }
  }

  // 4. 팩트 내용의 단어가 질문에 포함되는지
  const factTokens = (fact.content || '')
    .toLowerCase()
    .replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)

  for (const token of factTokens) {
    if (normalizedQuery.includes(token)) {
      score += 3
    }
  }

  return score
}

export async function simulateKnowledgeResponse(
  input: SimulateKnowledgeInput,
  deps?: SimulateKnowledgeDeps,
): Promise<SimulateKnowledgeResult> {
  const { workspaceId, query, type } = input

  if (!workspaceId?.trim()) {
    throw new Error('workspaceId is required')
  }

  const client =
    deps?.client ??
    ((await import('@/lib/supabase/admin')).createAdminSupabaseClient() as any)

  let facts: MatchedFact[] = []
  let rpcSucceeded = false

  if (typeof client.rpc === 'function') {
    try {
      const { data: rpcData, error: rpcError } = await client.rpc('get_approved_learning_context', {
        p_workspace_id: workspaceId.trim(),
        p_purpose: 'conversation',
        p_max_facts: 100,
        p_query: query || '',
      })
      if (!rpcError && rpcData) {
        const items = Array.isArray(rpcData.items) ? rpcData.items : Array.isArray(rpcData) ? rpcData : []
        const channelEnabled = process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1'
        facts = items
          .filter((item: any) => item.source_type !== 'channel' || channelEnabled)
          .map((item: any) => ({
            id: String(item.id || ''),
            category: String(item.category || ''),
            content: String(item.content || ''),
          }))
        rpcSucceeded = true
      }
    } catch {
      // safe fallback
    }
  }

  if (!rpcSucceeded) {
    const { data, error } = await client
      .from('knowledge_facts')
      .select('id, category, content, valid_until')
      .eq('workspace_id', workspaceId.trim())
      .eq('status', 'active')
      .limit(100)

    if (error) {
      throw new Error(`knowledge_facts query failed: ${error.message || 'unknown error'}`)
    }

    const now = Date.now()
    const rawList: any[] = Array.isArray(data) ? data : []
    facts = rawList
      .filter((item) => {
        if (item.valid_until) {
          const until = new Date(item.valid_until).getTime()
          if (!Number.isNaN(until) && until <= now) return false
        }
        return true
      })
      .map((item) => ({
        id: String(item.id || ''),
        category: String(item.category || ''),
        content: String(item.content || ''),
      }))
  }

  // 활성 팩트가 전혀 없는 경우
  if (facts.length === 0) {
    return {
      answer:
        '사장님, 아직 제가 배운 가게 지식이 없어요! [가르치기] 탭에서 인터뷰에 답해주시거나 자료를 등록해주시면, 손님 응대와 홍보 글 작성을 똑똑하게 도와드릴 수 있어요.',
      usedFacts: [],
      hasLearnedKnowledge: false,
    }
  }

  const normalizedQuery = (query || '').toLowerCase().trim()

  const isMarketing =
    type === 'marketing' ||
    /(인스타|홍보|마케팅|글|카피|피드|릴스|스토리|포스팅|소개글|광고|작성|써봐|써줘)/i.test(
      normalizedQuery,
    )

  // 팩트 점수 계산 및 필터링
  const scoredFacts = facts
    .map((fact) => ({ fact, score: calculateMatchScore(fact, normalizedQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)

  let matchedFacts: MatchedFact[] = []

  if (scoredFacts.length > 0) {
    matchedFacts = scoredFacts.slice(0, 3).map((item) => item.fact)
  } else if (isMarketing) {
    // 마케팅 질의이나 특정 키워드가 매칭되지 않은 경우(예: '인스타 한 줄 써봐'),
    // 가게의 대표 지식(차별점, 대표메뉴, 가격 등)을 우선 선택하여 홍보 카피 생성
    const marketingOrder: Record<string, number> = {
      DIFFERENTIATOR: 1,
      MENU: 2,
      PRICE: 3,
      HOURS: 4,
      FAQ: 5,
    }
    const sortedForMarketing = [...facts].sort((a, b) => {
      const orderA = marketingOrder[a.category.toUpperCase()] ?? 99
      const orderB = marketingOrder[b.category.toUpperCase()] ?? 99
      return orderA - orderB
    })
    matchedFacts = sortedForMarketing.slice(0, 3)
  }

  // 매칭된 팩트가 전혀 없는 경우
  if (matchedFacts.length === 0) {
    return {
      answer:
        '사장님, 여쭤보신 내용에 대해서는 아직 제가 배우지 못했어요. [지식 도서관]에서 해당 내용을 추가해주시면 손님께 정확하게 안내할게요!',
      usedFacts: [],
      hasLearnedKnowledge: true,
    }
  }

  const factsText = matchedFacts.map((f) => f.content).join('\n')

  let answer = ''
  if (isMarketing) {
    answer = `사장님! 배운 지식을 살려서 이렇게 인스타 글을 써봤어요 💖\n\n${factsText}\n\n매장의 매력이 잘 드러나도록 작성했어요!`
  } else {
    answer = `손님께서 문의주시면 이렇게 답변드릴게요!\n\n안녕하세요! 저희 매장은 ${factsText}으로 운영되고 있습니다. 편하게 방문해 주세요 😊`
  }

  return {
    answer,
    usedFacts: matchedFacts,
    hasLearnedKnowledge: true,
  }
}
