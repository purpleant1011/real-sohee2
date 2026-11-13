import 'server-only'

export const CANONICAL_META_APP_ID = '1568352131460103'

export type MetaAppMode = 'development' | 'live'
export type MetaAccessLevel = 'standard' | 'advanced'
export type OAuthAudience = 'TEST_ROLE_ONLY' | 'PRODUCTION_DELEGATED'
export type MetaReviewStatus = 'unsubmitted' | 'pending' | 'approved' | 'rejected'
export type MetaBusinessVerificationStatus = 'unverified' | 'in_review' | 'verified' | 'not_required'
export type UserRole = 'developer_or_tester' | 'general_customer'

export interface MetaAccessGateConfig {
  appId: string
  appMode: MetaAppMode
  accessLevel: MetaAccessLevel
  reviewStatus: MetaReviewStatus
  businessVerificationStatus: MetaBusinessVerificationStatus
  lastVerifiedAt?: string
}

export interface GateEvaluationInput {
  userRole?: UserRole
  capability?: string
}

export interface GateEvaluationResult {
  allowed: boolean
  audience: OAuthAudience
  gateCode: string
  isProductionDelegatedAllowed: boolean
  reason: string
  evaluatedAt: string
}

/**
 * Evaluates the Meta production access gate (ANI-1008).
 * Distinguishes TEST_ROLE_ONLY from PRODUCTION_DELEGATED.
 * Never reports false-green production access when App Review or Advanced Access is missing.
 */
export function evaluateMetaAccessGate(
  config: MetaAccessGateConfig,
  input: GateEvaluationInput = {},
): GateEvaluationResult {
  const evaluatedAt = new Date().toISOString()
  const userRole: UserRole = input.userRole || 'general_customer'

  // Validate App ID match
  if (config.appId !== CANONICAL_META_APP_ID) {
    return {
      allowed: false,
      audience: 'TEST_ROLE_ONLY',
      gateCode: 'INVALID_META_APP_ID',
      isProductionDelegatedAllowed: false,
      reason: `유효하지 않은 Meta App ID입니다: ${config.appId} (정본: ${CANONICAL_META_APP_ID})`,
      evaluatedAt,
    }
  }

  const isLive = config.appMode === 'live'
  const isAdvanced = config.accessLevel === 'advanced'
  const isReviewApproved = config.reviewStatus === 'approved'

  // Production Delegation is ONLY allowed when App is Live, Advanced Access is granted, and Review is Approved
  const isProductionDelegatedAllowed = isLive && isAdvanced && isReviewApproved

  if (isProductionDelegatedAllowed) {
    return {
      allowed: true,
      audience: 'PRODUCTION_DELEGATED',
      gateCode: 'PRODUCTION_ACCESS_APPROVED',
      isProductionDelegatedAllowed: true,
      reason: 'Meta Production Live 및 Advanced Access 승인 상태입니다.',
      evaluatedAt,
    }
  }

  // If not production ready, check if user is an internal developer or tester
  if (userRole === 'developer_or_tester') {
    return {
      allowed: true,
      audience: 'TEST_ROLE_ONLY',
      gateCode: 'TEST_ROLE_PERMITTED',
      isProductionDelegatedAllowed: false,
      reason: 'Meta 앱 개발자/테스터 계정으로 Standard Access 기능 사용이 허용됩니다.',
      evaluatedAt,
    }
  }

  // General customer in non-production-ready environment: FAIL-CLOSED
  if (!isLive) {
    return {
      allowed: false,
      audience: 'TEST_ROLE_ONLY',
      gateCode: 'META_APP_NOT_LIVE',
      isProductionDelegatedAllowed: false,
      reason: 'Meta 앱이 라이브 상태가 아닙니다 (현재: 개발 모드 / 게시되지 않음). 일반 고객 계정의 연동 및 작업 위임이 차단됩니다.',
      evaluatedAt,
    }
  }

  if (!isAdvanced) {
    return {
      allowed: false,
      audience: 'TEST_ROLE_ONLY',
      gateCode: 'ADVANCED_ACCESS_REQUIRED',
      isProductionDelegatedAllowed: false,
      reason: 'Meta 기능의 Advanced Access 권한이 필요합니다. Standard Access 상태에서는 일반 고객 계정에 작업을 위임할 수 없습니다.',
      evaluatedAt,
    }
  }

  return {
    allowed: false,
    audience: 'TEST_ROLE_ONLY',
    gateCode: 'APP_REVIEW_PENDING',
    isProductionDelegatedAllowed: false,
    reason: `Meta App Review 승인이 필요합니다 (현재: ${config.reviewStatus}).`,
    evaluatedAt,
  }
}

/**
 * Meta Access Gate (ANI-1049)
 *
 * Enforces strict epistemic separation between:
 * - INTERNAL_TEST_VERIFIED: @sohee.ai test-role supervised execution
 * - BLOCKED_EXTERNAL: non-test public customer blocked pending Meta App Review
 * - PUBLIC_CUSTOMER_READY: live app mode with approved App Review and advanced access tier
 */

