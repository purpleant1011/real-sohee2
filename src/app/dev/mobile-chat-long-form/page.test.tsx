import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'

import MobileChatLongFormPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found')
  }),
}))

describe('development-only chat long-form preview', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('검수 화면임을 밝히고 긴 원고를 접힌 채로 보여 준다', () => {
    vi.stubEnv('NODE_ENV', 'development')

    render(<MobileChatLongFormPage />)

    expect(screen.getByText('긴 원고 검수 화면')).toBeInTheDocument()
    expect(screen.getByText(/예시 화면이에요/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '더 보기' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '길게 쓰기' })).toBeInTheDocument()
  })

  it('운영에서는 404', () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(() => MobileChatLongFormPage()).toThrow('not found')
    expect(notFound).toHaveBeenCalledOnce()
  })
})
