export interface FieldProvenance {
  value: string | null
  source: 'business_verifications' | 'signup_applications' | 'business_profiles' | 'channel_connections' | 'workspace_business_details' | 'none'
  updatedAt: string | null
}

/**
 * 사장님이 가입 첫 화면에서 **직접 입력**한 사업자·운영 정보.
 * 국세청 확인·운영팀 승인을 거치지 않았으므로 절대 인증 상태로 승격하지 않는다.
 */
export interface SelfReportedBusinessDetails {
  businessNumber: string | null
  representativeName: string | null
  businessStartDate: string | null
  businessType: string | null
  businessItem: string | null
  phone: string | null
  businessHours: string | null
  closedDays: string | null
  parkingInfo: string | null
  reservationMethod: string | null
  websiteUrl: string | null
  priceRange: string | null
  naverPlaceUrl: string | null
  intakeSource: 'manual' | 'naver_sync'
  updatedAt: string | null
}

export type BusinessVerificationStatusType =
  | 'VERIFIED'
  | 'REJECTED'
  | 'SUBMITTED_PENDING'
  | 'NOT_SUBMITTED'
  | 'QUERY_ERROR'

export type BusinessVerificationLabelType =
  | '승인됨'
  | '반려'
  | '사업자 정보 제출됨·인증 대기'
  | '미제출'
  | '조회 실패'

export interface AgreementItemInfo {
  type: string
  label: string
  agreed: boolean
  agreedAt: string | null
  version: string | null
}

export interface ResolvedBusinessInfo {
  status: BusinessVerificationStatusType
  statusLabel: BusinessVerificationLabelType
  companyName: FieldProvenance
  representativeName: FieldProvenance
  businessNumber: FieldProvenance
  startDate: FieldProvenance
  canonicalStatus: string | null
  rejectionReason: string | null
  hasDocument: boolean
  submittedAt: string | null
  identityState: 'COMPLETED' | 'IN_PROGRESS' | 'UNREGISTERED'
  identityStateLabel: '가입 완료' | '가입 진행 중' | '가입 기록 없음'
  businessSubmissionState: 'SUBMITTED' | 'NOT_SUBMITTED' | 'QUERY_ERROR'
  businessSubmissionStateLabel: '사업자 정보 제출됨' | '사업자 정보 미제출' | '조회 실패'
  legalConsentState: 'COMPLETED' | 'PARTIAL' | 'NOT_COMPLETED' | 'QUERY_ERROR'
  legalConsentStateLabel: '필수 약관 동의 완료' | '약관 부분 동의' | '약관 미동의' | '조회 실패'
  agreements: AgreementItemInfo[]
  marketingConsent: { agreed: boolean; agreedAt: string | null; version: string | null } | null
  naverPlace: { url: string | null; status: string | null } | null
  /** 사장님 자가 입력(미검증). 입력이 없으면 null. */
  selfReported: SelfReportedBusinessDetails | null
  error: unknown | null
}
