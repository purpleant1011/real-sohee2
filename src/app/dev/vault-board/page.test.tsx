import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'
import VaultBoardPreviewPage from './page'

vi.mock('next/navigation', () => ({ notFound: vi.fn(() => { throw new Error('not found') }) }))

describe('development-only vault board', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('shows static Korean-labelled board fixtures without API calls', () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<VaultBoardPreviewPage />)
    expect(screen.getByText('외부 게시 0건')).toBeInTheDocument()
    expect(screen.getByText('발행 준비 완료 · 외부 게시 전')).toBeInTheDocument()
  })
  it('returns 404 in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => VaultBoardPreviewPage({})).toThrow('not found')
    expect(notFound).toHaveBeenCalledOnce()
  })
})
