import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const { notFound } = vi.hoisted(() => ({ notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))
vi.mock('next/navigation', () => ({
  notFound,
  usePathname: () => '/dev/mobile-account',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/features/account/profile-image-card', () => ({
  ProfileImageCard: () => <div data-testid="profile-image-card">프로필 사진 카드</div>,
}))

import MobileAccountDevPage from './page'

describe('MobileAccountDevPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NODE_ENV', 'development')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('운영(production) 환경에서는 404 notFound()를 호출한다', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => MobileAccountDevPage()).toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('개발 환경에서는 데모 안내 배너와 개인정보 관리 뷰를 렌더링한다', () => {
    render(<MobileAccountDevPage />)

    expect(screen.getByText(/\[개발 프리뷰\]/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('소희 테스트 대표')).toBeInTheDocument()
    expect(screen.getByText('demo-owner@example.com')).toBeInTheDocument()
  })
})