export type AppReviewStatus = 'unsubmitted' | 'pending' | 'approved' | 'rejected'
export type AccessTier = 'standard' | 'advanced'

export type MetaAccessStatus =
  | 'NOT_CONNECTED'
  | 'INTERNAL_TEST_VERIFIED'
  | 'BLOCKED_EXTERNAL'
  | 'PUBLIC_CUSTOMER_READY'

export interface MetaAccessEvaluationParams {
  channel: 'instagram' | 'threads'
  connectionStatus: string
  metaAppMode?: MetaAppMode
  appReviewStatus?: AppReviewStatus
  accessTier?: AccessTier
  isTestRoleMember?: boolean
}

export interface MetaAccessEvaluation {
  channel: 'instagram' | 'threads'
  status: MetaAccessStatus
  allowSupervisedExecution: boolean
  allowPublicCustomerDelegation: boolean
  publicCustomerReady: boolean
  metaAppMode: MetaAppMode
  appReviewStatus: AppReviewStatus
  accessTier: AccessTier
  isTestRoleMember: boolean
  reason: string
  evaluatedAt: string
}

export function evaluateMetaAccessMode(params: MetaAccessEvaluationParams): MetaAccessEvaluation {
  const {
    channel,
    connectionStatus,
    metaAppMode = (process.env.META_APP_MODE as MetaAppMode) || 'development',
    appReviewStatus = (process.env.META_APP_REVIEW_STATUS as AppReviewStatus) || 'unsubmitted',
    accessTier = (process.env.META_ACCESS_TIER as AccessTier) || 'standard',
    isTestRoleMember = false,
  } = params

  const evaluatedAt = new Date().toISOString()

  if (connectionStatus !== 'connected') {
    return {
      channel,
      status: 'NOT_CONNECTED',
      allowSupervisedExecution: false,
      allowPublicCustomerDelegation: false,
      publicCustomerReady: false,
      metaAppMode,
      appReviewStatus,
      accessTier,
      isTestRoleMember,
      reason: `${channel.toUpperCase()} 채널 계정이 아직 연결되지 않았습니다.`,
      evaluatedAt,
    }
  }

  // Development Mode Gate (ANI-1049)
  if (metaAppMode === 'development') {
    if (isTestRoleMember) {
      return {
        channel,
        status: 'INTERNAL_TEST_VERIFIED',
        allowSupervisedExecution: true,
        allowPublicCustomerDelegation: false,
        publicCustomerReady: false,
        metaAppMode,
        appReviewStatus,
        accessTier,
        isTestRoleMember,
        reason: '개발 모드 내부 테스트 역할 계정으로 감독형 실행이 가능합니다 (INTERNAL_TEST_VERIFIED). 일반 고객 자율 연동은 차단됩니다.',
        evaluatedAt,
      }
    }

    return {
      channel,
      status: 'BLOCKED_EXTERNAL',
      allowSupervisedExecution: false,
      allowPublicCustomerDelegation: false,
      publicCustomerReady: false,
      metaAppMode,
      appReviewStatus,
      accessTier,
      isTestRoleMember,
      reason: 'Meta 플랫폼 앱 검수(App Review) 미승인 상태로 일반 고객 계정의 외부 연동/자율 실행이 차단됩니다 (BLOCKED_EXTERNAL).',
      evaluatedAt,
    }
  }

  // Live Mode Gate
  if (metaAppMode === 'live') {
    if (appReviewStatus === 'approved' && accessTier === 'advanced') {
      return {
        channel,
        status: 'PUBLIC_CUSTOMER_READY',
        allowSupervisedExecution: true,
        allowPublicCustomerDelegation: true,
        publicCustomerReady: true,
        metaAppMode,
        appReviewStatus,
        accessTier,
        isTestRoleMember,
        reason: 'Meta 플랫폼 공식 앱 검수 및 고급 액세스(Advanced Access) 승인이 완료되어 일반 고객 서비스가 가능합니다 (PUBLIC_CUSTOMER_READY).',
        evaluatedAt,
      }
    }

    return {
      channel,
      status: 'BLOCKED_EXTERNAL',
      allowSupervisedExecution: false,
      allowPublicCustomerDelegation: false,
      publicCustomerReady: false,
      metaAppMode,
      appReviewStatus,
      accessTier,
      isTestRoleMember,
      reason: `Meta 플랫폼 라이브 모드이나 App Review(${appReviewStatus}) 또는 Access Tier(${accessTier}) 승인이 미완료 상태입니다.`,
      evaluatedAt,
    }
  }

  return {
    channel,
    status: 'BLOCKED_EXTERNAL',
    allowSupervisedExecution: false,
    allowPublicCustomerDelegation: false,
    publicCustomerReady: false,
    metaAppMode,
    appReviewStatus,
    accessTier,
    isTestRoleMember,
    reason: '알 수 없는 Meta 앱 설정 상태입니다.',
    evaluatedAt,
  }
}
