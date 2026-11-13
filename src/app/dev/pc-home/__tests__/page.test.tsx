import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { notFound } from 'next/navigation'
import PcHomeDevPage from '../page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  useSearchParams: () => new URLSearchParams('state=full'),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dev/pc-home',
}))

describe('PcHomeDevPage (개발 전용 미리보기 페이지)', () => {

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('운영(production) 환경에서는 404 notFound()를 호출한다', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(PcHomeDevPage({ searchParams: Promise.resolve({ state: 'full' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('개발 환경에서는 DEV PREVIEW 헤더와 함께 렌더링된다', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const jsx = await PcHomeDevPage({ searchParams: Promise.resolve({ state: 'full' }) })
    render(jsx)

    expect(screen.getByText('DEV PREVIEW')).toBeInTheDocument()
    expect(screen.getByText(/PC 3열 홈 시각 검수용 하네스/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'FULL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'EMPTY' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ERROR' })).toBeInTheDocument()
  })
})
