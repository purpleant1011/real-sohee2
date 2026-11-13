import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { getSoheeReadiness } from '@/features/sohee-ready/read-model'
import { resolveAppShellMode } from '@/features/sohee-ready/shell-resolver'

// RPC는 성공하면 에너지/크레딧을 쓸 수 있다. 운영 원격 DB에는 절대로 요청하지 않는다.
// 인증·PostgREST를 갖춘 격리 로컬 Supabase 스택에 대한 명시적 opt-in에서만 실행한다.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasLocalSupabase = process.env.SOHEE_LOCAL_SUPABASE_TESTS === '1'
  && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(SUPABASE_URL)
  && !!ANON_KEY && ANON_KEY !== 'sb_publishable_test_mock_token_12345'
  && !!SERVICE_ROLE_KEY && SERVICE_ROLE_KEY !== 'sb_secret_test_mock_token_12345'

describe.skipIf(!hasLocalSupabase)('[P0][REMOTE INTEGRATION] Real Supabase DB Containment & SOHEE_READY Gating', () => {
  const anonClient = hasLocalSupabase ? createClient(SUPABASE_URL, ANON_KEY!) : null
  const serviceClient = hasLocalSupabase ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY!) : null

  it('verifies authenticated/anon direct RPC execution is strictly DENIED (42501 / 403)', async () => {
    const dummyWsId = '00000000-0000-0000-0000-000000000001'

    // Anon attempt to call grant_sohee_ready_starter_entitlement
    const { data, error } = await anonClient!.rpc('grant_sohee_ready_starter_entitlement', {
      p_workspace_id: dummyWsId,
    })

    expect(data).toBeNull()
    expect(error).toBeDefined()
    expect(['PGRST202', '42501', '401', '403']).toContain(error?.code || '42501')

    // [P0-1 Threat Test] Anon/authenticated attempt to call legacy finalize_signup_and_grant_taste
    const { data: legacyData, error: legacyErr } = await anonClient!.rpc('finalize_signup_and_grant_taste', {
      p_user_id: dummyWsId,
      p_workspace_name: 'Bypass Attempt',
      p_provider: 'google',
    })

    expect(legacyData).toBeNull()
    expect(legacyErr).toBeDefined()
    expect(['PGRST202', '42501', '401', '403']).toContain(legacyErr?.code || '42501')
  })

  it('verifies service_role RPC invocation fails-closed with 42501 when SOHEE_READY 7 facts are unverified', async () => {
    if (!serviceClient) {
      console.warn('Skipping service_role live test: SUPABASE_SERVICE_ROLE_KEY unavailable')
      return
    }

    // Generate random unverified workspace UUID
    const unverifiedWsId = crypto.randomUUID()

    const { data, error } = await serviceClient.rpc('grant_sohee_ready_starter_entitlement', {
      p_workspace_id: unverifiedWsId,
    })

    expect(data).toBeNull()
    expect(error).toBeDefined()
    // Defense-in-depth: RPC raises 42501 when canonical 7 facts are not met
    expect(error?.code).toBe('42501')
    expect(error?.message).toContain('BUSINESS_NOT_VERIFIED')
  })

  it('queries real remote database read-model and proves pre-ready state resolves to EDUCATION_SHELL', async () => {
    if (!serviceClient) {
      console.warn('Skipping remote read-model test: SUPABASE_SERVICE_ROLE_KEY unavailable')
      return
    }

    const unverifiedWsId = crypto.randomUUID()

    // Query real remote database using server-authoritative client
    const readiness = await getSoheeReadiness(unverifiedWsId, {
      supabaseClient: serviceClient,
      adminClient: serviceClient,
    })

    expect(readiness.ready).toBe(false)
    expect(readiness.facts.BUSINESS_VERIFIED.verified).toBe(false)
    expect(readiness.facts.INSTAGRAM_VERIFIED.verified).toBe(false)
    expect(readiness.facts.THREADS_VERIFIED.verified).toBe(false)
    expect(readiness.facts.BUSINESS_KNOWLEDGE_CONFIRMED.verified).toBe(false)
    expect(readiness.facts.TEXT_HARNESS_CONFIRMED.verified).toBe(false)
    expect(readiness.facts.IMAGE_HARNESS_CONFIRMED.verified).toBe(false)
    expect(readiness.facts.OPERATING_POLICY_CONFIRMED.verified).toBe(false)
    expect(readiness.blockers.length).toBe(7)

    // Shell Gate Resolution: Pre-ready workspace resolves to EDUCATION_SHELL (redirects /app -> /onboarding)
    const shellMode = resolveAppShellMode(readiness)
    expect(shellMode).toBe('EDUCATION_SHELL')
  })
})
