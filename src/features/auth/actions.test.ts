import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = {
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
}

vi.mock('../../lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth })),
}))

import {
  requestPasswordResetAction,
  signInAction,
  signOutAction,
  signUpAction,
  updatePasswordAction,
} from './actions'

describe('auth actions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    delete process.env.APP_URL
  })

  it('rejects malformed sign-in input with the action-result error contract', async () => {
    const result = await signInAction({ email: 'not-an-email', password: '', next: '/app/work' })

    expect(result).toEqual({
      error: {
        message: '입력 내용을 확인해 주세요.',
        requestId: 'auth',
      },
    })
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('returns only a designed Korean message when Supabase rejects a sign-in', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error('raw provider error containing sensitive context'),
    })

    const result = await signInAction({
      email: 'person@example.com',
      password: 'safe-password',
      next: 'https://evil.example',
    })

    expect(result).toEqual({
      error: {
        message: '이메일 또는 비밀번호를 확인해 주세요.',
        requestId: 'auth',
      },
    })
  })

  it('logs a safe sign-in event without serializing credentials or provider errors', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error('raw provider error containing sensitive context'),
    })

    await signInAction({
      email: 'person@example.com',
      password: 'ANI94_LOG_SECRET_MARKER',
      next: '/admin',
    })

    expect(info).toHaveBeenCalledWith('[sohee:auth-sign-in]', {
      outcome: 'rejected',
      requestId: 'auth',
    })
    expect(JSON.stringify(info.mock.calls)).not.toContain('ANI94_LOG_SECRET_MARKER')
    expect(JSON.stringify(info.mock.calls)).not.toContain('raw provider error')
    info.mockRestore()
  })

  it('returns a validated internal next path after password sign-in', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    })

    const result = await signInAction({
      email: 'person@example.com',
      password: 'safe-password',
      next: '/app/work/123',
    })

    expect(result).toEqual({ data: { next: '/app/work/123' } })
  })

  it('returns the canonical admin path after legacy operator sign-in without widening customer paths', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    })

    await expect(signInAction({
      email: 'operator@example.com',
      password: 'safe-password',
      next: '/admin/system',
    })).resolves.toEqual({ data: { next: '/admin/system' } })

    await expect(signInAction({
      email: 'operator@example.com',
      password: 'safe-password',
      next: 'https://evil.example',
    })).resolves.toEqual({ data: { next: '/app' } })
  })

  it('기존 계정의 8자 미만 비밀번호도 Supabase 로그인으로 전달한다', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    })

    const result = await signInAction({
      email: 'person@example.com',
      password: 'legacy!',
      next: '/app',
    })

    expect(result).toEqual({ data: { next: '/app' } })
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'legacy!',
    })
  })

  it('returns a designed message when sign-up fails', async () => {
    auth.signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error('provider detail'),
    })

    const result = await signUpAction({ email: 'person@example.com', password: 'safe-password', termsVersion: '2026-08-24', privacyVersion: '2026-08-24', marketingConsent: false })

    expect(result).toEqual({
      error: {
        message: '회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        requestId: 'auth',
      },
    })
  })

  it('uses the first-party callback when requesting email sign-up', async () => {
    auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: 'user-id' } },
      error: null,
    })

    const result = await signUpAction({
      email: 'person@example.com',
      password: 'safe-password',
      termsVersion: '2026-08-24',
      privacyVersion: '2026-08-24',
      marketingConsent: false,
    })

    expect(result).toEqual({ data: { message: '회원가입 안내를 이메일로 보냈습니다.' } })
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'safe-password',
      options: {
        emailRedirectTo: 'http://localhost:3000/auth/callback?next=/start',
        data: {
          signup_consent: {
            marketing_consent: false,
            privacy_version: '2026-08-24',
            terms_version: '2026-08-24',
          },
        },
      },
    })
  })

  it('uses the fixed callback path when requesting a password reset', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })

    const result = await requestPasswordResetAction({ email: 'person@example.com' })

    expect(result).toEqual({ data: { message: '비밀번호 재설정 안내를 이메일로 보냈습니다.' } })
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('person@example.com', {
      redirectTo: 'http://localhost:3000/auth/callback?next=/reset-password',
    })
  })

  it('converts sign-out failures to a safe result', async () => {
    auth.signOut.mockResolvedValue({ error: new Error('provider detail') })

    const result = await signOutAction()

    expect(result).toEqual({
      error: {
        message: '로그아웃을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        requestId: 'auth',
      },
    })
  })

  it('does not leak validation exceptions from password updates', async () => {
    const result = await updatePasswordAction({ password: 'short' })

    expect(result).toEqual({
      error: {
        message: '입력 내용을 확인해 주세요.',
        requestId: 'auth',
      },
    })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
})
