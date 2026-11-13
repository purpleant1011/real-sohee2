import { describe, it, expect, vi, beforeEach } from 'vitest'

const signInWithPasswordMock = vi.fn()

vi.mock('../../../lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
    },
  })),
}))

import { signInAction } from '../actions'

describe('Security Boundary: No Hardcoded Credential Bypass (ANI-754, ANI-725)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes all sign-in attempts through Supabase auth without hardcoded bypass', async () => {
    signInWithPasswordMock.mockResolvedValueOnce({
      error: null,
      data: { user: { id: 'admin-user-id', email: 'admin@example.com' } },
    })

    const result = await signInAction({
      email: 'admin@example.com',
      password: 'StrongAdminPassword123!',
      next: '/admin',
    })

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'StrongAdminPassword123!',
    })
    expect(result).toEqual({
      data: {
        next: '/admin',
      },
    })
  })

  it('rejects invalid credentials strictly via Supabase auth failure', async () => {
    signInWithPasswordMock.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials' },
    })

    const result = await signInAction({
      email: 'admin@example.com',
      password: 'InvalidPassword456!',
      next: '/admin',
    })

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'InvalidPassword456!',
    })
    expect(result).toEqual({
      error: {
        message: '이메일 또는 비밀번호를 확인해 주세요.',
        requestId: 'auth',
      },
    })
  })

  it('preserves standard customer login path for non-admin accounts', async () => {
    signInWithPasswordMock.mockResolvedValueOnce({
      error: null,
      data: { user: { id: 'customer-user-id', email: 'user@example.com' } },
    })

    const result = await signInAction({
      email: 'user@example.com',
      password: 'CustomerPassword123!',
      next: '/app',
    })

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'CustomerPassword123!',
    })
    expect(result).toEqual({
      data: {
        next: '/app',
      },
    })
  })
})
