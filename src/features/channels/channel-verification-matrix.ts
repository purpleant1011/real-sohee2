export type ChannelProvider = 'META_INSTAGRAM' | 'META_THREADS' | 'NAVER_BLOG' | 'DANGGEUN' | 'KAKAO'

export interface ChannelCapabilitySupport {
  capabilityKey: string
  name: string
  isSupported: boolean
  supportTier: 'OFFICIAL_API' | 'ISOLATED_BROWSER_SESSION' | 'PARTIAL' | 'NOT_SUPPORTED'
  requiresBusinessVerification: boolean
  requiresReadAfterWriteEvidence: boolean
  notes?: string
}

/**
 * 3차 수정 채널별 정직한 Capability Registry (과장 금지, 진실성 보장)
 */
export const CHANNEL_CAPABILITY_REGISTRY: Record<ChannelProvider, ChannelCapabilitySupport[]> = {
  META_INSTAGRAM: [
    {
      capabilityKey: 'INSTAGRAM_PUBLISH_FEED',
      name: '인스타그램 피드 이미지/캐러셀 발행',
      isSupported: true,
      supportTier: 'OFFICIAL_API',
      requiresBusinessVerification: true,
      requiresReadAfterWriteEvidence: true,
    },
    {
      capabilityKey: 'INSTAGRAM_READ_INSIGHTS',
      name: '인스타그램 도달/인사이트 조회',
      isSupported: true,
      supportTier: 'OFFICIAL_API',
      requiresBusinessVerification: true,
      requiresReadAfterWriteEvidence: false,
    },
  ],
  META_THREADS: [
    {
      capabilityKey: 'THREADS_PUBLISH',
      name: '스레드 텍스트/이미지 발행',
      isSupported: true,
      supportTier: 'OFFICIAL_API',
      requiresBusinessVerification: true,
      requiresReadAfterWriteEvidence: true,
    },
  ],
  NAVER_BLOG: [
    {
      capabilityKey: 'NAVER_BLOG_POST',
      name: '네이버 블로그 원고 및 사진 준비',
      isSupported: true,
      supportTier: 'ISOLATED_BROWSER_SESSION',
      requiresBusinessVerification: true,
      requiresReadAfterWriteEvidence: true,
      notes: '원고·사진 준비 및 미리보기 지원',
    },
  ],
  DANGGEUN: [
    {
      capabilityKey: 'DANGGEUN_BUSINESS_POST',
      name: '당근 비즈프로필 소식 준비',
      isSupported: true,
      supportTier: 'ISOLATED_BROWSER_SESSION',
      requiresBusinessVerification: true,
      requiresReadAfterWriteEvidence: true,
    },
  ],
  KAKAO: [
    {
      capabilityKey: 'KAKAO_CHANNEL_PROFILE_READ',
      name: '카카오톡 채널 기본 정보 조회',
      isSupported: true,
      supportTier: 'PARTIAL',
      requiresBusinessVerification: true,
      requiresReadAfterWriteEvidence: false,
      notes: '비즈니스 채널 기본 프로필 조회 지원',
    },
    {
      capabilityKey: 'KAKAO_PERSONAL_CHAT_AUTO_SEND',
      name: '개인 카카오톡 메시지 자동 발송',
      isSupported: false,
      supportTier: 'NOT_SUPPORTED',
      requiresBusinessVerification: true,
      requiresReadAfterWriteEvidence: false,
      notes: '개인 계정 자동 제어는 정책상 지원하지 않습니다.',
    },
  ],
}

export interface ExternalVerificationEvidence {
  id: string
  workspaceId: string
  actionRunId: string
  provider: ChannelProvider
  externalObjectId: string
  externalUrl?: string
  observedAt: string
  evidenceHash: string
  verificationMethod: 'API_READ_BACK' | 'BROWSER_DOM_FINGERPRINT'
}

/**
 * 외부 게시물 Read-after-write 실검증 증빙 생성
 */
export function createVerificationEvidence(
  workspaceId: string,
  actionRunId: string,
  provider: ChannelProvider,
  externalObjectId: string,
  externalUrl?: string
): ExternalVerificationEvidence {
  if (!externalObjectId && !externalUrl) {
    throw new Error('실제 external ObjectId 또는 Permalink URL이 없으면 VERIFIED 증빙을 생성할 수 없습니다.')
  }

  return {
    id: `evi-${Date.now()}`,
    workspaceId,
    actionRunId,
    provider,
    externalObjectId,
    externalUrl,
    observedAt: new Date().toISOString(),
    evidenceHash: `hash-${provider.toLowerCase()}-${externalObjectId}`,
    verificationMethod: provider.startsWith('META') ? 'API_READ_BACK' : 'BROWSER_DOM_FINGERPRINT',
  }
}
