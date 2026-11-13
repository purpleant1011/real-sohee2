import type { EvidenceLease, LearningSource } from './contracts'

export const RENEWAL_WINDOW_MS = 18 * 60 * 60 * 1000 // 18 hours
export const MAX_LEASE_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours
export const RETRY_BACKOFF_MS = 15 * 60 * 1000 // 15 minutes

export interface VerificationRenewalDeps {
  verifyOwnership: (source: LearningSource) => Promise<EvidenceLease>
  now?: () => Date
}

export interface VerificationRenewalResult {
  state: 'renewed' | 'retry' | 'revoked' | 'expired'
  lease?: EvidenceLease
  nextCheckAt?: string
}

export function isRenewalEligible(lease: EvidenceLease, now?: Date): boolean {
  const nowTime = (now ?? new Date()).getTime()
  const verifiedAtTime = new Date(lease.verifiedAt).getTime()
  if (isNaN(verifiedAtTime)) return true
  return nowTime - verifiedAtTime >= RENEWAL_WINDOW_MS
}

export async function renewLearningVerification(
  source: LearningSource,
  deps: VerificationRenewalDeps,
): Promise<VerificationRenewalResult> {
  const now = deps.now ? deps.now() : new Date()

  // 1. 소스 삭제 또는 철회 상태 확인
  if (source.deletedAt !== null || source.verification === 'revoked') {
    return { state: 'revoked' }
  }

  // 2. 기존 lease 확인
  if (!source.lease) {
    return { state: 'expired' }
  }

  const expiresAtTime = new Date(source.lease.expiresAt).getTime()
  const isPastExpiration = isNaN(expiresAtTime) || now.getTime() >= expiresAtTime

  // 3. 소유권 재검증 시도
  try {
    const renewedLease = await deps.verifyOwnership(source)
    return {
      state: 'renewed',
      lease: renewedLease,
    }
  } catch (error: unknown) {
    const err = error as { status?: number; code?: string; message?: string }
    const status = err.status
    const code = err.code ?? ''
    const message = err.message ?? ''

    const isRateLimit = status === 429 || /429|rate limit/i.test(message)
    const isServerError = typeof status === 'number' && status >= 500 && status < 600
    const isTransient = isRateLimit || isServerError || /timeout|network|econnrefused/i.test(message)

    // 일시적 오류(429 등)이면서 아직 24시간 lease가 남아있는 경우 유효 증거 유지 및 retry
    if (isTransient && !isPastExpiration) {
      return {
        state: 'retry',
        lease: source.lease,
        nextCheckAt: new Date(now.getTime() + RETRY_BACKOFF_MS).toISOString(),
      }
    }

    // 이미 24시간이 경과한 상태에서 실패하면 expired
    if (isPastExpiration) {
      return { state: 'expired' }
    }

    // 명시적 인증 상실(401, 403, 토큰 철회, 계정 불일치 등)은 즉시 revoked
    const isAuthFailure =
      status === 401 ||
      status === 403 ||
      code.includes('OAUTH') ||
      code.includes('IDENTITY') ||
      /unauthorized|forbidden|revoked/i.test(message)

    if (isAuthFailure) {
      return { state: 'revoked' }
    }

    return { state: 'retry', lease: source.lease, nextCheckAt: new Date(now.getTime() + RETRY_BACKOFF_MS).toISOString() }
  }
}
