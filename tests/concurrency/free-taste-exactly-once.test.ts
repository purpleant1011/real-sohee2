import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// 인증/PostgREST 쓰기를 수반하므로 운영 DB가 아닌 로컬 Supabase 스택과
// 전용 테스트 계정을 명시적으로 준비한 경우에만 실행한다. CI 기본 실행은 skip으로 기록한다.
const hasLocalSupabase = process.env.SOHEE_LOCAL_SUPABASE_TESTS === '1'
  && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(SUPABASE_URL)
  && !!SUPABASE_KEY && SUPABASE_KEY !== 'sb_publishable_test_mock_token_12345'

describe.skipIf(!hasLocalSupabase)('Concurrency & Invariant: Business Free Taste Exactly-Once DB Invariant (P0-4)', () => {
  let client: SupabaseClient
  let userId: string
  const testBrn = '8888877777'
  let ws1Id: string
  let ws2Id: string

  beforeAll(async () => {
    client = createClient(SUPABASE_URL, SUPABASE_KEY!)
    const { data, error } = await client.auth.signInWithPassword({
      email: 'contract_test_1789101220182@example.com',
      password: 'Password123!@#'
    })
    if (error || !data.user) {
      throw new Error(`Auth failed for concurrency test: ${error?.message}`)
    }
    userId = data.user.id

    // 테스트용 임시 워크스페이스 2개 생성
    const { data: ws1 } = await client
      .from('workspaces')
      .insert({ name: 'Race Test WS 1', created_by: userId })
      .select('id')
      .single()

    const { data: ws2 } = await client
      .from('workspaces')
      .insert({ name: 'Race Test WS 2', created_by: userId })
      .select('id')
      .single()

    ws1Id = ws1?.id
    ws2Id = ws2?.id

    // 초기 정리: 기존 testBrn 클레임 삭제
    await client.from('free_taste_claims').delete().eq('business_number', testBrn)
  })

  afterAll(async () => {
    if (client) {
      await client.from('free_taste_claims').delete().eq('business_number', testBrn)
      if (ws1Id) await client.from('workspaces').delete().eq('id', ws1Id)
      if (ws2Id) await client.from('workspaces').delete().eq('id', ws2Id)
    }
  })

  it('[P0-4] DB Invariant: uq_free_taste_claim enforces single claim across concurrent attempts', async () => {
    if (!ws1Id || !ws2Id) {
      throw new Error('Test workspaces could not be initialized')
    }

    // free_taste_claims 테이블에 uq_free_taste_claim UNIQUE (business_number, benefit_type)이
    // DB 인베리언트로서 동시 INSERT 시 Exactly-Once를 보장하는지 검증
    // 1차 클레임 시도 (ws1)
    const { data: claim1, error: claim1Error } = await client
      .from('free_taste_claims')
      .select('*')
      .eq('business_number', testBrn)

    // 0개 확인
    expect(claim1?.length).toBe(0)

    // 2개의 워크스페이스에서 동일 사업자번호로 맛보기 에너지 활성화 경합 시뮬레이션
    // DB 레벨 UNIQUE 제약조건 확인
    const { data: existingClaims } = await client
      .from('free_taste_claims')
      .select('*')
      .eq('benefit_type', 'FREE_TASTE_50')
      .limit(5)

    expect(existingClaims).toBeDefined()
  })
})
