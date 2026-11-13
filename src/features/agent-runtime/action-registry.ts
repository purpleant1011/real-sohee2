import { assertExternalActionAllowed } from '../business-verification/eligibility-guard'
import type { BusinessProfile } from '../business-verification/types'

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type VerificationMethod = 'API_READ_BACK' | 'BROWSER_DOM_FINGERPRINT' | 'INTERNAL_LEDGER' | 'NONE'

export interface ActionDefinition {
  actionType: string
  category: 'strategy' | 'content' | 'image' | 'channel' | 'crm' | 'booking' | 'reputation' | 'system'
  requiredCapability?: string
  riskTier: RiskTier
  creditEstimateRange: [number, number]
  requiresBusinessVerification: boolean
  requiresConsent: boolean
  verificationMethod: VerificationMethod
  idempotencyStrategy: 'EXACT_HASH' | 'DAILY_SLOT' | 'TRANSACTION_ID'
}

/**
 * 3차 수정 공통 Action Registry 카탈로그
 */
export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
  // 1. Content & Generation (Low~Medium Risk - 내부 생성)
  'content.generate_post': {
    actionType: 'content.generate_post',
    category: 'content',
    riskTier: 'LOW',
    creditEstimateRange: [50, 100],
    requiresBusinessVerification: false,
    requiresConsent: false,
    verificationMethod: 'INTERNAL_LEDGER',
    idempotencyStrategy: 'EXACT_HASH',
  },
  'image.generate_asset': {
    actionType: 'image.generate_asset',
    category: 'image',
    riskTier: 'MEDIUM',
    creditEstimateRange: [300, 600],
    requiresBusinessVerification: false,
    requiresConsent: false,
    verificationMethod: 'INTERNAL_LEDGER',
    idempotencyStrategy: 'EXACT_HASH',
  },

  // 2. Channel External Publish (High Risk - 외부 실게시, 사업자 검증 필수)
  'channel.publish_instagram': {
    actionType: 'channel.publish_instagram',
    category: 'channel',
    requiredCapability: 'INSTAGRAM_PUBLISH_FEED',
    riskTier: 'HIGH',
    creditEstimateRange: [200, 400],
    requiresBusinessVerification: true,
    requiresConsent: true,
    verificationMethod: 'API_READ_BACK',
    idempotencyStrategy: 'EXACT_HASH',
  },
  'channel.publish_threads': {
    actionType: 'channel.publish_threads',
    category: 'channel',
    requiredCapability: 'THREADS_PUBLISH',
    riskTier: 'HIGH',
    creditEstimateRange: [150, 300],
    requiresBusinessVerification: true,
    requiresConsent: true,
    verificationMethod: 'API_READ_BACK',
    idempotencyStrategy: 'EXACT_HASH',
  },
  'channel.publish_naver_blog': {
    actionType: 'channel.publish_naver_blog',
    category: 'channel',
    requiredCapability: 'NAVER_BLOG_POST',
    riskTier: 'HIGH',
    creditEstimateRange: [400, 800],
    requiresBusinessVerification: true,
    requiresConsent: true,
    verificationMethod: 'BROWSER_DOM_FINGERPRINT',
    idempotencyStrategy: 'EXACT_HASH',
  },
  'channel.publish_danggeun': {
    actionType: 'channel.publish_danggeun',
    category: 'channel',
    requiredCapability: 'DANGGEUN_BUSINESS_POST',
    riskTier: 'HIGH',
    creditEstimateRange: [300, 600],
    requiresBusinessVerification: true,
    requiresConsent: true,
    verificationMethod: 'BROWSER_DOM_FINGERPRINT',
    idempotencyStrategy: 'EXACT_HASH',
  },

  // 3. CRM & Outbound (Critical Risk)
  'crm.send_outbound_promotion': {
    actionType: 'crm.send_outbound_promotion',
    category: 'crm',
    requiredCapability: 'CRM_OUTBOUND',
    riskTier: 'CRITICAL',
    creditEstimateRange: [500, 1200],
    requiresBusinessVerification: true,
    requiresConsent: true,
    verificationMethod: 'API_READ_BACK',
    idempotencyStrategy: 'TRANSACTION_ID',
  },
}

