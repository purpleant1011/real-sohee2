import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), listFactors: vi.fn(), challenge: vi.fn(), verify: vi.fn(), getAal: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }))
vi.mock('@/lib/supabase/client', () => ({ createBrowserSupabaseClient: () => ({ auth: { mfa: {
  listFactors: mocks.listFactors,
  challenge: mocks.challenge,
  verify: mocks.verify,
  getAuthenticatorAssuranceLevel: mocks.getAal,
} } }) }))

import AdminVerifyClient from './verify-client'

describe('AdminVerifyClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listFactors.mockResolvedValue({ data: { totp: [{ id: 'verified-factor', status: 'verified' }] }, error: null })
    mocks.challenge.mockResolvedValue({ data: { id: 'challenge' }, error: null })
    mocks.verify.mockResolvedValue({ data: {}, error: null })
    mocks.getAal.mockResolvedValue({ data: { currentLevel: 'aal2' }, error: null })
  })

  it('shows the code form for a verified factor and steps up before returning to an admin path', async () => {
    render(<AdminVerifyClient next="/admin/control-tower" />)
    fireEvent.change(screen.getByLabelText('인증 앱의 6자리 코드'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '인증하고 관리자 페이지로 이동' }))
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/admin/control-tower'))
    expect(mocks.challenge).toHaveBeenCalledWith({ factorId: 'verified-factor' })
    expect(mocks.verify).toHaveBeenCalledWith({ factorId: 'verified-factor', challengeId: 'challenge', code: '123456' })
  })

  it('redirects only to admin even when next is a malicious or unrelated path', async () => {
    render(<AdminVerifyClient next="//evil.example" />)
    fireEvent.change(screen.getByLabelText('인증 앱의 6자리 코드'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '인증하고 관리자 페이지로 이동' }))
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/admin'))
  })

  it('does not navigate when factor verification fails or AAL2 is unavailable', async () => {
    mocks.verify.mockResolvedValue({ data: null, error: new Error('invalid code') })
    render(<AdminVerifyClient next="/admin" />)
    fireEvent.change(screen.getByLabelText('인증 앱의 6자리 코드'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '인증하고 관리자 페이지로 이동' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})
