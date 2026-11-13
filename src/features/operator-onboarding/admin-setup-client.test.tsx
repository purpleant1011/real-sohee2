import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { OperatorSetupContext } from './setup-context'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  enroll: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
  listFactors: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
  createBrowserSupabaseClient: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }))
vi.mock('@/lib/supabase/client', () => ({ createBrowserSupabaseClient: mocks.createBrowserSupabaseClient }))

import AdminSetupClient from './admin-setup-client'

const context: OperatorSetupContext = {
  status: 'invited', emailConfirmed: true, passwordSet: false,
  hasVerifiedTotp: false, hasRole: true, currentAal: 'aal1',
}

describe('AdminSetupClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createBrowserSupabaseClient.mockReturnValue({ auth: { mfa: {
      enroll: mocks.enroll,
      challenge: mocks.challenge,
      verify: mocks.verify,
      listFactors: mocks.listFactors,
      getAuthenticatorAssuranceLevel: mocks.getAuthenticatorAssuranceLevel,
    } } })
  })

  it('consumes password action success accessibly and advances explicitly to MFA enrollment', async () => {
    const passwordAction = vi.fn().mockResolvedValue({ data: { code: 'password_recorded' } })
    render(<AdminSetupClient context={context} passwordAction={passwordAction} activationAction={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/새 비밀번호/), { target: { value: 'safe-password' } })
    fireEvent.change(screen.getByLabelText(/비밀번호 확인/), { target: { value: 'safe-password' } })
    fireEvent.click(screen.getByRole('button', { name: /비밀번호 설정/ }))
    expect(await screen.findByText('비밀번호 설정이 완료되었습니다. 2단계 인증(MFA) 등록을 시작해 주세요.')).toBeInTheDocument()
    expect(screen.getByText(/2단계: 2차 인증\(MFA\) 등록/)).toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('consumes password action failures without exposing provider details', async () => {
    const passwordAction = vi.fn().mockResolvedValue({ error: { message: '비밀번호 설정을 완료하지 못했습니다. 다시 시도해 주세요.', requestId: 'admin-setup-password' } })
    render(<AdminSetupClient context={context} passwordAction={passwordAction} activationAction={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/새 비밀번호/), { target: { value: 'safe-password' } })
    fireEvent.change(screen.getByLabelText(/비밀번호 확인/), { target: { value: 'safe-password' } })
    fireEvent.click(screen.getByRole('button', { name: /비밀번호 설정/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('비밀번호 설정을 완료하지 못했습니다. 다시 시도해 주세요.'))
    expect(screen.queryByText(/raw provider|secret|password/i)).not.toBeInTheDocument()
  })

  it('starts the challenge with the newly enrolled factor without reading verified factors', async () => {
    mocks.enroll.mockResolvedValue({
      data: { id: 'new-factor-id', totp: { qr_code: 'data:image/png;base64,qr', secret: 'secret', uri: 'otpauth://totp/x' } },
      error: null,
    })
    mocks.challenge.mockResolvedValue({ data: { id: 'new-challenge-id' }, error: null })
    render(<AdminSetupClient
      context={{ ...context, passwordSet: true }}
      passwordAction={vi.fn()}
      activationAction={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: /TOTP QR 코드 생성하기/ }))

    await waitFor(() => expect(mocks.challenge).toHaveBeenCalledWith({ factorId: 'new-factor-id' }))
    expect(screen.getByLabelText(/인증 앱에 표시된 6자리 코드/)).toBeInTheDocument()
  })

  it('replaces the setup route with admin after verified activation', async () => {
    const activationAction = vi.fn().mockResolvedValue({ data: { code: 'mfa_activated' } })
    render(<AdminSetupClient
      context={{ ...context, passwordSet: true, hasVerifiedTotp: true, currentAal: 'aal2' }}
      passwordAction={vi.fn()}
      activationAction={activationAction}
    />)

    fireEvent.click(screen.getByRole('button', { name: /관리자 계정 활성화 완료/ }))

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/admin'))
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('returns an active AAL1 administrator to admin after the existing factor reaches AAL2', async () => {
    mocks.listFactors.mockResolvedValue({ data: { totp: [{ id: 'verified-factor-id' }] }, error: null })
    mocks.challenge.mockResolvedValue({ data: { id: 'existing-challenge-id' }, error: null })
    mocks.verify.mockResolvedValue({ data: {}, error: null })
    mocks.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2' }, error: null })
    const activationAction = vi.fn()
    render(<AdminSetupClient
      context={{ ...context, status: 'active', passwordSet: true, hasVerifiedTotp: true }}
      passwordAction={vi.fn()}
      activationAction={activationAction}
    />)

    fireEvent.click(screen.getByRole('button', { name: /기존 등록된 OTP 코드로 인증하기/ }))
    await waitFor(() => expect(mocks.challenge).toHaveBeenCalledWith({ factorId: 'verified-factor-id' }))
    fireEvent.change(screen.getByLabelText(/인증 앱에 표시된 6자리 코드/), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /6자리 코드 확인 및 인증/ }))

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/admin'))
    expect(activationAction).not.toHaveBeenCalled()
  })

  it('uses injected MFA and navigation dependencies without creating a production browser client', () => {
    const injectedClient = { auth: { mfa: {
      enroll: vi.fn(), challenge: vi.fn(), verify: vi.fn(), listFactors: vi.fn(),
      getAuthenticatorAssuranceLevel: vi.fn(),
    } } }
    const navigation = { refresh: vi.fn(), replace: vi.fn() }

    render(<AdminSetupClient
      context={{ ...context, passwordSet: true }}
      passwordAction={vi.fn()}
      activationAction={vi.fn()}
      mfaClient={injectedClient}
      navigation={navigation}
    />)

    expect(mocks.createBrowserSupabaseClient).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /TOTP QR 코드 생성하기/ })).toBeInTheDocument()
  })
})
