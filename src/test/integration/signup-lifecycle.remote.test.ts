import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { readIntegrationEnv } from './integration-env'

describe('Full Production E2E: 2 Major Lifecycle Verification Scenarios (P1-3)', () => {
  let userClient: SupabaseClient
  let adminClient: SupabaseClient
  let userId: string
  const runId = randomUUID().slice(0, 8)
  const createdWorkspaceIds: string[] = []
  const usedBusinessNumbers: string[] = []

  function generateValidBrn(): string {
    const digits = [
      Math.floor(Math.random() * 9) + 1,
      ...Array.from({ length: 8 }, () => Math.floor(Math.random() * 10))
    ]
    const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5]
    let sum = 0
    for (let i = 0; i < 9; i++) {
      sum += digits[i] * weights[i]
    }
    sum += Math.floor((digits[8] * 5) / 10)
    const checkDigit = (10 - (sum % 10)) % 10
    digits.push(checkDigit)
    return digits.join('')
  }

  const brnScenario1 = generateValidBrn()
  const brnScenario2 = generateValidBrn()
  usedBusinessNumbers.push(brnScenario1, brnScenario2)

  let ws1Id: string | null = null
  let ws2Id: string | null = null

  beforeAll(async () => {
    const env = readIntegrationEnv()
    adminClient = createClient(env.projectUrl, env.adminSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    userClient = createClient(env.projectUrl, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const { data, error } = await userClient.auth.signInWithPassword({
      email: 'contract_test_1789101220182@example.com',
      password: 'Password123!@#'
    })
    if (error || !data.user) {
      throw new Error(`Auth failed for E2E: ${error?.message}`)
    }
    userId = data.user.id
  })

  afterAll(async () => {
    if (adminClient) {
      for (const wsId of createdWorkspaceIds) {
        try {
          await adminClient.from('agent_energy_transactions').delete().eq('workspace_id', wsId)
          await adminClient.from('agent_energy_ledgers').delete().eq('workspace_id', wsId)
          await adminClient.from('trial_entitlements').delete().eq('workspace_id', wsId)
          await adminClient.from('workspace_credit_states').delete().eq('workspace_id', wsId)
          await adminClient.from('business_verifications').delete().eq('workspace_id', wsId)
          await adminClient.from('business_profiles').delete().eq('workspace_id', wsId)
          await adminClient.from('workspace_members').delete().eq('workspace_id', wsId)
          await adminClient.from('workspaces').delete().eq('id', wsId)
        } catch (e) {
          console.warn(`[Teardown] Error deleting workspace ${wsId}:`, e)
        }
      }

      if (usedBusinessNumbers.length > 0) {
        await adminClient.from('free_taste_claims').delete().in('business_number', usedBusinessNumbers)
      }

      if (userId) {
        await adminClient.from('signup_applications').delete().eq('user_id', userId)
        await adminClient.from('user_agreements').delete().eq('user_id', userId)
      }
    }
  })

  it('[Scenario 1] Real Verified Business: Form -> Verified -> Agreements -> Finalize -> 50 Energy & Claim Confirmed', async () => {
    const wsName = `[TEST-E2E-${runId}] 소희카페 강남본점`

    // 1. 가입 신청서를 TASTE_READY 상태로 셋업 (정식 인증 통과 상태)
    const { error: appErr } = await userClient
      .from('signup_applications')
      .upsert({
        user_id: userId,
        business_number: brnScenario1,
        company_name: wsName,
        representative_name: '홍길동',
        state: 'TASTE_READY',
        agreements_completed: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })

    expect(appErr).toBeNull()

    // 2. 약관 동의 레코드 저장 (P0-1 Contract)
    const { error: agErr } = await userClient
      .from('user_agreements')
      .upsert({
        workspace_id: null,
        user_id: userId,
        agreement_type: 'TERMS_OF_SERVICE',
        version: '2026.09-v1',
        agreed: true
      }, { onConflict: 'user_id,agreement_type,version' })

    expect(agErr).toBeNull()

    // 3. finalize_signup_and_grant_taste RPC 실행
    const { data: finalizeRes, error: finalizeErr } = await userClient.rpc('finalize_signup_and_grant_taste', {
      p_user_id: userId,
      p_workspace_name: wsName,
      p_provider: 'google'
    })

    expect(finalizeErr).toBeNull()
    expect(finalizeRes.success).toBe(true)
    expect(finalizeRes.energy_granted).toBe(50)
    expect(finalizeRes.verification_status).toBe('VERIFIED')
    ws1Id = finalizeRes.workspace_id
    createdWorkspaceIds.push(ws1Id!)

    // 4. Ground Truth DB 검증: 에너지 원장에 50 Energy 정확히 기록
    const { data: ledger } = await userClient
      .from('agent_energy_ledgers')
      .select('*')
      .eq('workspace_id', ws1Id)
      .single()

    expect(ledger.remaining_available_energy).toBe(50)
    expect(ledger.monthly_total_energy).toBe(50)

    // 5. Exactly-Once Invariant 검증: free_taste_claims에 등록 확인
    const { data: claim } = await userClient
      .from('free_taste_claims')
      .select('*')
      .eq('business_number', brnScenario1)
      .single()

    expect(claim).toBeDefined()
    expect(claim.energy_granted).toBe(50)
  })

  it('[Scenario 2] Manual Review Fallback: Form -> Pending Review -> Agreements -> Finalize (0 Energy) -> Admin Approve -> 50 Energy Granted', async () => {
    const wsName = `[TEST-E2E-${runId}] 소희베이커리 서초점`

    // 1. 가입 신청서를 VERIFICATION_PENDING 상태로 셋업 (수동심사 대기 상태)
    const { error: appErr } = await userClient
      .from('signup_applications')
      .upsert({
        user_id: userId,
        workspace_id: null,
        business_number: brnScenario2,
        company_name: wsName,
        representative_name: '이소희',
        state: 'VERIFICATION_PENDING',
        agreements_completed: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })

    expect(appErr).toBeNull()

    // 2. finalize_signup_and_grant_taste RPC 실행 (수동심사 대기 가입 완료)
    const { data: finalizeRes, error: finalizeErr } = await userClient.rpc('finalize_signup_and_grant_taste', {
      p_user_id: userId,
      p_workspace_name: wsName,
      p_provider: 'google'
    })

    expect(finalizeErr).toBeNull()
    expect(finalizeRes.success).toBe(true)
    // 핵심 보안 검증: 미승인 상태이므로 에너지는 0이어야 함!
    expect(finalizeRes.energy_granted).toBe(0)
    expect(finalizeRes.verification_status).toBe('PENDING')
    ws2Id = finalizeRes.workspace_id
    createdWorkspaceIds.push(ws2Id!)

    // 원장 확인: 0 Energy
    const { data: initialLedger } = await userClient
      .from('agent_energy_ledgers')
      .select('*')
      .eq('workspace_id', ws2Id)
      .single()

    expect(initialLedger.remaining_available_energy).toBe(0)

    // free_taste_claims 확인: 아직 청구되지 않았어야 함
    const { data: preClaims } = await userClient
      .from('free_taste_claims')
      .select('*')
      .eq('business_number', brnScenario2)

    expect(preClaims?.length).toBe(0)

    // 3. 관리자 콘솔 심사 승인: admin_verify_business_and_grant_taste RPC 실행
    const { data: adminRes, error: adminErr } = await adminClient.rpc('admin_verify_business_and_grant_taste', {
      p_workspace_id: ws2Id,
      p_operator_id: userId,
      p_status: 'VERIFIED',
      p_reason: '사업자등록증 실물 확인 완료'
    })

    expect(adminErr).toBeNull()
    expect(adminRes.success).toBe(true)
    expect(adminRes.status).toBe('VERIFIED')
    expect(adminRes.energy_granted).toBe(50)

    // 4. Ground Truth DB 검증: 관리자 승인 즉시 50 Energy 원장 반영 확인!
    const { data: postLedger } = await userClient
      .from('agent_energy_ledgers')
      .select('*')
      .eq('workspace_id', ws2Id)
      .single()

    expect(postLedger.remaining_available_energy).toBe(50)
    expect(postLedger.monthly_total_energy).toBe(50)

    // 5. Exactly-Once claim 등록 확인
    const { data: postClaim } = await userClient
      .from('free_taste_claims')
      .select('*')
      .eq('business_number', brnScenario2)
      .single()

    expect(postClaim).toBeDefined()
    expect(postClaim.energy_granted).toBe(50)
  })
})
