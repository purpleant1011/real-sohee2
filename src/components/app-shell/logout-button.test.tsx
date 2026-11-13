import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
const refresh = vi.fn()
const signOutAction = vi.fn()
const clearPwaCaches = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}))

vi.mock('@/features/auth/actions', () => ({
  signOutAction: (...args: unknown[]) => signOutAction(...args),
}))

vi.mock('@/features/pwa/sw-client', () => ({
  clearPwaCaches: (...args: unknown[]) => clearPwaCaches(...args),
}))

import { LogoutButton } from './logout-button'

describe('LogoutButton', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns to the public home after Supabase clears the session', async () => {
    signOutAction.mockResolvedValue({ data: null })
    render(<LogoutButton />)

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps a recoverable visible error when the server cannot be reached', async () => {
    signOutAction.mockRejectedValue(new Error('internal server failure'))
    render(<LogoutButton />)
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    const error = await screen.findByRole('status')
    expect(error).toHaveTextContent('로그아웃을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(error.className).not.toContain('srOnly')
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeEnabled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('prevents duplicate logout while the session is being cleared', async () => {
    let resolve!: (value: { data: null }) => void
    signOutAction.mockReturnValue(new Promise(r => { resolve = r }))
    render(<LogoutButton />)
    const button = screen.getByRole('button', { name: '로그아웃' })
    fireEvent.click(button)
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(signOutAction).toHaveBeenCalledTimes(1)
    resolve({ data: null })
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(clearPwaCaches).toHaveBeenCalledTimes(1)
  })

  it('shows only the safe Korean error when logout fails', async () => {
    signOutAction.mockResolvedValue({
      error: { message: '로그아웃을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
    })
    render(<LogoutButton />)

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))

    const status = await screen.findByText(
      '로그아웃을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    )
    expect(status).toHaveAttribute('role', 'status')
    expect(replace).not.toHaveBeenCalled()
  })
})
