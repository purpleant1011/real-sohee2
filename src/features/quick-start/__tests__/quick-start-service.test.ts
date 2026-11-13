import { describe, expect, it } from 'vitest'
import { applyQuickStart, quickStartInputSchema, saveQuickStartProgress } from '../quick-start-service'

type Call = { table: string; op: string; payload?: any; match?: Record<string, unknown> }

function fakeAdmin(existing: { knowledge?: boolean; rules?: string[] } = {}) {
  const calls: Call[] = []
  const admin = {
    from(table: string) {
      const state: Call = { table, op: 'select' }
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => {
          state.match = { ...(state.match ?? {}), [k]: v }
          return chain
        },
        limit: () => chain,
        maybeSingle: async () => {
          calls.push({ ...state })
          if (table === 'workspace_knowledge_harnesses' && existing.knowledge) return { data: { harness_version_id: 'v-existing' }, error: null }
          if (table === 'harness_rules' && existing.rules?.includes(String(state.match?.rule_type))) return { data: { id: 'rule-existing' }, error: null }
          return { data: null, error: null }
        },
        insert: async (payload: any) => {
          calls.push({ table, op: 'insert', payload })
          return { error: null }
        },
        update: (payload: any) => {
          state.op = 'update'
          state.payload = payload
          const done: any = {
            eq: (k: string, v: unknown) => {
              state.match = { ...(state.match ?? {}), [k]: v }
              return done
            },
            then: (resolve: any) => {
              calls.push({ ...state })
              resolve({ error: null })
            },
          }
          return done
        },
        upsert: async (payload: any) => {
          calls.push({ table, op: 'upsert', payload })
          return { error: null }
        },
      }
      return chain
    },
  }
  return { admin, calls }
}

const input = quickStartInputSchema.parse({ businessName: '모모 카페', industry: '카페·디저트', summary: '동네 카페예요', tone: 'calm' })

