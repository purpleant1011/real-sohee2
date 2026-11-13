import { randomBytes, randomUUID, createHash } from 'node:crypto'
import {
  LearningError,
  type EvidenceLease,
  type LearningSource,
} from './contracts'
import { isVerificationSupported } from './capabilities'

export interface OAuthCredentialData {
  accessToken: string
  scopes: string[]
  providerAccountId: string
  expiresAt?: string
}

export interface ProviderMeResult {
  id: string
  username: string
}

export interface OwnershipVerificationDeps {
  getOAuthCredential: (
    workspaceId: string,
    platform: 'instagram' | 'threads',
  ) => Promise<OAuthCredentialData | null>
  fetchProviderMe: (
    platform: 'instagram' | 'threads',
    accessToken: string,
  ) => Promise<ProviderMeResult>
  now?: () => Date
}

// 서버에는 평문 마커를 절대 저장하지 않고, sha256 해시만 보관
export interface StoredMarkerChallenge {
  challengeId: string
  workspaceId: string
  sourceId: string
  actorId: string
  canonicalIdentity: string
  challengeHash: string
  expiresAt: string
  used: boolean
}

export interface MarkerChallengeDeps {
  saveChallenge: (challenge: StoredMarkerChallenge) => Promise<void>
  findChallenge: (challengeId: string) => Promise<StoredMarkerChallenge | null>
  consumeChallengeCAS: (challengeId: string) => Promise<boolean>
  fetchProfileMarker: (source: LearningSource) => Promise<string | null>
  actorId: string
  now?: () => Date
}

// 반드시 실제 콘텐츠/프로필 읽기 권한이 포함되어야 함 (단순 publish scope만으로는 학습 불가)
const REQUIRED_READ_SCOPES: Record<'instagram' | 'threads', readonly string[]> = {
  instagram: ['instagram_basic', 'instagram_business_basic', 'instagram_graph_user_profile'],
  threads: ['threads_basic'],
}

export async function verifyLearningOwnership(
  source: LearningSource,
  deps: OwnershipVerificationDeps,
): Promise<EvidenceLease> {
  const now = deps.now ? deps.now() : new Date()

  if (source.deletedAt !== null) {
    throw new LearningError('SOURCE_DELETED', '[SOURCE_DELETED] 삭제된 채널 출처는 소유권을 검증할 수 없습니다.')
  }

  if (source.verification === 'revoked') {
    throw new LearningError(
      'SOURCE_REVOKED',
      '[SOURCE_REVOKED] 철회된 채널 출처는 소유권을 재검증할 수 없으며 새로 등록해야 합니다.',
    )
  }

  if (source.platform !== 'instagram' && source.platform !== 'threads') {
    throw new LearningError(
      'VERIFICATION_NOT_SUPPORTED',
      `[VERIFICATION_NOT_SUPPORTED] ${source.platform} 플랫폼은 OAuth 소유권 검증을 지원하지 않습니다.`,
    )
  }

  if (!isVerificationSupported(source.platform, 'oauth')) {
    throw new LearningError(
      'VERIFICATION_BLOCKED',
      `[VERIFICATION_BLOCKED] ${source.platform} 플랫폼은 자동 검증이 차단되어 있습니다.`,
    )
  }

  const credential = await deps.getOAuthCredential(source.workspaceId, source.platform)
  if (!credential || !credential.accessToken) {
    throw new LearningError('OAUTH_NOT_CONNECTED', '[OAUTH_NOT_CONNECTED] 연결된 OAuth 계정이 없습니다.')
  }

  if (!credential.providerAccountId || !credential.providerAccountId.trim()) {
    throw new LearningError(
      'OAUTH_CREDENTIAL_INVALID',
      '[OAUTH_CREDENTIAL_INVALID] OAuth 자격 증명에 공급자 계정 ID가 누락되었습니다.',
    )
  }

  // OAuth 토큰 만료 여부 확인
  let credentialExpMs: number | null = null
  if (credential.expiresAt) {
    credentialExpMs = new Date(credential.expiresAt).getTime()
    if (isNaN(credentialExpMs) || credentialExpMs <= now.getTime()) {
      throw new LearningError('OAUTH_TOKEN_EXPIRED', '[OAUTH_TOKEN_EXPIRED] OAuth 액세스 토큰이 만료되었습니다.')
    }
  }

  // 필수 읽기 권한(Scope) 검증 - 단순 publish scope만 있는 경우 읽기 불가로 차단
  const allowedReadScopes = REQUIRED_READ_SCOPES[source.platform]
  const hasReadScope = credential.scopes.some((scope) => allowedReadScopes.includes(scope))
  if (!hasReadScope) {
    throw new LearningError(
      'INSUFFICIENT_SCOPES',
      `[INSUFFICIENT_SCOPES] ${source.platform} 채널 학습에 필요한 필수 읽기 권한(scope)이 부족합니다.`,
    )
  }

  // Provider /me live 검증
  const me = await deps.fetchProviderMe(source.platform, credential.accessToken)

  if (!me.id || !me.id.trim()) {
    throw new LearningError(
      'PROVIDER_IDENTITY_INVALID',
      '[PROVIDER_IDENTITY_INVALID] 공급자 계정 식별자가 유효하지 않습니다.',
    )
  }

  // Subject(Provider Account ID) 정합성 확인
  if (credential.providerAccountId !== me.id) {
    throw new LearningError(
      'OAUTH_SUBJECT_MISMATCH',
      `[OAUTH_SUBJECT_MISMATCH] 토큰 소유자 ID(${credential.providerAccountId})와 Provider ID(${me.id})가 일치하지 않습니다.`,
    )
  }

  // Username 매칭 검증
  if (me.username.toLowerCase() !== source.canonicalIdentity.toLowerCase()) {
    throw new LearningError(
      'IDENTITY_MISMATCH',
      `[IDENTITY_MISMATCH] 인증된 계정(${me.username})과 등록 주소(${source.canonicalIdentity})가 일치하지 않습니다.`,
    )
  }

  // 같은 username이지만 provider id가 재할당된 경우: fail-closed (이전 지식 오염 차단, 재등록 요구)
  const priorProviderAccountId = source.lease?.providerAccountId
  if (priorProviderAccountId && priorProviderAccountId !== me.id) {
    throw new LearningError(
      'IDENTITY_REASSIGNED',
      `[IDENTITY_REASSIGNED] 동일 사용자명이지만 소유자 공급자 ID(${priorProviderAccountId} -> ${me.id})가 변경되었습니다. 이전 지식 오염을 방지하기 위해 출처를 재등록해야 합니다.`,
    )
  }

  // lease expiresAt = min(now + 24h, credential.expiresAt)
  const maxLeaseDurationMs = 24 * 60 * 60 * 1000
  let leaseExpiresAtMs = now.getTime() + maxLeaseDurationMs
  if (credentialExpMs !== null) {
    leaseExpiresAtMs = Math.min(leaseExpiresAtMs, credentialExpMs)
  }
  const expiresAt = new Date(leaseExpiresAtMs).toISOString()

  return {
    workspaceId: source.workspaceId,
    sourceId: source.sourceId,
    revision: source.revision,
    providerAccountId: me.id,
    method: 'oauth',
    verifiedAt: now.toISOString(),
    expiresAt,
    revokedAt: null,
    evidenceRevision: (source.lease?.evidenceRevision ?? 0) + 1,
  }
}

