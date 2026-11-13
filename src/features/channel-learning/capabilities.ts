import {
  LearningError,
  type Capability,
  type EvidenceLeaseMethod,
  type LearningPlatform,
} from './contracts'

const CAPABILITIES: readonly Capability[] = [
  {
    platform: 'instagram',
    verificationMethods: ['oauth'],
    collectionMode: 'official_api',
    blockerCode: null,
  },
  {
    platform: 'threads',
    verificationMethods: ['oauth'],
    collectionMode: 'official_api',
    blockerCode: null,
  },
  {
    platform: 'naver_blog',
    verificationMethods: [],
    collectionMode: 'manual_only',
    blockerCode: 'NAVER_AUTOMATION_RESTRICTED',
  },
  {
    platform: 'naver_place',
    verificationMethods: [],
    collectionMode: 'manual_only',
    blockerCode: 'NAVER_AUTOMATION_RESTRICTED',
  },
  {
    platform: 'daangn_business',
    verificationMethods: [],
    collectionMode: 'blocked',
    blockerCode: 'CAPABILITY_NOT_ACTIVATED',
  },
  {
    platform: 'website',
    verificationMethods: [],
    collectionMode: 'blocked',
    blockerCode: 'SAFE_FETCH_NOT_CONFIGURED',
  },
] as const

const CAPABILITY_MAP = new Map<LearningPlatform, Capability>(
  CAPABILITIES.map((cap) => [cap.platform, cap]),
)

export function getLearningCapabilities(): readonly Capability[] {
  return CAPABILITIES
}

export function getLearningCapability(platform: LearningPlatform): Capability {
  const cap = CAPABILITY_MAP.get(platform)
  if (!cap) {
    throw new LearningError('UNSUPPORTED_PLATFORM', `지원하지 않는 플랫폼입니다: ${platform}`)
  }
  return cap
}

export function isVerificationSupported(
  platform: LearningPlatform,
  method: EvidenceLeaseMethod,
): boolean {
  const cap = getLearningCapability(platform)
  return cap.verificationMethods.includes(method)
}

export function isCollectionSupported(platform: LearningPlatform): boolean {
  const cap = getLearningCapability(platform)
  return cap.collectionMode === 'official_api' || cap.collectionMode === 'safe_public'
}

export function assertPlatformActionAllowed(
  platform: LearningPlatform,
  action: 'verify' | 'collect',
): void {
  const cap = getLearningCapability(platform)

  if (action === 'verify') {
    if (cap.verificationMethods.length === 0) {
      throw new LearningError(
        cap.blockerCode ?? 'VERIFICATION_BLOCKED',
        `${platform} 플랫폼은 자동 소유권 검증이 지원되지 않습니다. (${cap.blockerCode ?? '차단됨'})`,
      )
    }
  } else if (action === 'collect') {
    if (!isCollectionSupported(platform)) {
      throw new LearningError(
        cap.blockerCode ?? 'COLLECTION_BLOCKED',
        `${platform} 플랫폼은 자동 수집이 차단되어 있습니다. (${cap.blockerCode ?? '차단됨'})`,
      )
    }
  }
}
