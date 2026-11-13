import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('../../../features/auth/actions', () => ({
  signInAction: vi.fn(),
}))

import AdminLoginPage from './page'

describe('AdminLoginPage', () => {
  it('provides a distinct administrator login that returns to the protected console', async () => {
    render(await AdminLoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: '관리자 로그인' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: '관리자 로그인' })).toHaveAttribute('data-next', '/admin')
    expect(screen.getByRole('link', { name: '일반 사용자 로그인' })).toHaveAttribute('href', '/login')
  })

  it('keeps only a safe administrator return path', async () => {
    render(await AdminLoginPage({
      searchParams: Promise.resolve({ next: '/operator/system?tab=health' }),
    }))

    expect(screen.getByRole('form', { name: '관리자 로그인' })).toHaveAttribute(
      'data-next',
      '/admin/system?tab=health',
    )
  })
})
