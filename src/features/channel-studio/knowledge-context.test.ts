import { describe, expect, it } from 'vitest'
import { loadGroundedBusinessContext, createSupabaseKnowledgeGateway, type KnowledgeGateway } from './knowledge-context'
import { ChannelDraftError } from './types'

const profile = { data: { business_name: '작은 카페', industry: '카페', location: '망원동', summary: '동네 커피집' }, error: null }
const knowledge = { data: { version_no: 3, business_identity: { businessType: '커피집' }, offerings: [{ key: '대표 메뉴', value: '핸드드립 커피' }], policies: [], audience: {}, brand_voice: {} }, error: null }
const textRule = { data: { structured_rule: { brandVoice: '차분하고 정중한 말투' } }, error: null }
const gateway = (overrides: Partial<KnowledgeGateway> = {}): KnowledgeGateway => ({
  profile: async () => profile, knowledge: async () => knowledge, textRule: async () => textRule, ...overrides,
})

describe('grounded business context', () => {
  it('does not feed unfilled business templates into content generation', async () => {
    const ctx = await loadGroundedBusinessContext('A', gateway({
      knowledge: async () => ({ ...knowledge, data: { ...knowledge.data, offerings: [{ key: '대표 메뉴', value: '[시그니처 메뉴]' }] } }),
      facts: async () => ({ data: [{ id: 'template', category: 'MENU', content: '대표 메뉴는 [시그니처 메뉴]입니다.' }], error: null }),
    }))
    expect(ctx.facts.some(fact => fact.value.includes('[시그니처 메뉴]'))).toBe(false)
  })

  it('never treats failed reads or thrown queries as empty knowledge', async () => {
    for (const field of ['profile', 'knowledge', 'textRule'] as const) {
      await expect(loadGroundedBusinessContext('A', gateway({ [field]: async () => ({ data: null, error: { message: 'down' } }) })))
        .rejects.toMatchObject({ code: 'KNOWLEDGE_UNAVAILABLE', status: 503 })
    }
    await expect(loadGroundedBusinessContext('A', gateway({ knowledge: async () => { throw Error('down') } })))
      .rejects.toThrow('가게 정보를 불러오지 못했어요')
  })

  it('distinguishes absent profile and active version from a failed read', async () => {
    await expect(loadGroundedBusinessContext('A', gateway({ profile: async () => ({ data: null, error: null }) })))
      .rejects.toEqual(new ChannelDraftError('나의 지식에서 가게 정보를 먼저 확인해 주세요.', 'KNOWLEDGE_MISSING', 409))
    await expect(loadGroundedBusinessContext('A', gateway({ knowledge: async () => ({ data: null, error: null }) })))
      .rejects.toMatchObject({ code: 'KNOWLEDGE_MISSING', status: 409 })
  })

  it('scopes every query to the requested workspace and only the active knowledge and text rule', async () => {
    const reads: Array<{ table: string; filters: Record<string, unknown> }> = []
    const admin = { async rpc() { return { data: [], error: null } }, from(table: string) {
      const filters: Record<string, unknown> = {}
      const chain = {
        select() { return chain }, eq(key: string, value: unknown) { filters[key] = value; return chain },
        order() { return chain }, limit() { return chain },
        async maybeSingle() {
          reads.push({ table, filters: { ...filters } })
          if (filters.workspace_id !== 'A') return { data: null, error: null }
          return table === 'business_profiles' ? profile : table === 'workspace_knowledge_harnesses' ? knowledge : textRule
        },
      }
      return chain
    } }
    const scoped = createSupabaseKnowledgeGateway(admin)
    const a = await loadGroundedBusinessContext('A', scoped)
    expect(a.businessName).toBe('작은 카페')
    expect(a.facts).toContainEqual({ kind: 'offering', label: '대표 메뉴', value: '핸드드립 커피' })
    expect(reads).toHaveLength(4)
    expect(reads.every(({ filters }) => filters.workspace_id === 'A')).toBe(true)
    expect(reads.find(({ table }) => table === 'workspace_knowledge_harnesses')?.filters.is_active).toBe(true)
    expect(reads.find(({ table }) => table === 'harness_rules')?.filters).toMatchObject({ rule_type: 'text_generation', status: 'active' })
    // 자가 입력 운영 정보도 같은 워크스페이스로만 조회해야 한다.
    expect(reads.find(({ table }) => table === 'workspace_business_details')?.filters.workspace_id).toBe('A')
    await expect(loadGroundedBusinessContext('B', scoped)).rejects.toMatchObject({ code: 'KNOWLEDGE_MISSING' })
  })

  it('refuses foreign or inactive rows even when an alternative gateway ignores filters', async () => {
    const foreign = gateway({ knowledge: async () => ({ data: { ...knowledge.data, workspace_id: 'B' }, error: null }) })
    await expect(loadGroundedBusinessContext('A', foreign)).rejects.toMatchObject({ code: 'KNOWLEDGE_UNAVAILABLE' })
    const inactive = gateway({ knowledge: async () => ({ data: { ...knowledge.data, is_active: false }, error: null }) })
    await expect(loadGroundedBusinessContext('A', inactive)).rejects.toMatchObject({ code: 'KNOWLEDGE_MISSING' })
  })

  it('takes only bounded strings and known fact entries, strips controls and notes missing price, benefit and hours', async () => {
    const ctx = await loadGroundedBusinessContext('A', gateway({ knowledge: async () => ({
      data: { ...knowledge.data, offerings: [{ key: '메뉴', value: '커피\n☕' }, { key: '무시', value: { arbitrary: '비확인' } }, 3],
        policies: [{ key: '영업시간', value: '매일 09:00~18:00' }], audience: ['동네 주민'],
        business_identity: { businessType: '커피집', createdBy: '4e0fc5a7-16a1-416c-b082-90a675a66807', unexpected: '미확인 운영 혜택' },
        brand_voice: { text: '담백한 표현' } }, error: null,
    }) }))
    expect(ctx.facts.some((fact) => fact.value === '커피 ☕')).toBe(true)
    expect(ctx.facts.some((fact) => fact.value === '비확인')).toBe(false)
    expect(ctx.facts.some((fact) => fact.value === '미확인 운영 혜택' || fact.value.includes('4e0fc5a7'))).toBe(false)
    expect(ctx.facts.some((fact) => fact.value === '동네 주민')).toBe(true)
    expect(ctx.warnings).toContain('가격 정보가 없어서 가격 문구는 넣지 않아요.')
    expect(ctx.warnings).toContain('혜택 정보가 없어서 할인·쿠폰 문구는 넣지 않아요.')
    expect(ctx.warnings.some((note) => note.includes('영업시간 정보가 없어서'))).toBe(false)
    expect(ctx.tone.brandVoice).toBe('차분하고 정중한 말투')
  })

  it('사장님 자가 입력 운영 정보를 사실로 편입하고, 사업자등록번호·대표자명은 절대 넣지 않는다', async () => {
    const ctx = await loadGroundedBusinessContext('A', gateway({
      businessDetails: async () => ({
        data: {
          business_hours: '평일 10:00~19:00',
          closed_days: '매주 월요일',
          parking_info: '매장 앞 2대',
          reservation_method: '네이버 예약',
          price_range: '1인 3~5만원',
          business_type: '서비스업',
          business_item: '속눈썹증모',
          website_url: 'https://blog.naver.com/bairm',
          // 아래 두 값은 쿼리에서 선택하지 않지만, 방어적으로 확인한다.
          business_number: '0000000000',
          representative_name: '홍길동',
        },
        error: null,
      }),
    }))

    expect(ctx.facts).toContainEqual({ kind: 'policy', label: '영업시간', value: '평일 10:00~19:00' })
    expect(ctx.facts).toContainEqual({ kind: 'policy', label: '주차 안내', value: '매장 앞 2대' })
    expect(ctx.facts).toContainEqual({ kind: 'offering', label: '가격대', value: '1인 3~5만원' })
    expect(ctx.facts).toContainEqual({ kind: 'identity', label: '업태', value: '서비스업' })

    // 영업시간·가격이 채워졌으니 해당 경고는 사라진다.
    expect(ctx.warnings.some((note) => note.includes('영업시간 정보가 없어서'))).toBe(false)
    expect(ctx.warnings).not.toContain('가격 정보가 없어서 가격 문구는 넣지 않아요.')

    // 개인정보는 마케팅 문구 재료가 아니다.
    const serialized = JSON.stringify(ctx.facts)
    expect(serialized).not.toContain('0000000000')
    expect(serialized).not.toContain('홍길동')
  })

  it('integrates active knowledge_facts into grounded context and clears warnings', async () => {
    const factsData = [
      { id: 'f1', category: 'MENU', content: '시그니처 바닐라 라떼' },
      { id: 'f2', category: 'PRICE', content: '아메리카노 4500원' },
      { id: 'f3', category: 'HOURS', content: '월-금 08:00 - 22:00' },
      { id: 'f4', category: 'DIFFERENTIATOR', content: '직접 로스팅하는 스페셜티 원두' },
      { id: 'f5', category: 'FAQ', content: '반려동물 동반 가능한가요? 테라스만 가능합니다.' },
      { id: 'f6', category: 'PROHIBITED', content: '외부 음식 반입 금지' },
      { id: 'f7', category: 'EVENT', content: '텀블러 지참 시 500원 할인 이벤트' },
    ]
    const ctx = await loadGroundedBusinessContext('A', gateway({
      facts: async () => ({ data: factsData, error: null }),
    }))
    expect(ctx.facts).toContainEqual({ kind: 'offering', label: '메뉴', value: '시그니처 바닐라 라떼' })
    expect(ctx.facts).toContainEqual({ kind: 'offering', label: '가격', value: '아메리카노 4500원' })
    expect(ctx.facts).toContainEqual({ kind: 'policy', label: '영업시간', value: '월-금 08:00 - 22:00' })
    expect(ctx.facts).toContainEqual({ kind: 'identity', label: '매장 특징', value: '직접 로스팅하는 스페셜티 원두' })
    expect(ctx.facts).toContainEqual({ kind: 'policy', label: '자주 묻는 질문', value: '반려동물 동반 가능한가요? 테라스만 가능합니다.' })
    expect(ctx.facts).toContainEqual({ kind: 'policy', label: '주의할 점', value: '외부 음식 반입 금지' })
    expect(ctx.facts).toContainEqual({ kind: 'identity', label: 'EVENT', value: '텀블러 지참 시 500원 할인 이벤트' })
    expect(ctx.warnings).not.toContain('가격 정보가 없어서 가격 문구는 넣지 않아요.')
    expect(ctx.warnings).not.toContain('영업시간 정보가 없어서 운영 시간은 안내하지 않아요.')
    expect(ctx.warnings).not.toContain('혜택 정보가 없어서 할인·쿠폰 문구는 넣지 않아요.')
  })

  it('allows generation when legacy harness is missing but active knowledge_facts exist', async () => {
    const factsData = [
      { id: 'f1', category: 'MENU', content: '드립 커피' },
      { id: 'f2', category: 'PRICE', content: '5000원' },
    ]
    const ctx = await loadGroundedBusinessContext('A', gateway({
      knowledge: async () => ({ data: null, error: null }),
      facts: async () => ({ data: factsData, error: null }),
    }))
    expect(ctx.businessName).toBe('작은 카페')
    expect(ctx.knowledgeVersion).toBe(1)
    expect(ctx.facts).toContainEqual({ kind: 'offering', label: '메뉴', value: '드립 커피' })
    expect(ctx.facts).toContainEqual({ kind: 'offering', label: '가격', value: '5000원' })
  })

  it('rejects with 503 when facts query fails or returns foreign row', async () => {
    await expect(loadGroundedBusinessContext('A', gateway({
      facts: async () => ({ data: null, error: { message: 'db error' } }),
    }))).rejects.toMatchObject({ code: 'KNOWLEDGE_UNAVAILABLE', status: 503 })

    await expect(loadGroundedBusinessContext('A', gateway({
      facts: async () => ({ data: [{ id: 'f1', category: 'MENU', content: '커피', workspace_id: 'B' }], error: null }),
    }))).rejects.toMatchObject({ code: 'KNOWLEDGE_UNAVAILABLE', status: 503 })
  })

  it('uses bounded workspace-scoped authoritative facts rather than bare active rows', async () => {
    const admin = {
      async rpc(name: string, input: Record<string, unknown>) {
        if (name !== 'get_approved_learning_context' || input.p_workspace_id !== 'ws-123'
          || input.p_purpose !== 'content' || input.p_max_facts !== 1000) {
          return { data: null, error: { message: 'incorrect knowledge boundary' } }
        }
        return { data: [{ id: 'approved', category: 'PRICE', content: '커피 5000원' }], error: null }
      },
    }
    const result = await createSupabaseKnowledgeGateway(admin).facts!('ws-123')
    expect(result).toEqual({ data: [{ id: 'approved', category: 'PRICE', content: '커피 5000원' }], error: null })
  })

  it('delivers both brandVoice summary and 1200 chars toneAndManner without cutting at 200 chars', async () => {
    const brandVoice = '차분하고 정중한 말투의 카페'
    const toneAndManner = ('1. 첫인사는 가볍게.\n' + '2. 상세 메뉴 지시문입니다. '.repeat(70)).trim()
    const ctx = await loadGroundedBusinessContext('A', gateway({
      textRule: async () => ({
        data: { structured_rule: { brandVoice, toneAndManner } },
        error: null,
      }),
    }))
    expect(ctx.tone.brandVoice).toContain(brandVoice)
    expect(ctx.tone.brandVoice).toContain(toneAndManner)
    expect(ctx.tone.brandVoice?.length).toBeGreaterThan(1000)
  })

  it('excludes facts with expired valid_until or revoked source lease while preserving valid manual facts', async () => {
    const pastDate = new Date(Date.now() - 3600000).toISOString()
    const futureDate = new Date(Date.now() + 3600000).toISOString()
    const factsData = [
      { id: 'f1', category: 'MENU', content: '드립 커피', valid_until: futureDate },
      { id: 'f2', category: 'PRICE', content: '옛날 가격 4000원', valid_until: pastDate },
      { id: 'f3', category: 'POLICY', content: '철회된 운영 안내', is_revoked: true },
      { id: 'f4', category: 'OFFERING', content: '만료된 출처 혜택', source_status: 'revoked' },
    ]
    const ctx = await loadGroundedBusinessContext('A', gateway({
      facts: async () => ({ data: factsData, error: null }),
    }))
    expect(ctx.facts.some((f) => f.value === '드립 커피')).toBe(true)
    expect(ctx.facts.some((f) => f.value.includes('옛날 가격'))).toBe(false)
    expect(ctx.facts.some((f) => f.value.includes('철회된 운영 안내'))).toBe(false)
    expect(ctx.facts.some((f) => f.value.includes('만료된 출처 혜택'))).toBe(false)
  })

  it('blocks bare active facts bypass when legacy harness is missing and all facts are expired or revoked', async () => {
    const pastDate = new Date(Date.now() - 3600000).toISOString()
    const factsData = [
      { id: 'f1', category: 'MENU', content: '만료된 메뉴', valid_until: pastDate },
      { id: 'f2', category: 'PRICE', content: '철회된 가격', is_revoked: true },
    ]
    await expect(loadGroundedBusinessContext('A', gateway({
      knowledge: async () => ({ data: null, error: null }),
      facts: async () => ({ data: factsData, error: null }),
    }))).rejects.toMatchObject({ code: 'KNOWLEDGE_MISSING', status: 409 })
  })

  it('excludes channel facts when SOHEE_CHANNEL_LEARNING_ENABLED is not 1 while keeping manual facts', async () => {
    const originalEnv = process.env.SOHEE_CHANNEL_LEARNING_ENABLED
    try {
      delete process.env.SOHEE_CHANNEL_LEARNING_ENABLED
      const factsData = [
        { id: 'f1', source_type: 'manual', category: 'MENU', content: '핸드드립 커피 5000원' },
        { id: 'f2', source_type: 'channel', category: 'MENU', content: '인스타 피드 학습 메뉴 6000원' },
      ]
      const ctx = await loadGroundedBusinessContext('A', gateway({
        facts: async () => ({ data: factsData, error: null }),
      }))
      expect(ctx.facts.some((f) => f.value === '핸드드립 커피 5000원')).toBe(true)
      expect(ctx.facts.some((f) => f.value === '인스타 피드 학습 메뉴 6000원')).toBe(false)
    } finally {
      if (originalEnv !== undefined) {
        process.env.SOHEE_CHANNEL_LEARNING_ENABLED = originalEnv
      } else {
        delete process.env.SOHEE_CHANNEL_LEARNING_ENABLED
      }
    }
  })

  it('bounds 10,000 facts fixture strictly to MAX_FACTS without crashing or injecting unbounded copy', async () => {
    const largeFacts = Array.from({ length: 10000 }, (_, i) => ({
      id: `f-${i}`,
      category: i % 2 === 0 ? 'PRICE' : 'MENU',
      content: `항목 ${i}: 가격 ${i * 1000}원`,
      source_type: 'manual',
    }))

    const ctx = await loadGroundedBusinessContext('A', gateway({
      facts: async () => ({ data: largeFacts, error: null }),
    }))

    // Total facts including profile facts must never exceed MAX_FACTS (32)
    expect(ctx.facts.length).toBeLessThanOrEqual(32)
  })
})
