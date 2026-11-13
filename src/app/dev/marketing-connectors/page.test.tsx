import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import DevMarketingConnectorsPage from './page'

const mockNotFound = vi.fn()
vi.mock('next/navigation', () => ({
  notFound: () => {
    mockNotFound()
    throw new Error('NEXT_NOT_FOUND')
  },
}))

describe('DevMarketingConnectorsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('production 환경에서는 notFound를 호출한다', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SOHEE_LOCAL_E2E', '1')

    expect(() => DevMarketingConnectorsPage()).toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalledTimes(1)
  })

  it('SOHEE_LOCAL_E2E가 1이 아니면 notFound를 호출한다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SOHEE_LOCAL_E2E', '0')

    expect(() => DevMarketingConnectorsPage()).toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalledTimes(1)
  })

  it('NODE_ENV !== production && SOHEE_LOCAL_E2E === 1 조건에서만 픽스처를 렌더링한다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SOHEE_LOCAL_E2E', '1')

    render(<DevMarketingConnectorsPage />)

    expect(screen.getByText(/개발 픽스처 환경입니다/i)).toBeInTheDocument()
    expect(screen.getByText('커넥터')).toBeInTheDocument()
    expect(screen.getByText('Instagram')).toBeInTheDocument()
  })
})
