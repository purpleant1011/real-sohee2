import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'
import EngagementQaDevPage from './page'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dev/engagement-qa',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/features/publish-readiness/readiness-card', () => ({
  ReadinessCard: () => null,
}))

describe('EngagementQaDevPage', () => {
  it('renders synthetic sample warning banner and sample comments in non-production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<EngagementQaDevPage />)

    expect(screen.getByText(/예시 데이터 · 실제 고객 전송 없음/i)).toBeDefined()
    expect(screen.getByText('@spring_breeze')).toBeDefined()
    expect(screen.getByText('@urban_walker')).toBeDefined()
    vi.unstubAllEnvs()
  })

  it('triggers notFound in production environment', () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      expect(() => EngagementQaDevPage()).toThrow('NEXT_NOT_FOUND')
      expect(notFound).toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
