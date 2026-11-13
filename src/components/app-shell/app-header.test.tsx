import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/auth/actions', () => ({
  signOutAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

import { AppHeader } from './app-header'

describe('AppHeader', () => {
  it('keeps the section label separate from the page heading and groups account actions', () => {
    render(<AppHeader title="일정" unreadCount={3} />)

    expect(screen.getByText('일정')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '일정' })).not.toBeInTheDocument()
    expect(screen.getByText('작업공간 연결 전')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '검색 준비 중' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '대화 준비 중' })).not.toBeInTheDocument()

    expect(screen.getByRole('link', { name: '알림 열기' })).toHaveAttribute('href', '/app/notifications')
    expect(screen.getByText('3')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: '계정 메뉴 열기' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeEnabled()
  })
})
