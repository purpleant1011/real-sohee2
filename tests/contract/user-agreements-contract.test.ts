import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// 실제 인증과 약관 upsert/delete가 필요하므로 명시적으로 격리된 로컬 Supabase
// 스택이 없으면 skip한다. 기본 CI에서 운영 DB로 자동 접속하지 않는다.
const hasLocalSupabase = process.env.SOHEE_LOCAL_SUPABASE_TESTS === '1'
  && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(SUPABASE_URL)
  && !!SUPABASE_KEY && SUPABASE_KEY !== 'sb_publishable_test_mock_token_12345'

describe.skipIf(!hasLocalSupabase)('Contract: user_agreements PostgREST Upsert & Schema Invariants (P0-1)', () => {
  let client: SupabaseClient
  let userId: string
  const agreementType = 'TERMS_OF_SERVICE'
  const testVersion = '2026.09-contract-test'

  beforeAll(async () => {
    client = createClient(SUPABASE_URL, SUPABASE_KEY!)
    const { data, error } = await client.auth.signInWithPassword({
      email: 'contract_test_1789101220182@example.com',
      password: 'Password123!@#'
    })
    if (error || !data.user) {
      throw new Error(`Auth failed for contract test: ${error?.message}`)
    }
    userId = data.user.id
  })

  afterAll(async () => {
    if (client && userId) {
      await client
        .from('user_agreements')
        .delete()
        .eq('user_id', userId)
        .eq('version', testVersion)
    }
  })

  it('[P0-1] allows pre-workspace upsert with workspace_id = null without 42P10 schema conflict', async () => {
    // 1. Pre-workspace 약관 저장 (workspace_id = null)
    const { data: insertData, error: insertError } = await client
      .from('user_agreements')
      .upsert(
        {
          workspace_id: null,
          user_id: userId,
          agreement_type: agreementType,
          version: testVersion,
          agreed: true,
          ip_address: '127.0.0.1'
        },
        { onConflict: 'user_id,agreement_type,version' }
      )
      .select()

    expect(insertError).toBeNull()
    expect(insertData).toBeDefined()
    expect(insertData?.length).toBe(1)
    expect(insertData?.[0].workspace_id).toBeNull()
    expect(insertData?.[0].user_id).toBe(userId)
    expect(insertData?.[0].agreement_type).toBe(agreementType)
    expect(insertData?.[0].version).toBe(testVersion)
  })

  it('[P0-1] performs idempotent update when upserting same user_id, agreement_type, version', async () => {
    // 2. 동일한 약관 재전송 시 멱등적 업데이트 (중복 insert 에러 0)
    const { data: updateData, error: updateError } = await client
      .from('user_agreements')
      .upsert(
        {
          workspace_id: null,
          user_id: userId,
          agreement_type: agreementType,
          version: testVersion,
          agreed: true,
          ip_address: '192.168.1.1'
        },
        { onConflict: 'user_id,agreement_type,version' }
      )
      .select()

    expect(updateError).toBeNull()
    expect(updateData).toBeDefined()
    expect(updateData?.length).toBe(1)
    expect(updateData?.[0].ip_address).toBe('192.168.1.1')
  })

  it('[P0-1] correctly queries agreements by user_id and version', async () => {
    // 3. 사용자 및 버전 기반 정확한 조회 확인
    const { data: queryData, error: queryError } = await client
      .from('user_agreements')
      .select('*')
      .eq('user_id', userId)
      .eq('version', testVersion)

    expect(queryError).toBeNull()
    expect(queryData?.length).toBe(1)
    expect(queryData?.[0].agreement_type).toBe(agreementType)
  })
})
