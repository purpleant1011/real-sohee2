import type { OperatorSetupContext } from './setup-context'

export type AdminMfaStep = 'password' | 'enroll' | 'challenge' | 'activate' | 'complete'

export type MfaClient = {
  auth: {
    mfa: {
      listFactors?(): Promise<{
        data: {
          all?: Array<{ id: string; factor_type?: string; status?: 'verified' | 'unverified'; friendly_name?: string }>
          totp?: Array<{ id: string; status?: 'verified' | 'unverified' }>
        } | null
        error: unknown
      }>
      enroll?(input: { factorType: 'totp'; friendlyName: string; issuer?: string }): Promise<{
        data: { id?: string; totp?: { qr_code?: string; secret?: string; uri?: string } } | null
        error: unknown
      }>
      unenroll?(input: { factorId: string }): Promise<{ data: unknown; error: unknown }>
      challenge?(input: { factorId: string }): Promise<{ data: { id?: string } | null; error: unknown }>
      verify?(input: { factorId: string; challengeId: string; code: string }): Promise<{ data: unknown; error: unknown }>
      getAuthenticatorAssuranceLevel?(): Promise<{
        data: { currentLevel?: string | null; nextLevel?: string | null; currentAuthenticationMethods?: unknown[] } | null
        error: unknown
      }>
    }
  }
}

export type AdminMfaBrowserClient = MfaClient & {
  auth: {
    mfa: MfaClient['auth']['mfa'] & {
      listFactors(): Promise<{
        data: {
          all?: Array<{ id: string; factor_type?: string; status?: 'verified' | 'unverified'; friendly_name?: string }>
          totp?: Array<{ id: string; status?: 'verified' | 'unverified' }>
        } | null
        error: unknown
      }>
      getAuthenticatorAssuranceLevel(): Promise<{
        data: { currentLevel?: string | null; nextLevel?: string | null; currentAuthenticationMethods?: unknown[] } | null
        error: unknown
      }>
    }
  }
}

export type TotpEnrollment = {
  id: string
  qrCode: string
  secret?: string
  uri?: string
}

export type MfaClientErrorCode = 'MFA_ENROLL_FAILED' | 'MFA_CHALLENGE_FAILED' | 'MFA_VERIFY_FAILED' | 'MFA_OPERATION_FAILED'

export class MfaClientError extends Error {
  readonly code: MfaClientErrorCode
  constructor(code: MfaClientErrorCode, message: string) {
    super(message)
    this.name = 'MfaClientError'
    this.code = code
  }
}

const safeMessage = 'MFA 설정을 완료하지 못했습니다. 다시 시도해 주세요.'

export function mapMfaError(error: unknown): { code: 'MFA_OPERATION_FAILED'; message: string } {
  if (error instanceof MfaClientError && error.message && error.message !== safeMessage) {
    return { code: 'MFA_OPERATION_FAILED', message: error.message }
  }
  return { code: 'MFA_OPERATION_FAILED', message: safeMessage }
}

export function getAdminMfaStep(context: OperatorSetupContext): AdminMfaStep {
  if (!context.passwordSet) return 'password'
  if (context.status === 'active' && context.currentAal === 'aal2') return 'complete'
  if (context.status === 'invited' && context.currentAal === 'aal2') return 'activate'
  return context.hasVerifiedTotp ? 'challenge' : 'enroll'
}

export async function cleanupUnverifiedFactors(client: MfaClient): Promise<void> {
  if (!client.auth.mfa.listFactors || !client.auth.mfa.unenroll) return
  try {
    const { data } = await client.auth.mfa.listFactors()
    const all = data?.all || []
    const totp = data?.totp || []
    for (const factor of all) {
      if (factor.status === 'unverified' && factor.id) {
        await client.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {})
      }
    }
    for (const factor of totp) {
      if (factor.status === 'unverified' && factor.id) {
        await client.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {})
      }
    }
  } catch {
    // Non-blocking cleanup
  }
}

export async function resetAllMfaFactors(client: MfaClient): Promise<void> {
  if (!client.auth.mfa.listFactors || !client.auth.mfa.unenroll) return
  try {
    const { data } = await client.auth.mfa.listFactors()
    const all = data?.all || []
    const totp = data?.totp || []
    for (const factor of all) {
      if (factor.id) {
        await client.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {})
      }
    }
    for (const factor of totp) {
      if (factor.id) {
        await client.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {})
      }
    }
  } catch {
    // Non-blocking reset
  }
}

export async function enrollTotp(client: MfaClient): Promise<TotpEnrollment> {
  try {
    if (!client.auth.mfa.enroll) throw new Error('enroll unavailable')

    // 1. 기존 unverified factor 사전 정리
    await cleanupUnverifiedFactors(client)

    // 2. 신규 TOTP factor 등록 시도
    let res = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Sohee 관리자' })

    // 3. 만약 기존 factor 충돌(422)로 실패한 경우 전체 factor 강제 정리 후 1회 재시도
    if (res.error && client.auth.mfa.listFactors && client.auth.mfa.unenroll) {
      await resetAllMfaFactors(client)
      res = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Sohee 관리자' })
    }

    const id = res.data?.id
    const totp = res.data?.totp
    if (res.error || !id || !totp?.secret) {
      const errMsg = typeof res.error === 'object' && res.error && 'message' in res.error
        ? String(res.error.message)
        : 'enroll failed'
      throw new Error(errMsg)
    }

    // 4. SVG QR 코드 포맷 안전 정규화
    let qrCode = totp.qr_code || ''
    if (qrCode && !qrCode.startsWith('data:') && qrCode.includes('<svg')) {
      qrCode = `data:image/svg+xml;utf-8,${encodeURIComponent(qrCode)}`
    }

    const result: TotpEnrollment = { id, qrCode }
    if (totp.secret) result.secret = totp.secret
    if (totp.uri) result.uri = totp.uri
    return result
  } catch (err: unknown) {
    const msg = err instanceof Error && err.message && !err.message.includes('unavailable') && !err.message.includes('enroll failed')
      ? err.message
      : safeMessage
    throw new MfaClientError('MFA_ENROLL_FAILED', msg)
  }
}

export async function startTotpChallenge(client: MfaClient, factorId: string): Promise<{ id: string }> {
  try {
    if (!client.auth.mfa.challenge) throw new Error('challenge unavailable')
    const { data, error } = await client.auth.mfa.challenge({ factorId })
    if (error || !data?.id) throw new Error('challenge failed')
    return { id: data.id }
  } catch {
    throw new MfaClientError('MFA_CHALLENGE_FAILED', safeMessage)
  }
}

export async function verifyTotp(client: MfaClient, factorId: string, challengeId: string, code: string): Promise<void> {
  try {
    if (!client.auth.mfa.verify) throw new Error('verify unavailable')
    const { error } = await client.auth.mfa.verify({ factorId, challengeId, code })
    if (error) throw new Error('verify failed')
  } catch {
    throw new MfaClientError('MFA_VERIFY_FAILED', safeMessage)
  }
}
