/**
 * Meta Capability Truth (ANI-1143)
 *
 * Enforces strict, evidence-backed separation between:
 * - TEST_ROLE_ONLY: Development mode, restricted to registered Meta App testers/developers
 * - REVIEW_REQUIRED: Live mode pending Meta App Review / Advanced Access approval
 * - PUBLIC_READY: Live mode with Advanced Access and approved App Review for general customer autonomous execution
 * - BLOCKED: Missing data deletion callback, rejected review, or missing vital permission grants
 *
 * INVARIANT: Internal test execution success NEVER results in PUBLIC_READY status.
 * Fail-Closed: Public customers cannot execute autonomous publish unless capability is PUBLIC_READY.
 */

export const CANONICAL_META_APP_ID = '1568352131460103'

export type MetaCapabilityState = 'TEST_ROLE_ONLY' | 'REVIEW_REQUIRED' | 'PUBLIC_READY' | 'BLOCKED'

export type MetaPermissionName =
  | 'instagram_basic'
  | 'instagram_content_publish'
  | 'pages_show_list'
  | 'pages_read_engagement'
  | 'threads_basic'
  | 'threads_content_publish'
  | 'threads_read_replies'

export type AccessTier = 'standard' | 'advanced'
export type ReviewStatus = 'unsubmitted' | 'pending' | 'approved' | 'rejected'
export type BusinessVerificationStatus = 'unverified' | 'in_review' | 'verified' | 'not_required'

export interface MetaPermissionRecord {
  name: MetaPermissionName
  granted: boolean
  tier: AccessTier
  reviewStatus: ReviewStatus
}

export interface MetaCapabilityEvidence {
  channel: 'instagram' | 'threads'
  appId: string
  appMode: 'development' | 'live'
  businessVerification: BusinessVerificationStatus
  dataDeletionCallbackConfigured: boolean
  permissions: MetaPermissionRecord[]
  capabilityState: MetaCapabilityState
  isPublicCustomerReady: boolean
  reasons: string[]
  observedAt: string
  expiresAt: string
  revalidationWindowSeconds: number
  isStale: (now?: Date) => boolean
}

export interface EvaluateMetaCapabilityParams {
  channel: 'instagram' | 'threads'
  appId: string
  appMode: 'development' | 'live'
  businessVerification: BusinessVerificationStatus
  dataDeletionCallbackConfigured: boolean
  permissions: MetaPermissionRecord[]
  internalTestSuccessObserved?: boolean
  observedAt?: string
  revalidationWindowSeconds?: number
}

export class PublicCustomerPublishBlockedError extends Error {
  public readonly reasonCode = 'PUBLIC_CUSTOMER_PUBLISH_BLOCKED'
  public readonly capabilityState: MetaCapabilityState
  public readonly channel: string

  constructor(params: { capabilityState: MetaCapabilityState; channel: string; message?: string }) {
    super(
      params.message ||
        `일반 고객 자율 발행이 차단되었습니다 (현재 상태: ${params.capabilityState}, 채널: ${params.channel}). Meta 플랫폼 앱 검수(App Review) 및 Advanced Access 승인이 완료되어야 합니다.`,
    )
    this.name = 'PublicCustomerPublishBlockedError'
    this.capabilityState = params.capabilityState
    this.channel = params.channel
  }
}

/**
 * Evaluates the evidence-backed capability state for Meta channels.
 * Guarantees that internal test success NEVER yields PUBLIC_READY.
 */
