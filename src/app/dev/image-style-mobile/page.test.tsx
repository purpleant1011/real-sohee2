// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
}))

import ImageStyleMobileDevPage from './page'

describe('ImageStyleMobileDevPage', () => {
  it('renders image style mobile harness in development', () => {
    vi.stubEnv('NODE_ENV', 'development')

    render(<ImageStyleMobileDevPage />)
    expect(screen.getByRole('heading', { level: 1, name: '이미지 스타일' })).toBeInTheDocument()
    expect(screen.getAllByText('꽃다발과 계절 소품의 디테일').length).toBeGreaterThan(0)

    vi.unstubAllEnvs()
  })
})
