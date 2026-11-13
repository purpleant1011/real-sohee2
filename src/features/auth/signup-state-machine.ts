import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { bootstrapWorkspaceTrial } from "./trial-bootstrap"

export type SignupState =
  | 'FORM_REQUIRED'
  | 'BUSINESS_REQUIRED'
  | 'BUSINESS_PENDING'
  | 'BUSINESS_VERIFIED'
  | 'BUSINESS_REJECTED'
  | 'MANUAL_REVIEW'
  | 'VERIFICATION_PENDING'
  | 'AGREEMENT_REQUIRED'
  | 'TASTE_READY'
  | 'TASTE_ACTIVE'
  | 'TASTE_LOW'
  | 'TASTE_CRITICAL'
  | 'TASTE_EXHAUSTED'
  | 'CHECKOUT_PENDING'
  | 'PAID_ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'SUSPENDED'
  | 'TRIAL_READY' // backwards-compatible alias for TASTE_READY
  | 'COMPLETED'
  | 'REJECTED'

export interface SignupApplicationRecord {
  id: string
  user_id: string
  workspace_id?: string | null
  state: SignupState
  business_number?: string | null
  company_name?: string | null
  representative_name?: string | null
  agreements_completed: boolean
  completed_at?: string | null
  created_at: string
  updated_at: string
}

export interface AgreementSubmission {
  termsOfService: boolean
  privacyPolicy: boolean
  aiDataProcessing: boolean
  channelDelegation: boolean
}

export interface FreeTasteActivationResult {
  success: boolean
  workspaceId: string
  energyGranted: number
  planTier: 'FREE_TASTE'
  isNewWorkspace: boolean
  verificationStatus?: 'VERIFIED' | 'PENDING'
  error?: string
}

/**
 * 사용자 가입 상태 머신 조회 또는 초기화 (FORM_REQUIRED)
 */
export async function getOrCreateSignupApplication(
  supabase: SupabaseClient,
  userId: string
): Promise<SignupApplicationRecord> {
  const { data: existing, error: selectErr } = await supabase
    .from('signup_applications')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) {
    return existing as SignupApplicationRecord
  }

  // 없으면 새로 생성
  const { data: created, error: insertErr } = await supabase
    .from('signup_applications')
    .insert({
      user_id: userId,
      state: 'FORM_REQUIRED',
      agreements_completed: false
    })
    .select('*')
    .single()

  if (insertErr || !created) {
    console.error('[signup-state-machine] Failed to initialize signup application:', insertErr)
    throw new Error('가입 상태 정보를 초기화하지 못했습니다.')
  }

  return created as SignupApplicationRecord
}

/**
 * 1단계: 사업자 정보 등록 및 BUSINESS_PENDING / AGREEMENT_REQUIRED 전이
 */
