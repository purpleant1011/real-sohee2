import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      updateUser: mocks.updateUser,
    },
  }),
}))

import ResetPasswordPage from './page'

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('keeps the success message visible and lets the user choose the login link', async () => {
    mocks.updateUser.mockResolvedValue({ data: { user: {} }, error: null })

    render(<ResetPasswordPage />)

    fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: 'new-password' } })
    fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'new-password' } })
    fireEvent.submit(screen.getByRole('button', { name: '비밀번호 변경' }).closest('form')!)

    expect(await screen.findByRole('status')).toHaveTextContent(
      '비밀번호가 성공적으로 변경되었습니다.',
    )
    expect(screen.getByRole('link', { name: '로그인으로 이동' })).toHaveAttribute('href', '/login')
  })
})
