import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type {
  FieldProvenance,
  BusinessVerificationStatusType,
  BusinessVerificationLabelType,
  AgreementItemInfo,
  ResolvedBusinessInfo,
  SelfReportedBusinessDetails,
} from './business-info-types'

export type {
  FieldProvenance,
  BusinessVerificationStatusType,
  BusinessVerificationLabelType,
  AgreementItemInfo,
  ResolvedBusinessInfo,
  SelfReportedBusinessDetails,
} from './business-info-types'

export { sourceToKorean } from '@/components/admin-ui/labels'

interface SupabaseClientLike {
  from(table: string): any
}

/**
 * Server-only resolver for workspace business verification and identity information.
 * Resolves data across business_verifications, signup_applications, and business_profiles
 * with strict provenance tracking and cross-tenant leakage defense.
 */
export async function resolveWorkspaceBusinessInfo(
  workspaceId: string,
  client?: SupabaseClientLike,
): Promise<ResolvedBusinessInfo> {
  const admin = client ?? createAdminSupabaseClient()

  // 1. Fetch canonical business_verifications first
  const { data: verifData, error: verifError } = await admin
    .from('business_verifications')
    .select('company_name, representative_name, business_number, status, rejection_reason, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (verifError) {
    return {
      status: 'QUERY_ERROR',
      statusLabel: '조회 실패',
      companyName: { value: null, source: 'none', updatedAt: null },
      representativeName: { value: null, source: 'none', updatedAt: null },
      businessNumber: { value: null, source: 'none', updatedAt: null },
      startDate: { value: null, source: 'none', updatedAt: null },
      canonicalStatus: null,
      rejectionReason: null,
      hasDocument: false,
      submittedAt: null,
      identityState: 'UNREGISTERED',
      identityStateLabel: '가입 기록 없음',
      businessSubmissionState: 'QUERY_ERROR',
      businessSubmissionStateLabel: '조회 실패',
      legalConsentState: 'QUERY_ERROR',
      legalConsentStateLabel: '조회 실패',
      agreements: [],
      marketingConsent: null,
      naverPlace: null,
      selfReported: null,
      error: verifError,
    }
  }

  // 2. Fetch active workspace members to verify submitter authenticity for signup_applications
  const { data: membersData, error: membersError } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')

  if (membersError) {
    return {
      status: 'QUERY_ERROR',
      statusLabel: '조회 실패',
      companyName: { value: null, source: 'none', updatedAt: null },
      representativeName: { value: null, source: 'none', updatedAt: null },
      businessNumber: { value: null, source: 'none', updatedAt: null },
      startDate: { value: null, source: 'none', updatedAt: null },
      canonicalStatus: null,
      rejectionReason: null,
      hasDocument: false,
      submittedAt: null,
      identityState: 'UNREGISTERED',
      identityStateLabel: '가입 기록 없음',
      businessSubmissionState: 'QUERY_ERROR',
      businessSubmissionStateLabel: '조회 실패',
      legalConsentState: 'QUERY_ERROR',
      legalConsentStateLabel: '조회 실패',
      agreements: [],
      marketingConsent: null,
      naverPlace: null,
      selfReported: null,
      error: membersError,
    }
  }

  const validMemberUserIds = new Set<string>((membersData ?? []).map((m: { user_id: string }) => m.user_id))

  // 3. Fetch signup_applications scoped strictly to workspace_id
  const { data: signupAppData, error: signupAppError } = await admin
    .from('signup_applications')
    .select('workspace_id, user_id, company_name, representative_name, business_number, state, agreements_completed, completed_at, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (signupAppError) {
    return {
      status: 'QUERY_ERROR',
      statusLabel: '조회 실패',
      companyName: { value: null, source: 'none', updatedAt: null },
      representativeName: { value: null, source: 'none', updatedAt: null },
      businessNumber: { value: null, source: 'none', updatedAt: null },
      startDate: { value: null, source: 'none', updatedAt: null },
      canonicalStatus: null,
      rejectionReason: null,
      hasDocument: false,
      submittedAt: null,
      identityState: 'UNREGISTERED',
      identityStateLabel: '가입 기록 없음',
      businessSubmissionState: 'QUERY_ERROR',
      businessSubmissionStateLabel: '조회 실패',
      legalConsentState: 'QUERY_ERROR',
      legalConsentStateLabel: '조회 실패',
      agreements: [],
      marketingConsent: null,
      naverPlace: null,
      selfReported: null,
      error: signupAppError,
    }
  }

  // Strict check: submitter user_id MUST be a valid member of this workspace,
  // and workspace_id must match. Never match by user name or similar email!
  const isAuthenticSignupApp =
    signupAppData &&
    signupAppData.workspace_id === workspaceId &&
    validMemberUserIds.has(signupAppData.user_id)

  const verifiedSignupApp = isAuthenticSignupApp ? signupAppData : null

  // 4. Fetch business_profiles as secondary fallback for business_name
  const { data: profileData, error: profileError } = await admin
    .from('business_profiles')
    .select('business_name, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (profileError) {
    return {
      status: 'QUERY_ERROR',
      statusLabel: '조회 실패',
      companyName: { value: null, source: 'none', updatedAt: null },
      representativeName: { value: null, source: 'none', updatedAt: null },
      businessNumber: { value: null, source: 'none', updatedAt: null },
      startDate: { value: null, source: 'none', updatedAt: null },
      canonicalStatus: null,
      rejectionReason: null,
      hasDocument: false,
      submittedAt: null,
      identityState: 'UNREGISTERED',
      identityStateLabel: '가입 기록 없음',
      businessSubmissionState: 'QUERY_ERROR',
      businessSubmissionStateLabel: '조회 실패',
      legalConsentState: 'QUERY_ERROR',
      legalConsentStateLabel: '조회 실패',
      agreements: [],
      marketingConsent: null,
      naverPlace: null,
      selfReported: null,
      error: profileError,
    }
  }

  // Determine Field Provenance
  let companyName: FieldProvenance = { value: null, source: 'none', updatedAt: null }
  if (verifData?.company_name) {
    companyName = {
      value: verifData.company_name,
      source: 'business_verifications',
      updatedAt: verifData.updated_at ?? verifData.created_at ?? null,
    }
  } else if (verifiedSignupApp?.company_name) {
    companyName = {
      value: verifiedSignupApp.company_name,
      source: 'signup_applications',
      updatedAt: verifiedSignupApp.updated_at ?? verifiedSignupApp.created_at ?? null,
    }
  } else if (profileData?.business_name) {
    companyName = {
      value: profileData.business_name,
      source: 'business_profiles',
      updatedAt: profileData.updated_at ?? profileData.created_at ?? null,
    }
  }

  let representativeName: FieldProvenance = { value: null, source: 'none', updatedAt: null }
  if (verifData?.representative_name) {
    representativeName = {
      value: verifData.representative_name,
      source: 'business_verifications',
      updatedAt: verifData.updated_at ?? verifData.created_at ?? null,
    }
  } else if (verifiedSignupApp?.representative_name) {
    representativeName = {
      value: verifiedSignupApp.representative_name,
      source: 'signup_applications',
      updatedAt: verifiedSignupApp.updated_at ?? verifiedSignupApp.created_at ?? null,
    }
  }

  let businessNumber: FieldProvenance = { value: null, source: 'none', updatedAt: null }
  if (verifData?.business_number) {
    businessNumber = {
      value: verifData.business_number,
      source: 'business_verifications',
      updatedAt: verifData.updated_at ?? verifData.created_at ?? null,
    }
  } else if (verifiedSignupApp?.business_number) {
    businessNumber = {
      value: verifiedSignupApp.business_number,
      source: 'signup_applications',
      updatedAt: verifiedSignupApp.updated_at ?? verifiedSignupApp.created_at ?? null,
    }
  }

  let startDate: FieldProvenance = { value: null, source: 'none', updatedAt: null }
  if (verifData?.start_date) {
    startDate = {
      value: verifData.start_date,
      source: 'business_verifications',
      updatedAt: verifData.updated_at ?? verifData.created_at ?? null,
    }
  }

  const hasDocument = Boolean(verifData?.document_url)
  const submittedAt = verifData?.updated_at ?? verifData?.created_at ?? verifiedSignupApp?.updated_at ?? verifiedSignupApp?.created_at ?? null

  // 5. Fetch user_agreements strictly scoped to the verified signup applicant and workspace (다중 멤버 동의 혼입 및 누출 방지)
  let agreementsData: any[] | null = null
  if (verifiedSignupApp?.user_id) {
    try {
      const { data: agData } = await admin
        .from('user_agreements')
        .select('agreement_type, version, agreed, agreed_at')
        .eq('workspace_id', workspaceId)
        .eq('user_id', verifiedSignupApp.user_id)
      agreementsData = agData
    } catch {}
  }

  // 6. Fetch naver_place channel connection safely
  let naverPlaceData: any = null
  try {
    const { data: npData } = await admin
      .from('channel_connections')
      .select('account_label, external_account_id, status, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'naver_place')
      .maybeSingle()
    naverPlaceData = npData
  } catch {}

  // 7. Fetch owner's self-reported business & operations details (unverified input).
  //    This never feeds the canonical verification status below — it is display-only context.
  let selfReported: SelfReportedBusinessDetails | null = null
  try {
    const { data: detailsRow } = await admin
      .from('workspace_business_details')
      .select('business_number, representative_name, business_start_date, business_type, business_item, phone, business_hours, closed_days, parking_info, reservation_method, website_url, price_range, naver_place_url, intake_source, updated_at')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (detailsRow) {
      const asText = (value: unknown): string | null =>
        typeof value === 'string' && value.trim().length > 0 ? value : null
      selfReported = {
        businessNumber: asText(detailsRow.business_number),
        representativeName: asText(detailsRow.representative_name),
        businessStartDate: asText(detailsRow.business_start_date),
        businessType: asText(detailsRow.business_type),
        businessItem: asText(detailsRow.business_item),
        phone: asText(detailsRow.phone),
        businessHours: asText(detailsRow.business_hours),
        closedDays: asText(detailsRow.closed_days),
        parkingInfo: asText(detailsRow.parking_info),
        reservationMethod: asText(detailsRow.reservation_method),
        websiteUrl: asText(detailsRow.website_url),
        priceRange: asText(detailsRow.price_range),
        naverPlaceUrl: asText(detailsRow.naver_place_url),
        intakeSource: detailsRow.intake_source === 'naver_sync' ? 'naver_sync' : 'manual',
        updatedAt: detailsRow.updated_at ?? null,
      }
    }
  } catch {
    // A missing/unavailable self-report row must never break the verification read.
    selfReported = null
  }

  // Determine Overall Status
  // Canonical status takes absolute precedence. Never infer 'VERIFIED' from signup_applications!
  const canonicalStatus = verifData?.status ?? null
  const rejectionReason = verifData?.rejection_reason ?? null

  let status: BusinessVerificationStatusType
  let statusLabel: BusinessVerificationLabelType

  if (canonicalStatus === 'VERIFIED') {
    status = 'VERIFIED'
    statusLabel = '승인됨'
  } else if (canonicalStatus === 'REJECTED') {
    status = 'REJECTED'
    statusLabel = '반려'
  } else if (
    canonicalStatus === 'PENDING' ||
    canonicalStatus === 'DOCUMENT_REQUIRED' ||
    canonicalStatus === 'MISMATCH' ||
    canonicalStatus === 'UNVERIFIED'
  ) {
    status = 'SUBMITTED_PENDING'
    statusLabel = '사업자 정보 제출됨·인증 대기'
  } else if (
    // Never assume submission from company name alone: require a non-empty business number
    // and/or a formal business submission state on the authentic signup application.
    businessNumber.value &&
    businessNumber.value.replace(/\D/g, '').length === 10
  ) {
    status = 'SUBMITTED_PENDING'
    statusLabel = '사업자 정보 제출됨·인증 대기'
  } else {
    status = 'NOT_SUBMITTED'
    statusLabel = '미제출'
  }

  // Multi-projection states
  const identityState = verifiedSignupApp ? 'COMPLETED' : (validMemberUserIds.size > 0 ? 'COMPLETED' : 'UNREGISTERED')
  const identityStateLabel = verifiedSignupApp ? '가입 완료' : (validMemberUserIds.size > 0 ? '가입 완료' : '가입 기록 없음')

  const hasSubmittedBusiness = Boolean(
    verifData?.business_number ||
    (verifiedSignupApp?.business_number && verifiedSignupApp.business_number.replace(/\D/g, '').length === 10)
  )
  const businessSubmissionState = hasSubmittedBusiness ? 'SUBMITTED' : 'NOT_SUBMITTED'
  const businessSubmissionStateLabel = hasSubmittedBusiness ? '사업자 정보 제출됨' : '사업자 정보 미제출'

  const AGREEMENT_LABELS: Record<string, string> = {
    TERMS_OF_SERVICE: '서비스 이용약관',
    PRIVACY_POLICY: '개인정보 처리방침',
    AI_DATA_PROCESSING: 'AI 데이터 처리 및 분석 동의',
    CHANNEL_OPERATION_DELEGATION: '마케팅 채널 운영 대행 위임 동의',
    CHANNEL_DELEGATION_POA: '마케팅 채널 운영 대행 위임 동의',
    MARKETING_NOTIFICATIONS: '마케팅 성과 및 혜택 알림 수신 동의 (선택)',
  }

  const rawAgreements = Array.isArray(agreementsData) ? agreementsData : []
  const agreements: AgreementItemInfo[] = rawAgreements.map((a: any) => ({
    type: a.agreement_type,
    label: AGREEMENT_LABELS[a.agreement_type] || a.agreement_type,
    agreed: Boolean(a.agreed),
    agreedAt: a.agreed_at,
    version: a.version,
  }))

  const marketingRow = rawAgreements.find((a: any) => a.agreement_type === 'MARKETING_NOTIFICATIONS')
  const marketingConsent = marketingRow
    ? {
        agreed: Boolean(marketingRow.agreed),
        agreedAt: marketingRow.agreed_at,
        version: marketingRow.version,
      }
    : null

  const agreedTypes = new Set(rawAgreements.filter((a: any) => a.agreed).map((a: any) => a.agreement_type))
  const allRequiredAgreed =
    (agreedTypes.has('TERMS_OF_SERVICE') && agreedTypes.has('PRIVACY_POLICY') && agreedTypes.has('AI_DATA_PROCESSING') && (agreedTypes.has('CHANNEL_OPERATION_DELEGATION') || agreedTypes.has('CHANNEL_DELEGATION_POA'))) ||
    verifiedSignupApp?.agreements_completed === true

  let legalConsentState: 'COMPLETED' | 'PARTIAL' | 'NOT_COMPLETED' | 'QUERY_ERROR'
  let legalConsentStateLabel: '필수 약관 동의 완료' | '약관 부분 동의' | '약관 미동의' | '조회 실패'
  if (allRequiredAgreed) {
    legalConsentState = 'COMPLETED'
    legalConsentStateLabel = '필수 약관 동의 완료'
  } else if (rawAgreements.length > 0) {
    legalConsentState = 'PARTIAL'
    legalConsentStateLabel = '약관 부분 동의'
  } else {
    legalConsentState = 'NOT_COMPLETED'
    legalConsentStateLabel = '약관 미동의'
  }

  const naverPlace = naverPlaceData
    ? {
        url: naverPlaceData.account_label || (naverPlaceData.external_account_id ? `https://m.place.naver.com/place/${naverPlaceData.external_account_id}` : null),
        status: naverPlaceData.status ?? null,
      }
    : null

  return {
    status,
    statusLabel,
    companyName,
    representativeName,
    businessNumber,
    startDate,
    canonicalStatus,
    rejectionReason,
    hasDocument,
    submittedAt,
    identityState,
    identityStateLabel,
    businessSubmissionState,
    businessSubmissionStateLabel,
    legalConsentState,
    legalConsentStateLabel,
    agreements,
    marketingConsent,
    naverPlace,
    selfReported,
    error: null,
  }
}
