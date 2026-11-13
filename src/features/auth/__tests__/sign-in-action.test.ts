import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  cookieDelete: vi.fn(),
  cookieSet: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ delete: mocks.cookieDelete, set: mocks.cookieSet })),
}))
vi.mock('../../../lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth: {
    signInWithPassword: mocks.signInWithPassword,
    signOut: mocks.signOut,
  } })),
}))

import { signInAction, signOutAction } from '../actions'
import { LEGACY_OPERATOR_COOKIE_NAME } from '../../operator-auth/legacy-cookie-name'

describe('Supabase-only sign-in and obsolete cookie cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    mocks.signOut.mockResolvedValue({ error: null })
  })

  it('sends the former administrator email and any password through Supabase, never creates a separate session', async () => {
    const credentials = { email: 'admin@example.com', password: 'previous-password', next: '/admin' }
    const result = await signInAction(credentials)
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: credentials.email, password: credentials.password,
    })
    expect(result.data?.next).toBe('/admin')
    expect(mocks.cookieSet).not.toHaveBeenCalled()
  })

  it('does not accept a rejected Supabase login even for the former administrator address', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: new Error('invalid credentials') })
    const result = await signInAction({ email: 'admin@example.com', password: 'previous-password', next: '/admin' })
    expect(result.error?.message).toBe('이메일 또는 비밀번호를 확인해 주세요.')
    expect(mocks.cookieSet).not.toHaveBeenCalled()
  })

  it('expires the obsolete cookie during logout', async () => {
    await signOutAction()
    expect(mocks.cookieDelete).toHaveBeenCalledWith(LEGACY_OPERATOR_COOKIE_NAME)
    expect(mocks.signOut).toHaveBeenCalledOnce()
  })
})
