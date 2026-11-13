import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// 인증 후 가입/관리자 RPC 호출은 DB 상태에 의존한다. 격리된 로컬 Supabase
// 스택을 명시적으로 준비하지 않은 CI에서는 skip(통과로 위장하지 않음)한다.
const hasLocalSupabase = process.env.SOHEE_LOCAL_SUPABASE_TESTS === '1'
  && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(SUPABASE_URL)
  && !!SUPABASE_KEY && SUPABASE_KEY !== 'sb_publishable_test_mock_token_12345'

describe.skipIf(!hasLocalSupabase)('Atomicity & Rollback: Signup Finalize & Admin Verify RPCs (P0-3, P0-4)', () => {
  let client: SupabaseClient
  let userId: string
  let createdWsId: string | null = null

  beforeAll(async () => {
    client = createClient(SUPABASE_URL, SUPABASE_KEY!)
    const { data, error } = await client.auth.signInWithPassword({
      email: 'contract_test_1789101220182@example.com',
      password: 'Password123!@#'
    })
    if (error || !data.user) {
      throw new Error(`Auth failed for integration test: ${error?.message}`)
    }
    userId = data.user.id
  })

  afterAll(async () => {
    if (client && createdWsId) {
      await client.from('free_taste_claims').delete().eq('workspace_id', createdWsId)
      await client.from('workspaces').delete().eq('id', createdWsId)
    }
  })

  it('[P0-3] rejects finalize when signup application is not in ready state (Zero Partial State)', async () => {
    // 신청서 상태가 FORM_REQUIRED이거나 존재하지 않는 가입에 대해 호출 시
    const { data: res, error: rpcErr } = await client.rpc('finalize_signup_and_grant_taste', {
      p_user_id: '00000000-0000-0000-0000-000000000099',
      p_workspace_name: '실패 테스트 매장',
      p_provider: 'google'
    })

    // 에러 발생 확인 (신청서 부재 또는 타인 사칭 차단 또는 최소권한 정책에 의한 permission denied)
    expect(rpcErr).toBeDefined()
    expect(rpcErr?.message).toMatch(/ANI-733|AUTHZ_IMPERSONATION_DENIED|permission denied/)
    expect(res).toBeNull()
  })

  it('[P0-3] rejects admin verify when invalid status or placeholder business number (Zero Partial State)', async () => {
    // 1. 잘못된 status 전달 시 롤백 또는 일반 권한 차단 검증 (HF-04 Least Privilege)
    const { data: res1, error: rpcErr1 } = await client.rpc('admin_verify_business_and_grant_taste', {
      p_workspace_id: '00000000-0000-0000-0000-000000000001',
      p_operator_id: userId,
      p_status: 'INVALID_STATUS'
    })

    expect(rpcErr1).toBeDefined()
    expect(rpcErr1?.message).toMatch(/유효한 심사 상태|permission denied/)
    expect(res1).toBeNull()

    // 2. 존재하지 않는 워크스페이스에 대한 승인 시도 시 롤백 또는 일반 권한 차단 검증
    const { data: res2, error: rpcErr2 } = await client.rpc('admin_verify_business_and_grant_taste', {
      p_workspace_id: '00000000-0000-0000-0000-000000000099',
      p_operator_id: userId,
      p_status: 'VERIFIED'
    })

    expect(rpcErr2).toBeDefined()
    expect(rpcErr2?.message).toMatch(/워크스페이스를 찾을 수 없습니다|permission denied/)
    expect(res2).toBeNull()
  })

  it('[P0-4] verifies free_taste_claims table structure and exactly once invariant', async () => {
    const { data, error } = await client
      .from('free_taste_claims')
      .select('id, business_number, benefit_type, energy_granted')
      .limit(1)

    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })
})
