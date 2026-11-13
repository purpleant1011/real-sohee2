import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  usePathname: () => '/dev/mobile-r2/customers-list',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

import CustomersListDevPage from './customers-list/page'
import CustomersDetailDevPage from './customers-detail/page'

afterEach(() => vi.unstubAllEnvs())

describe('고객 폭 검수용 개발 페이지 — 운영 비노출', () => {
  it('목록 하네스는 운영(production)에서 404 로 끝난다', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => render(<CustomersListDevPage />)).toThrow('NEXT_NOT_FOUND')
  })

  it('상세 하네스는 운영(production)에서 404 로 끝난다', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => render(<CustomersDetailDevPage />)).toThrow('NEXT_NOT_FOUND')
  })

  it('개발 환경에서는 예시 고객 화면을 그린다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<CustomersListDevPage />)
    expect(screen.getByRole('heading', { name: '고객', level: 1 })).toBeVisible()
    expect(screen.getByText(/예시 화면이에요/)).toBeVisible()
  })

  it('개발 환경의 상세 하네스도 예시 고객 한 명만 그린다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<CustomersDetailDevPage />)
    expect(screen.getByRole('heading', { name: '김예시', level: 1 })).toBeVisible()
  })
})