export async function createMarkerChallenge(
  source: LearningSource,
  actorId: string,
  deps: MarkerChallengeDeps,
): Promise<{ challengeId: string; marker: string; expiresAt: string }> {
  const now = deps.now ? deps.now() : new Date()

  if (!actorId || !actorId.trim()) {
    throw new LearningError('INVALID_ACTOR', '[INVALID_ACTOR] 챌린지 생성 사용자(actorId)가 누락되었습니다.')
  }

  if (source.deletedAt !== null) {
    throw new LearningError('SOURCE_DELETED', '[SOURCE_DELETED] 삭제된 채널 출처는 마커를 발급할 수 없습니다.')
  }

  // capability 검증 - 지원되지 않거나 차단된 플랫폼은 마커 발급도 완전 차단 (테스트 override 없음)
  if (!isVerificationSupported(source.platform, 'profile_marker')) {
    throw new LearningError(
      'MARKER_VERIFICATION_BLOCKED',
      `[MARKER_VERIFICATION_BLOCKED] ${source.platform} 플랫폼은 마커 인증이 차단되어 있습니다.`,
    )
  }

  const token = randomBytes(16).toString('hex') // 128-bit 암호학적 난수
  const marker = `sohee-verify-${token}`
  const challengeId = randomUUID()
  const challengeHash = createHash('sha256').update(marker).digest('hex')
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString() // 15분 만료

  // 서버에는 marker 원문을 저장하지 않고 challengeHash만 안전하게 보관
  const stored: StoredMarkerChallenge = {
    challengeId,
    workspaceId: source.workspaceId,
    sourceId: source.sourceId,
    actorId,
    canonicalIdentity: source.canonicalIdentity,
    challengeHash,
    expiresAt,
    used: false,
  }

  await deps.saveChallenge(stored)

  return {
    challengeId,
    marker,
    expiresAt,
  }
}

