import { describe, expect, it, vi } from 'vitest'
import type { OperatorSetupContext } from './setup-context'
import {
  getAdminMfaStep,
  mapMfaError,
  enrollTotp,
  startTotpChallenge,
  verifyTotp,
} from './mfa-client'

const context = (overrides: Partial<OperatorSetupContext> = {}): OperatorSetupContext => ({
  status: 'invited', emailConfirmed: true, passwordSet: true,
  hasVerifiedTotp: false, hasRole: true, currentAal: 'aal1', ...overrides,
})

describe('admin MFA state machine', () => {
  it('selects enroll when there is no verified TOTP', () => {
    expect(getAdminMfaStep(context())).toBe('enroll')
  })

  it('selects challenge for a verified TOTP at AAL1', () => {
    expect(getAdminMfaStep(context({ hasVerifiedTotp: true }))).toBe('challenge')
  })

  it('selects activate for an invited operator at AAL2', () => {
    expect(getAdminMfaStep(context({ hasVerifiedTotp: true, currentAal: 'aal2' }))).toBe('activate')
  })

  it('selects complete for an active operator at AAL2', () => {
    expect(getAdminMfaStep(context({ status: 'active', hasVerifiedTotp: true, currentAal: 'aal2' }))).toBe('complete')
  })

  it('selects challenge for an active operator recovering from AAL1', () => {
    expect(getAdminMfaStep(context({ status: 'active', hasVerifiedTotp: true, currentAal: 'aal1' }))).toBe('challenge')
  })
})

describe('browser MFA flow', () => {
  it('enrolls a TOTP factor and returns enrollment result with secret and uri', async () => {
    const enroll = vi.fn().mockResolvedValue({ data: { id: 'factor-id', totp: { qr_code: 'data:image/png;base64,qr', secret: 'secret', uri: 'otpauth://totp/x' } }, error: null })
    const listFactors = vi.fn().mockResolvedValue({ data: { all: [{ id: 'old-unverified', status: 'unverified' }] }, error: null })
    const unenroll = vi.fn().mockResolvedValue({ data: {}, error: null })
    const result = await enrollTotp({ auth: { mfa: { enroll, listFactors, unenroll } } })
    expect(listFactors).toHaveBeenCalled()
    expect(unenroll).toHaveBeenCalledWith({ factorId: 'old-unverified' })
    expect(enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'Sohee 관리자' })
    expect(result).toEqual({ id: 'factor-id', qrCode: 'data:image/png;base64,qr', secret: 'secret', uri: 'otpauth://totp/x' })
  })

  it('uses the existing factor for challenge and never retries verification', async () => {
    const challenge = vi.fn().mockResolvedValue({ data: { id: 'challenge-id' }, error: null })
    const verify = vi.fn().mockRejectedValue(new Error('secret-provider-detail'))
    const client = { auth: { mfa: { challenge, verify } } }
    await expect(startTotpChallenge(client, 'factor-id')).resolves.toEqual({ id: 'challenge-id' })
    await expect(verifyTotp(client, 'factor-id', 'challenge-id', '123456')).rejects.toMatchObject({ code: 'MFA_VERIFY_FAILED' })
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('maps provider failures to safe codes without leaking details', () => {
    const mapped = mapMfaError(new Error('secret-provider-detail'))
    expect(mapped).toEqual({ code: 'MFA_OPERATION_FAILED', message: 'MFA 설정을 완료하지 못했습니다. 다시 시도해 주세요.' })
    expect(JSON.stringify(mapped)).not.toContain('secret-provider-detail')
  })
})