export async function updateSignupBusinessInfo(
  supabase: SupabaseClient,
  userId: string,
  businessInfo: {
    businessNumber: string
    companyName: string
    representativeName: string
    startDate?: string
    isVerified: boolean
    validationStatus?: string
  }
): Promise<SignupApplicationRecord> {
  let nextState: SignupState = 'BUSINESS_PENDING'
  if (businessInfo.isVerified) {
    nextState = 'AGREEMENT_REQUIRED'
  } else if (businessInfo.validationStatus === 'PENDING_REVIEW' || businessInfo.validationStatus === 'MANUAL_REVIEW') {
    nextState = 'MANUAL_REVIEW'
  }

  const { data: updated, error } = await supabase
    .from('signup_applications')
    .update({
      business_number: businessInfo.businessNumber,
      company_name: businessInfo.companyName,
      representative_name: businessInfo.representativeName,
      start_date: businessInfo.startDate ? businessInfo.startDate.replace(/[^0-9]/g, '') : null,
      state: nextState,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error || !updated) {
    throw new Error(`사업자 정보 업데이트 실패: ${error?.message}`)
  }

  return updated as SignupApplicationRecord
}

/**
 * 2단계: 개별 필수 약관 및 채널 위임 동의 저장 (ANI-557, ANI-733)
 */
export async function submitSignupAgreements(
  supabase: SupabaseClient,
  userId: string,
  agreements: AgreementSubmission,
  ipAddress?: string
): Promise<SignupApplicationRecord> {
  if (
    !agreements.termsOfService ||
    !agreements.privacyPolicy ||
    !agreements.aiDataProcessing ||
    !agreements.channelDelegation
  ) {
    const err: any = new Error('모든 필수 약관 및 AI 채널 운영 위임에 동의해야 합니다.')
    err.statusCode = 400
    throw err
  }

  const app = await getOrCreateSignupApplication(supabase, userId)

  // [ANI-733, ANI-1334, ANI-1424 P0 Invariant]
  // 허용 상태:
  // 1) AGREEMENT_REQUIRED -> 정상 NTS 인증 완료 후 약관 최초 제출 -> TASTE_READY로 전이
  // 2) MANUAL_REVIEW -> NTS 키 부재 또는 수동 심사 요청 상태에서 약관 최초 제출 -> VERIFICATION_PENDING으로 전이
  // 3) VERIFICATION_PENDING / TASTE_READY -> 이전 시도에서 약관 완료 후 후속 활성화 실패 시 재시도 (멱등성 보장, 데드락 방지)
  const isInitialAgreement = app.state === 'AGREEMENT_REQUIRED' || app.state === 'MANUAL_REVIEW'
  const isRetryAgreement = (app.state === 'VERIFICATION_PENDING' || app.state === 'TASTE_READY' || app.agreements_completed) && !app.workspace_id

  if (!isInitialAgreement && !isRetryAgreement) {
    if (app.state === 'BUSINESS_PENDING') {
      const err: any = new Error('국세청 사업자 진위확인이 대기 중이거나 완료되지 않아(BUSINESS_PENDING) 약관 동의를 완료할 수 없습니다. (ANI-733)')
      err.statusCode = 409
      throw err
    }
    const err: any = new Error(`현재 상태(${app.state})에서는 약관 동의를 진행할 수 없습니다. 사업자 인증을 먼저 완료해 주세요. (ANI-733)`)
    err.statusCode = 400
    throw err
  }

  // [ANI-603] 플레이스홀더(0000000000) 또는 누락된 사업자 정보 상태에서 약관 동의 진입 차단
  if (!app.business_number || app.business_number === '0000000000' || !app.company_name) {
    const err: any = new Error('유효한 사업자 인증 정보(상호명, 사업자번호)가 등록되지 않아 약관 동의를 완료할 수 없습니다. (ANI-603)')
    err.statusCode = 400
    throw err
  }

  const agreementsList = [
    { type: 'TERMS_OF_SERVICE', version: '2026.09-v1' },
    { type: 'PRIVACY_POLICY', version: '2026.09-v1' },
    { type: 'AI_DATA_PROCESSING', version: '2026.09-v1' },
    { type: 'CHANNEL_OPERATION_DELEGATION', version: '2026.09-v1' },
  ]

  // user_agreements에 개별 버전화 저장 (pre-workspace는 null 또는 실제 wsId 사용, zero-UUID 금지: ANI-576)
  const actualWsId = app.workspace_id || null

  for (const ag of agreementsList) {
    const { error: upsertErr } = await (supabase as any).from('user_agreements').upsert(
      {
        workspace_id: actualWsId,
        user_id: userId,
        agreement_type: ag.type,
        version: ag.version,
        agreed: true,
        agreed_at: new Date().toISOString(),
        ip_address: ipAddress || null
      },
      { onConflict: 'user_id,agreement_type,version' }
    )

    if (upsertErr) {
      console.error(`[completeAgreements] Agreement save failed for ${ag.type}:`, upsertErr);
      throw new Error(`약관 동의(${ag.type}) 저장에 실패했습니다. (${upsertErr.message})`);
    }
  }

  // [ANI-727, ANI-1334, ANI-1424] 계약에 따라 TASTE_READY 또는 VERIFICATION_PENDING으로 전이 (재시도 시 기존 상태 유지)
  let nextState: SignupState
  if (app.state === 'MANUAL_REVIEW' || app.state === 'VERIFICATION_PENDING') {
    nextState = 'VERIFICATION_PENDING'
  } else if (app.state === 'AGREEMENT_REQUIRED' || app.state === 'TASTE_READY') {
    nextState = 'TASTE_READY'
  } else {
    nextState = app.state
  }

  const { data: updated, error } = await supabase
    .from('signup_applications')
    .update({
      agreements_completed: true,
      state: nextState,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error || !updated) {
    throw new Error('약관 동의 완료 처리 실패')
  }

  return updated as SignupApplicationRecord
}

/**
 * 3단계: 약 ₩5,000 상당의 Free Taste Energy 1회 원자적 활성화 (ANI-706, ANI-727, ANI-733)
 */
export async function finalizeSignupAndActivateFreeTaste(
  supabase: SupabaseClient,
  userId: string,
  provider: string = 'google',
  options?: { adminClient?: any }
): Promise<FreeTasteActivationResult> {
  const app = await getOrCreateSignupApplication(supabase, userId)

  const isVerifiedTaste = app.state === 'TASTE_READY' || app.state === 'TRIAL_READY'
  const isVerificationPending = app.state === 'VERIFICATION_PENDING'

  // [ANI-733, ANI-1334 P0 Invariant] TASTE_READY/TRIAL_READY 또는 VERIFICATION_PENDING 상태만 허용
  if (!isVerifiedTaste && !isVerificationPending) {
    const err: any = new Error(`현재 상태(${app.state})에서는 무료 맛보기 Energy를 활성화할 수 없습니다. 사업자 검증과 필수 동의(TASTE_READY)를 먼저 완료해 주세요. (ANI-733)`)
    err.statusCode = 403
    throw err
  }

  if (!app.agreements_completed) {
    const err: any = new Error('필수 약관 및 채널 위임 동의가 완료되지 않아 무료 맛보기 Energy를 시작할 수 없습니다.')
    err.statusCode = 400
    throw err
  }

  if (!app.business_number || app.business_number === '0000000000') {
    const err: any = new Error('유효한 사업자등록번호가 등록되지 않아 맛보기 Energy를 활성화할 수 없습니다. (ANI-733)')
    err.statusCode = 400
    throw err
  }

  // [ANI-733 & ANI-727 Anti-Abuse Invariant]
  // 동일 사업자등록번호로 이미 VERIFIED 워크스페이스가 생성되어 무료 지원금이 지급된 이력이 있는지 확인
  if (isVerifiedTaste) {
    let dupQuery: any = supabase
      .from('business_verifications')
      .select('workspace_id, status')
      .eq('business_number', app.business_number)
      .eq('status', 'VERIFIED')

    if (dupQuery && typeof dupQuery.not === 'function') {
      dupQuery = dupQuery.not('workspace_id', 'is', null)
    }
    if (dupQuery && typeof dupQuery.limit === 'function') {
      dupQuery = dupQuery.limit(1)
    }

    const { data: existingVerified, error: dupCheckErr } = await (dupQuery || Promise.resolve({ data: null, error: null }))

    if (!dupCheckErr && existingVerified && Array.isArray(existingVerified) && existingVerified.length > 0 && existingVerified[0]?.workspace_id) {
      const err: any = new Error('이미 소희 무료 맛보기 혜택이 지급된 사업자등록번호입니다. 사업자당 1회의 무료 지원금만 제공됩니다. (ANI-733)')
      err.statusCode = 409
      throw err
    }
  }

  // 1. [HF-05, ANI-1354 & HF-51] 단일 원자적 Postgres RPC 호출: 교육용 워크스페이스 프로비저닝 (Strict single-path, NO fail-open fallback)
  // HF-51: authenticated 직접 호출 차단에 따라 service_role admin 클라이언트를 우선 사용 (단, 테스트 목 클라이언트는 존중)
  const isMockClient = Boolean((supabase as any).rpc?.mock || (supabase as any)._isMock);
  let rpcClient: any = options?.adminClient;
  if (!rpcClient) {
    if (isMockClient) {
      rpcClient = supabase;
    } else {
      try {
        rpcClient = createAdminSupabaseClient();
      } catch {
        rpcClient = supabase;
      }
    }
  }
  const eduRes = await rpcClient.rpc(
    'provision_education_workspace',
    {
      p_user_id: userId,
      p_workspace_name: app.company_name || '나의 소희 마케팅',
      p_provider: provider || 'google'
    }
  )

  if (eduRes.error) {
    console.error('[finalizeSignupAndActivateFreeTaste] provision_education_workspace failed:', eduRes.error)
    const err: any = new Error(eduRes.error.message || '교육용 워크스페이스 생성 및 온보딩 설정에 실패했습니다.')
    if (eduRes.error.code === '42501') {
      err.statusCode = 403
    } else if (eduRes.error.code === '23505' || eduRes.error.message?.includes('이미')) {
      err.statusCode = 409
    } else {
      err.statusCode = 500
    }
    throw err
  }

  const rpcResult = eduRes.data

  if (rpcResult?.workspace_id) {
    try {
      let starterAdmin: any
      try {
        starterAdmin = createAdminSupabaseClient()
      } catch {
        starterAdmin = rpcClient
      }
      await starterAdmin.rpc('ensure_signup_starter_credits', {
        p_user_id: userId,
        p_workspace_id: rpcResult.workspace_id,
      })
    } catch (starterErr) {
      console.warn('[finalizeSignupAndActivateFreeTaste] ensure_signup_starter_credits failed:', starterErr)
    }
  }

  return {
    success: true,
    workspaceId: rpcResult.workspace_id,
    energyGranted: rpcResult.energy_granted,
    planTier: rpcResult.plan_tier || 'FREE_TASTE',
    isNewWorkspace: rpcResult.is_new_workspace ?? true,
    verificationStatus: rpcResult.verification_status,
  }
}

/**
 * 하위 호환성 래퍼: 기존 finalizeSignupAndActivateTrial 호출을 Free Taste 활성화로 안전하게 연결
 */
export async function finalizeSignupAndActivateTrial(
  supabase: SupabaseClient,
  userId: string,
  provider: string = 'google'
): Promise<{ success: boolean; workspaceId: string; creditsGranted?: number; energyGranted?: number; planTier?: string }> {
  const res = await finalizeSignupAndActivateFreeTaste(supabase, userId, provider)
  return {
    success: res.success,
    workspaceId: res.workspaceId,
    energyGranted: res.energyGranted,
    creditsGranted: res.energyGranted,
    planTier: res.planTier
  }
}

/**
 * Google OAuth 등으로 로그인한 사용자의 기본 프로필 레코드를 보장 (ANI-1334)
 */
export async function ensureUserProfile(
  supabase: SupabaseClient,
  user: { id: string; user_metadata?: Record<string, any>; email?: string }
): Promise<void> {
  if (!user || !user.id) return

  const displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split('@')[0] ||
    '소희 사용자'

  await supabase
    .from('profiles')
    .upsert(
      {
        id: user.id,
        display_name: displayName,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'id', ignoreDuplicates: true }
    )
}