export async function confirmMarkerChallenge(
  source: LearningSource,
  challengeId: string,
  deps: MarkerChallengeDeps,
): Promise<EvidenceLease> {
  const now = deps.now ? deps.now() : new Date()

  if (!deps.actorId || !deps.actorId.trim()) {
    throw new LearningError('INVALID_ACTOR', '[INVALID_ACTOR] 챌린지 확인 사용자(actorId)가 누락되었습니다.')
  }

  if (source.deletedAt !== null) {
    throw new LearningError('SOURCE_DELETED', '[SOURCE_DELETED] 삭제된 채널 출처는 검증할 수 없습니다.')
  }

  // 1. 플랫폼 capability 및 profile_marker 활성화 여부 검증
  if (!isVerificationSupported(source.platform, 'profile_marker')) {
    throw new LearningError(
      'MARKER_VERIFICATION_BLOCKED',
      `[MARKER_VERIFICATION_BLOCKED] ${source.platform} 플랫폼은 마커 인증이 지원되지 않거나 차단되어 있습니다.`,
    )
  }

  // 2. 챌린지 조회
  const challenge = await deps.findChallenge(challengeId)
  if (!challenge) {
    throw new LearningError('CHALLENGE_NOT_FOUND', '[CHALLENGE_NOT_FOUND] 챌린지를 찾을 수 없습니다.')
  }

  // 3. Replay 방지 (이미 사용된 챌린지 거부)
  if (challenge.used) {
    throw new LearningError('CHALLENGE_ALREADY_USED', '[CHALLENGE_ALREADY_USED] 이미 사용된 챌린지입니다.')
  }

  // 4. 유효시간 검증 (15분 만료)
  const expiresAtTime = new Date(challenge.expiresAt).getTime()
  if (isNaN(expiresAtTime) || expiresAtTime < now.getTime()) {
    throw new LearningError('CHALLENGE_EXPIRED', '[CHALLENGE_EXPIRED] 챌린지 유효시간(15분)이 만료되었습니다.')
  }

  // 5. 바인딩 검증 (workspace, source, identity)
  if (
    challenge.workspaceId !== source.workspaceId ||
    challenge.sourceId !== source.sourceId ||
    challenge.canonicalIdentity.toLowerCase() !== source.canonicalIdentity.toLowerCase()
  ) {
    throw new LearningError('CHALLENGE_BINDING_MISMATCH', '[CHALLENGE_BINDING_MISMATCH] 챌린지 바인딩 정보가 일치하지 않습니다.')
  }

  // 6. 실행자(Actor) 바인딩 검증
  if (challenge.actorId !== deps.actorId) {
    throw new LearningError('ACTOR_MISMATCH', '[ACTOR_MISMATCH] 챌린지를 발급한 사용자와 확인 요청자가 일치하지 않습니다.')
  }

  // 7. 실제 프로필 마커 조회 및 암호학적 Hash 검증
  const actualMarker = await deps.fetchProfileMarker(source)
  if (!actualMarker || !actualMarker.trim()) {
    throw new LearningError('MARKER_NOT_FOUND', '[MARKER_NOT_FOUND] 프로필에서 확인 마커를 찾을 수 없습니다.')
  }

  const actualHash = createHash('sha256').update(actualMarker.trim()).digest('hex')
  if (actualHash !== challenge.challengeHash) {
    throw new LearningError('MARKER_HASH_MISMATCH', '[MARKER_HASH_MISMATCH] 프로필 마커 해시가 챌린지와 일치하지 않습니다.')
  }

  // 8. 챌린지 원자적 소비 (CAS)
  const consumed = await deps.consumeChallengeCAS(challengeId)
  if (!consumed) {
    throw new LearningError('CHALLENGE_ALREADY_USED', '[CHALLENGE_ALREADY_USED] 이미 사용되었거나 소비 중인 챌린지입니다.')
  }

  const leaseDurationMs = 24 * 60 * 60 * 1000 // 24시간
  const expiresAt = new Date(now.getTime() + leaseDurationMs).toISOString()

  return {
    workspaceId: source.workspaceId,
    sourceId: source.sourceId,
    revision: source.revision,
    providerAccountId: null,
    method: 'profile_marker',
    verifiedAt: now.toISOString(),
    expiresAt,
    revokedAt: null,
    evidenceRevision: (source.lease?.evidenceRevision ?? 0) + 1,
  }
}

export function createProductionOwnershipDeps(options: {
  getCredentialRecord: (
    workspaceId: string,
    platform: 'instagram' | 'threads',
  ) => Promise<{ accessToken: string; scopes?: string[]; providerAccountId?: string; expiresAt?: string } | null>
  fetchMe: (
    platform: 'instagram' | 'threads',
    accessToken: string,
  ) => Promise<ProviderMeResult>
}): OwnershipVerificationDeps {
  return {
    getOAuthCredential: async (workspaceId, platform) => {
      const record = await options.getCredentialRecord(workspaceId, platform)
      if (!record) return null
      return {
        accessToken: record.accessToken,
        // 가짜 권한 부여 금지: scopes가 없으면 빈 배열([])로 반환하여 엄격 검증
        scopes: record.scopes ?? [],
        providerAccountId: record.providerAccountId ?? '',
        expiresAt: record.expiresAt,
      }
    },
    fetchProviderMe: options.fetchMe,
  }
}