describe('applyQuickStart', () => {
  it('creates profile, knowledge, text/image/policy rules for a brand-new workspace', async () => {
    const { admin, calls } = fakeAdmin()
    await applyQuickStart({ admin, workspaceId: 'w1', userId: 'u1', input })
    const inserts = calls.filter((c) => c.op === 'insert')
    expect(calls.some((c) => c.table === 'business_profiles' && c.op === 'upsert' && c.payload.business_name === '모모 카페')).toBe(true)
    expect(inserts.filter((c) => c.table === 'workspace_knowledge_harnesses')).toHaveLength(1)
    const rules = inserts.filter((c) => c.table === 'harness_rules').map((c) => c.payload.rule_type).sort()
    expect(rules).toEqual(['approval_policy', 'image_generation', 'text_generation'])
    const policy = inserts.find((c) => c.payload?.rule_type === 'approval_policy')!
    expect(policy.payload.structured_rule.publishApprovalLevel).toBe('ALWAYS_REQUIRE')
    expect(policy.payload.status).toBe('active')
    expect(policy.payload.approved_by_user_id).toBe('u1')
  })

  it('binds the chosen tone to the text rule', async () => {
    const { admin, calls } = fakeAdmin()
    await applyQuickStart({ admin, workspaceId: 'w1', userId: 'u1', input })
    const text = calls.find((c) => c.payload?.rule_type === 'text_generation')!
    expect(text.payload.structured_rule.tonePreset).toBe('calm')
    expect(text.payload.structured_rule.brandVoice).toContain('담백')
  })

  it('updates in place instead of inserting duplicates, and never overwrites existing image/policy rules', async () => {
    const { admin, calls } = fakeAdmin({ knowledge: true, rules: ['text_generation', 'image_generation', 'approval_policy'] })
    await applyQuickStart({ admin, workspaceId: 'w1', userId: 'u1', input })
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0)
    const ruleUpdates = calls.filter((c) => c.table === 'harness_rules' && c.op === 'update')
    expect(ruleUpdates).toHaveLength(1)
    expect(ruleUpdates[0].payload.structured_rule.tonePreset).toBe('calm')
  })

  it('saves partial shop input without confirming rules or generating content', async () => {
    const { admin, calls } = fakeAdmin()
    await saveQuickStartProgress({ admin, workspaceId: 'w1', input: { businessName: '가입한 가게', industry: '', location: '', summary: '' } })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'business_profiles', op: 'upsert', payload: { workspace_id: 'w1', business_name: '가입한 가게', industry: null } })
  })

  it('retains the owner marketing goal separately from factual shop summary', async () => {
    const { admin, calls } = fakeAdmin()
    const withGoal = quickStartInputSchema.parse({ ...input, goal: '이번 주 새 메뉴 알리기' })
    await applyQuickStart({ admin, workspaceId: 'w1', userId: 'u1', input: withGoal })
    const knowledge = calls.find(c => c.table === 'workspace_knowledge_harnesses' && c.op === 'insert')!
    expect(knowledge.payload.business_identity).toMatchObject({ marketingGoal: '이번 주 새 메뉴 알리기', source: 'quick-start' })
    expect(calls.find(c => c.table === 'business_profiles')!.payload.summary).toBe(input.summary)
  })

  it('rejects empty required fields with Korean messages', () => {
    const r = quickStartInputSchema.safeParse({ businessName: '', industry: '', summary: '' })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].message).toContain('매장 이름')
  })

  it('사업자·운영 정보가 함께 오면 workspace_business_details 에 upsert 한다', async () => {
    const { admin, calls } = fakeAdmin()
    const withDetails = quickStartInputSchema.parse({
      businessName: '모모 카페',
      industry: '카페·디저트',
      summary: '동네 카페예요',
      tone: 'calm',
      businessDetails: {
        businessNumber: '000-00-00000',
        representativeName: '홍길동',
        businessStartDate: '20190301',
        businessHours: '평일 10:00~19:00',
        parkingInfo: '매장 앞 2대',
        priceRange: '1인 3~5만원',
      },
    })

    await applyQuickStart({ admin, workspaceId: 'w1', userId: 'u1', input: withDetails })

    const details = calls.find((c) => c.table === 'workspace_business_details' && c.op === 'upsert')
    expect(details).toBeDefined()
    expect(details!.payload).toMatchObject({
      workspace_id: 'w1',
      business_number: '0000000000',
      representative_name: '홍길동',
      business_start_date: '20190301',
      business_hours: '평일 10:00~19:00',
      parking_info: '매장 앞 2대',
      price_range: '1인 3~5만원',
      intake_source: 'manual',
    })
  })

  it('비워둔 사업자·운영 항목은 빈 문자열이 아니라 NULL 로 저장한다', async () => {
    const { admin, calls } = fakeAdmin()
    const partial = quickStartInputSchema.parse({
      businessName: '모모 카페',
      industry: '카페·디저트',
      summary: '동네 카페예요',
      businessDetails: { parkingInfo: '매장 앞 2대' },
    })

    await applyQuickStart({ admin, workspaceId: 'w1', userId: 'u1', input: partial })
    const details = calls.find((c) => c.table === 'workspace_business_details' && c.op === 'upsert')
    expect(details!.payload.parking_info).toBe('매장 앞 2대')
    expect(details!.payload.business_number).toBeNull()
    expect(details!.payload.business_hours).toBeNull()
    expect(details!.payload.representative_name).toBeNull()
  })

  it('사업자·운영 정보를 안 보내면 해당 테이블을 건드리지 않는다 (기존 흐름 회귀 없음)', async () => {
    const { admin, calls } = fakeAdmin()
    await applyQuickStart({ admin, workspaceId: 'w1', userId: 'u1', input })
    expect(calls.some((c) => c.table === 'workspace_business_details')).toBe(false)
  })
})
