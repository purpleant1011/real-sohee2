import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
const refresh = vi.fn()
const operatorSignOutAction = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
}))

vi.mock('@/features/operator-auth/actions', () => ({
  operatorSignOutAction: (...args: unknown[]) => operatorSignOutAction(...args),
}))

import { OperatorLogoutButton } from './operator-logout-button'

describe('OperatorLogoutButton', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('redirects to /admin-login after successful operator logout', async () => {
    operatorSignOutAction.mockResolvedValue({ success: true })
    render(<OperatorLogoutButton />)

    fireEvent.click(screen.getByRole('button', { name: '관리자 로그아웃' }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin-login'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows error message when logout action fails', async () => {
    operatorSignOutAction.mockResolvedValue({
      success: false,
      error: '세션 종료 실패',
    })
    render(<OperatorLogoutButton />)

    fireEvent.click(screen.getByRole('button', { name: '관리자 로그아웃' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('세션 종료 실패')
    expect(replace).not.toHaveBeenCalled()
  })
})