export function evaluateMetaCapabilityState(params: EvaluateMetaCapabilityParams): MetaCapabilityEvidence {
  const {
    channel,
    appId,
    appMode,
    businessVerification,
    dataDeletionCallbackConfigured,
    permissions,
    internalTestSuccessObserved = false,
    observedAt = new Date().toISOString(),
    revalidationWindowSeconds = 3600,
  } = params

  const reasons: string[] = []
  let capabilityState: MetaCapabilityState = 'BLOCKED'

  // 1. Data Deletion Callback Check (Critical Meta Compliance requirement)
  if (!dataDeletionCallbackConfigured) {
    reasons.push('Meta 데이터 삭제 콜백(Data Deletion Callback)이 구성되지 않았습니다.')
  }

  // 2. Essential Permissions Check
  const ungranted = permissions.filter((p) => !p.granted)
  if (ungranted.length > 0) {
    reasons.push(`필수 권한이 부여되지 않았습니다: ${ungranted.map((p) => p.name).join(', ')}`)
  }

  // 3. App ID Validation
  if (appId !== CANONICAL_META_APP_ID) {
    reasons.push(`공식 정본 Meta App ID(${CANONICAL_META_APP_ID})와 일치하지 않습니다: ${appId}`)
  }

  if (reasons.length > 0) {
    capabilityState = 'BLOCKED'
  } else if (appMode === 'development') {
    // Development mode is strictly restricted to registered testers/developers
    capabilityState = 'TEST_ROLE_ONLY'
    reasons.push('Meta 앱이 개발(Development) 모드이므로 테스터/개발자 역할(Test Role)만 사용 가능합니다.')
  } else if (appMode === 'live') {
    const allAdvanced = permissions.every((p) => p.tier === 'advanced')
    const allApproved = permissions.every((p) => p.reviewStatus === 'approved')
    const businessOk = businessVerification === 'verified' || businessVerification === 'not_required'

    if (allAdvanced && allApproved && businessOk) {
      capabilityState = 'PUBLIC_READY'
      reasons.push('Meta 플랫폼 정식 공개 배포 및 일반 고객 자율 실행이 승인되었습니다.')
    } else {
      capabilityState = 'REVIEW_REQUIRED'
      if (!allApproved) {
        reasons.push('Meta App Review 승인이 필요합니다 (현재: 미승인 또는 심사 중인 권한 존재).')
      }
      if (!allAdvanced) {
        reasons.push('Meta 기능의 고급 액세스(Advanced Access) 권한이 필요합니다.')
      }
      if (!businessOk) {
        reasons.push(`Meta 비즈니스 인증이 필요합니다 (현재: ${businessVerification}).`)
      }
    }
  }

  const observedMs = Date.parse(observedAt)
  const expiresAt = new Date(observedMs + revalidationWindowSeconds * 1000).toISOString()

  return {
    channel,
    appId,
    appMode,
    businessVerification,
    dataDeletionCallbackConfigured,
    permissions,
    capabilityState,
    isPublicCustomerReady: capabilityState === 'PUBLIC_READY',
    reasons,
    observedAt,
    expiresAt,
    revalidationWindowSeconds,
    isStale: (checkDate?: Date) => {
      const targetTime = checkDate ? checkDate.getTime() : Date.now()
      return targetTime >= Date.parse(expiresAt)
    },
  }
}

export interface PublishAdmissionActor {
  role: 'internal_operator' | 'public_customer'
  actorUserId?: string
  isTestRoleAccount?: boolean
  evaluatedAt?: Date
}

export interface PublishAdmissionDecision {
  allowed: boolean
  executionAudience: 'TEST_ROLE_EXECUTION' | 'PUBLIC_CUSTOMER_EXECUTION'
  requiresAuditFlag: boolean
  capabilityState: MetaCapabilityState
  reason?: string
}

/**
 * Asserts publish admission based on capability state and actor identity.
 * Fails closed whenever public customer attempts to publish without PUBLIC_READY.
 */
