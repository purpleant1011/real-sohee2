import { readFileSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BlogCopyDevPage from './page'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
afterEach(() => vi.unstubAllEnvs())

describe('combined marketing source and manuscript preview', () => {
  it('keeps server-only read model construction out of the client module graph', () => {
    const client = readFileSync('src/app/dev/blog-copy/preview.tsx', 'utf8')
    expect(client).not.toContain('getRevenueCommandReadModel')
  })

  it('keeps an unobserved shop read model separate from the labelled manuscript example', () => {
    render(BlogCopyDevPage())
    const missing = screen.getByRole('status')
    expect(within(missing).getByText(/예약·매출 원장이 연결되지 않아/)).toBeTruthy()
    expect(missing.textContent).toContain('미관측')
    expect(missing.textContent).not.toMatch(/0건|실측 시각|실시간 동기화/)
    expect(screen.getByRole('button', { name: '전체 복사' })).toBeTruthy()
    expect(screen.getByText(/저장·외부 게시를 실행하지 않아요/)).toBeTruthy()
  })

  it('does not expose the integration preview in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => BlogCopyDevPage()).toThrow('NOT_FOUND')
  })
})
