import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { connection, getClaims, getCurrentOperatorSetupContext } = vi.hoisted(() => ({
  connection: vi.fn().mockResolvedValue(undefined),
  getClaims: vi.fn(),
  getCurrentOperatorSetupContext: vi.fn(),
}))
vi.mock('next/server', () => ({ connection }))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth: { getClaims } })),
}))
vi.mock('@/features/operator-onboarding/setup-context', () => ({ getCurrentOperatorSetupContext }))
vi.mock('@/features/operator-onboarding/actions', () => ({ updateInvitedOperatorPasswordAction: vi.fn(), activateInvitedOperatorAction: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`) }), useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({ createBrowserSupabaseClient: () => ({ auth: { mfa: { enroll: vi.fn(), challenge: vi.fn(), verify: vi.fn(), listFactors: vi.fn(), getAuthenticatorAssuranceLevel: vi.fn() } } }) }))

import AdminSetupPage, { submitAdminSetupPasswordAction } from './page'

describe('admin setup page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('waits for a request before initializing the authenticated service during prerender', async () => {
    const prerenderBoundary = new Error('request boundary')
    connection.mockRejectedValueOnce(prerenderBoundary)
    getClaims.mockResolvedValue({ data: { claims: null }, error: null })
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    await expect(AdminSetupPage()).rejects.toBe(prerenderBoundary)
    expect(createServerSupabaseClient).not.toHaveBeenCalled()
  })

  it('redirects an unauthenticated administrator to the dedicated login', async () => {
    getClaims.mockResolvedValue({ data: { claims: null }, error: null })

    await expect(AdminSetupPage()).rejects.toThrow(
      'REDIRECT:/admin-login?next=%2Fadmin',
    )
  })

  it('maps only the two password fields through the server action adapter', async () => {
    const formData = new FormData()
    formData.set('password', 'safe-password')
    formData.set('passwordConfirmation', 'safe-password')
    formData.set('unexpected', 'must-not-forward')

    await submitAdminSetupPasswordAction(formData)

    const { updateInvitedOperatorPasswordAction } = await import('@/features/operator-onboarding/actions')
    expect(updateInvitedOperatorPasswordAction).toHaveBeenCalledWith({
      password: 'safe-password',
      passwordConfirmation: 'safe-password',
    })
  })

  it('renders the password form only for an invited operator missing a password record', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'user-id' } }, error: null })
    getCurrentOperatorSetupContext.mockResolvedValue({
      status: 'invited', emailConfirmed: true, passwordSet: false,
      hasVerifiedTotp: false, hasRole: true, currentAal: 'aal1',
    })
    render(await AdminSetupPage())
    expect(screen.getByText(/1단계: 관리자 비밀번호 설정/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /비밀번호 설정/ })).toBeInTheDocument()
  })

  it('does not render a password form for a safe non-invited denial', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'user-id' } }, error: null })
    getCurrentOperatorSetupContext.mockResolvedValue({
      status: 'not_invited', emailConfirmed: true, passwordSet: false,
      hasVerifiedTotp: false, hasRole: false, currentAal: 'aal1',
    })
    render(await AdminSetupPage())
    expect(screen.queryByRole('button', { name: /비밀번호 설정/ })).not.toBeInTheDocument()
  })

  it('redirects an active AAL2 administrator to the protected admin route', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'user-id' } }, error: null })
    getCurrentOperatorSetupContext.mockResolvedValue({
      status: 'active', emailConfirmed: true, passwordSet: true,
      hasVerifiedTotp: true, hasRole: true, currentAal: 'aal2',
    })

    await expect(AdminSetupPage()).rejects.toThrow('REDIRECT:/admin')
  })

  it('redirects an active AAL1 administrator with verified factor to admin-verify', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'user-id' } }, error: null })
    getCurrentOperatorSetupContext.mockResolvedValue({
      status: 'active', emailConfirmed: true, passwordSet: true,
      hasVerifiedTotp: true, hasRole: true, currentAal: 'aal1',
    })

    await expect(AdminSetupPage()).rejects.toThrow('REDIRECT:/auth/admin-verify?next=%2Fadmin')
  })

  it('lets an active AAL1 administrator without a verified factor enroll MFA', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'user-id' } }, error: null })
    getCurrentOperatorSetupContext.mockResolvedValue({
      status: 'active', emailConfirmed: true, passwordSet: true,
      hasVerifiedTotp: false, hasRole: true, currentAal: 'aal1',
    })

    render(await AdminSetupPage())
    expect(screen.getByText(/2단계: 2차 인증\(MFA\) 등록/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /TOTP QR 코드 생성/ })).toBeInTheDocument()
  })
})