export function assertCustomerPublishAdmission(
  evidence: MetaCapabilityEvidence,
  actor: PublishAdmissionActor,
): PublishAdmissionDecision {
  const evalDate = actor.evaluatedAt || new Date()

  // 1. Check Stale / Expiry
  if (evidence.isStale(evalDate)) {
    throw new Error(
      `Meta 채널 역량 증적이 만료되었습니다 (Observed: ${evidence.observedAt}, Expires: ${evidence.expiresAt}). 재검증(Revalidation)이 필요합니다.`,
    )
  }

  // 2. Check Hard Blocked
  if (evidence.capabilityState === 'BLOCKED') {
    throw new Error(`Meta 채널 역량이 차단(BLOCKED) 상태입니다: ${evidence.reasons.join(' / ')}`)
  }

  // 3. Public Customer Gate
  if (actor.role === 'public_customer') {
    if (evidence.capabilityState !== 'PUBLIC_READY') {
      throw new PublicCustomerPublishBlockedError({
        capabilityState: evidence.capabilityState,
        channel: evidence.channel,
      })
    }

    return {
      allowed: true,
      executionAudience: 'PUBLIC_CUSTOMER_EXECUTION',
      requiresAuditFlag: false,
      capabilityState: evidence.capabilityState,
    }
  }

  // 4. Internal Operator Gate
  if (actor.role === 'internal_operator') {
    if (evidence.capabilityState === 'TEST_ROLE_ONLY') {
      if (actor.isTestRoleAccount === false) {
        throw new Error('Meta 앱이 개발 모드(TEST_ROLE_ONLY)이므로 등록된 테스터 계정만 실행 가능합니다.')
      }

      return {
        allowed: true,
        executionAudience: 'TEST_ROLE_EXECUTION',
        requiresAuditFlag: true,
        capabilityState: evidence.capabilityState,
        reason: '내부 테스트 역할 정책에 따라 감독형 실행이 허용되었습니다.',
      }
    }

    return {
      allowed: true,
      executionAudience: evidence.capabilityState === 'PUBLIC_READY' ? 'PUBLIC_CUSTOMER_EXECUTION' : 'TEST_ROLE_EXECUTION',
      requiresAuditFlag: evidence.capabilityState !== 'PUBLIC_READY',
      capabilityState: evidence.capabilityState,
    }
  }

  throw new Error(`알 수 없는 호출 주체 역할입니다: ${(actor as any).role}`)
}

/**
 * Returns the current runtime environment ground truth for Meta capabilities.
 */
export function getMetaCapabilityTruth(channel: 'instagram' | 'threads', customObservedAt?: string): MetaCapabilityEvidence {
  const appMode = (process.env.META_APP_MODE?.toLowerCase() as 'development' | 'live') || 'development'
  const appReviewStatus = (process.env.META_APP_REVIEW_STATUS?.toLowerCase() as ReviewStatus) || 'unsubmitted'
  const accessTier = (process.env.META_ACCESS_TIER?.toLowerCase() as AccessTier) || 'standard'
  const isDataDeletionConfigured = process.env.META_DATA_DELETION_CALLBACK_ENABLED === 'true'

  const permissions: MetaPermissionRecord[] =
    channel === 'instagram'
      ? [
          { name: 'instagram_basic', granted: true, tier: accessTier, reviewStatus: appReviewStatus },
          { name: 'instagram_content_publish', granted: true, tier: accessTier, reviewStatus: appReviewStatus },
          { name: 'pages_show_list', granted: true, tier: accessTier, reviewStatus: appReviewStatus },
          { name: 'pages_read_engagement', granted: true, tier: accessTier, reviewStatus: appReviewStatus },
        ]
      : [
          { name: 'threads_basic', granted: true, tier: accessTier, reviewStatus: appReviewStatus },
          { name: 'threads_content_publish', granted: true, tier: accessTier, reviewStatus: appReviewStatus },
          { name: 'threads_read_replies', granted: true, tier: accessTier, reviewStatus: appReviewStatus },
        ]

  return evaluateMetaCapabilityState({
    channel,
    appId: CANONICAL_META_APP_ID,
    appMode,
    businessVerification: 'verified',
    dataDeletionCallbackConfigured: isDataDeletionConfigured,
    permissions,
    observedAt: customObservedAt,
  })
}
