import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// 인증/RLS 공격 회귀 테스트는 실제 PostgREST 및 격리된 DB가 있어야 의미가 있다.
// 운영 DB에 INSERT/UPDATE하지 않도록 로컬 Supabase 스택의 명시적 opt-in만 허용한다.
const hasLocalSupabase = process.env.SOHEE_LOCAL_SUPABASE_TESTS === '1'
  && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(SUPABASE_URL)
  && !!SUPABASE_KEY && SUPABASE_KEY !== 'sb_publishable_test_mock_token_12345'

describe.skipIf(!hasLocalSupabase)('Security RLS Lockdown: Energy & Business Verification Mutation Attack Regression (P0-2)', () => {
  let authenticatedClient: SupabaseClient
  let userId: string

  beforeAll(async () => {
    // 실제 authenticated 세션 로그인
    authenticatedClient = createClient(SUPABASE_URL, SUPABASE_KEY!)
    const { data, error } = await authenticatedClient.auth.signInWithPassword({
      email: 'contract_test_1789101220182@example.com',
      password: 'Password123!@#'
    })
    if (error || !data.user) {
      throw new Error(`Auth failed for security test: ${error?.message}`)
    }
    userId = data.user.id
  })

  it('[REG-SIGNUP-SEC-001] authenticated client CANNOT directly UPDATE or INSERT business_verifications', async () => {
    const fakeWorkspaceId = '00000000-0000-0000-0000-000000000001'

    // 1. 악의적 직접 UPDATE 공격 시도
    const { data: updateData, error: updateError } = await authenticatedClient
      .from('business_verifications')
      .update({ status: 'VERIFIED', verified_at: new Date().toISOString() })
      .eq('workspace_id', fakeWorkspaceId)
      .select()

    // RLS에 의해 차단되므로 반환 데이터는 비어있거나 에러 발생
    expect(updateData === null || updateData.length === 0).toBe(true)

    // 2. 악의적 직접 INSERT 공격 시도
    const { data: insertData, error: insertError } = await authenticatedClient
      .from('business_verifications')
      .insert({
        workspace_id: fakeWorkspaceId,
        business_number: '1234567890',
        company_name: '해킹매장',
        representative_name: '해커',
        status: 'VERIFIED'
      })
      .select()

    expect(insertError).toBeDefined()
    expect(insertData).toBeNull()
  })

  it('[REG-ENERGY-SEC-001] authenticated client CANNOT directly UPDATE agent_energy_ledgers', async () => {
    const fakeWorkspaceId = '00000000-0000-0000-0000-000000000001'

    // 악의적 에너지 잔여량 999,999 조작 시도
    const { data: hackData, error: hackError } = await authenticatedClient
      .from('agent_energy_ledgers')
      .update({
        remaining_available_energy: 999999,
        monthly_total_energy: 999999
      })
      .eq('workspace_id', fakeWorkspaceId)
      .select()

    expect(hackData === null || hackData.length === 0).toBe(true)

    // 직접 INSERT 시도
    const { data: insertData, error: insertError } = await authenticatedClient
      .from('agent_energy_ledgers')
      .insert({
        workspace_id: fakeWorkspaceId,
        remaining_available_energy: 999999,
        monthly_total_energy: 999999,
        plan_tier: 'ENTERPRISE'
      })
      .select()

    expect(insertError).toBeDefined()
    expect(insertData).toBeNull()
  })

  it('[REG-ENERGY-SEC-002] authenticated client CANNOT directly INSERT agent_energy_transactions', async () => {
    const fakeWorkspaceId = '00000000-0000-0000-0000-000000000001'

    // 가짜 충전 트랜잭션 날조 시도
    const { data: txData, error: txError } = await authenticatedClient
      .from('agent_energy_transactions')
      .insert({
        transaction_id: `tx_fake_${Date.now()}`,
        workspace_id: fakeWorkspaceId,
        pack_count: 99,
        paid_amount_krw: 0,
        added_energy: 99999
      })
      .select()

    expect(txError).toBeDefined()
    expect(txData).toBeNull()
  })

  it('[REG-FREE-TASTE-SEC-001] authenticated client CANNOT directly INSERT or UPDATE free_taste_claims', async () => {
    const fakeWorkspaceId = '00000000-0000-0000-0000-000000000001'

    // 가짜 클레임 생성 시도
    const { data: claimData, error: claimError } = await authenticatedClient
      .from('free_taste_claims')
      .insert({
        business_number: '1234567890',
        benefit_type: 'FREE_TASTE_50',
        workspace_id: fakeWorkspaceId,
        claimed_by: userId,
        energy_granted: 50
      })
      .select()

    expect(claimError).toBeDefined()
    expect(claimData).toBeNull()
  })
})