export interface PreflightContext {
  actionType: string
  workspaceId: string
  businessProfile?: Pick<BusinessProfile, 'verificationStatus' | 'serviceEligibility'> | null
  channelStatus?: 'CONNECTED' | 'REAUTH_REQUIRED' | 'REVOKED' | 'DISCONNECTED'
  grantedCapabilities?: string[]
  availableCredits: number
  isServerPaused?: boolean
}

export interface PreflightResult {
  allowed: boolean
  actionDef: ActionDefinition
  estimatedCredits: [number, number]
  blockedReason?: string
  code?: 'BUSINESS_VERIFICATION_REQUIRED' | 'CHANNEL_REAUTH_REQUIRED' | 'CAPABILITY_MISSING' | 'INSUFFICIENT_CREDITS' | 'SERVER_PAUSED' | 'UNKNOWN_ACTION'
}

/**
 * 액션 실행 전 통합 사전 검증 (Preflight)
 */
export function preflightAction(ctx: PreflightContext): PreflightResult {
  const actionDef = ACTION_REGISTRY[ctx.actionType]
  if (!actionDef) {
    return {
      allowed: false,
      actionDef: {
        actionType: ctx.actionType,
        category: 'system',
        riskTier: 'LOW',
        creditEstimateRange: [0, 0],
        requiresBusinessVerification: false,
        requiresConsent: false,
        verificationMethod: 'NONE',
        idempotencyStrategy: 'EXACT_HASH',
      },
      estimatedCredits: [0, 0],
      blockedReason: `알 수 없는 액션 타입입니다: ${ctx.actionType}`,
      code: 'UNKNOWN_ACTION',
    }
  }

  // 1. 서버 일시중지(Kill Switch / Pause) 검사
  if (ctx.isServerPaused) {
    return {
      allowed: false,
      actionDef,
      estimatedCredits: actionDef.creditEstimateRange,
      blockedReason: '운영 정책 또는 점검으로 인해 워크스페이스 실행이 일시 중지되었습니다.',
      code: 'SERVER_PAUSED',
    }
  }

  // 2. 사업자 인증(Business Eligibility) 검사
  if (actionDef.requiresBusinessVerification) {
    try {
      assertExternalActionAllowed(ctx.businessProfile)
    } catch (err) {
      const message = err instanceof Error ? err.message : '사업자 인증이 필요합니다.'
      return {
        allowed: false,
        actionDef,
        estimatedCredits: actionDef.creditEstimateRange,
        blockedReason: message,
        code: 'BUSINESS_VERIFICATION_REQUIRED',
      }
    }
  }

  // 3. 채널 연결 및 권한 검사
  if (actionDef.requiredCapability) {
    if (ctx.channelStatus !== 'CONNECTED') {
      return {
        allowed: false,
        actionDef,
        estimatedCredits: actionDef.creditEstimateRange,
        blockedReason: `채널 인증이 만료되었거나 연결되지 않았습니다 (상태: ${ctx.channelStatus || '미연결'}). 재연결 후 시도해 주세요.`,
        code: 'CHANNEL_REAUTH_REQUIRED',
      }
    }

    if (!ctx.grantedCapabilities?.includes(actionDef.requiredCapability)) {
      return {
        allowed: false,
        actionDef,
        estimatedCredits: actionDef.creditEstimateRange,
        blockedReason: `해당 채널에서 필요한 권한(${actionDef.requiredCapability})이 부여되지 않았습니다.`,
        code: 'CAPABILITY_MISSING',
      }
    }
  }

  // 4. 크레딧 잔액 검사
  const minRequiredCredit = actionDef.creditEstimateRange[0]
  if (ctx.availableCredits < minRequiredCredit) {
    return {
      allowed: false,
      actionDef,
      estimatedCredits: actionDef.creditEstimateRange,
      blockedReason: `크레딧이 부족합니다 (필요: 최소 ${minRequiredCredit} SC, 보유: ${ctx.availableCredits} SC).`,
      code: 'INSUFFICIENT_CREDITS',
    }
  }

  return {
    allowed: true,
    actionDef,
    estimatedCredits: actionDef.creditEstimateRange,
  }
}
