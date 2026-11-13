import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BlogStrategyReviewPage from './page'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
afterEach(() => vi.unstubAllEnvs())

describe('growth briefing local review', () => {
  it('is unavailable in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => BlogStrategyReviewPage()).toThrow('NOT_FOUND')
  })
  it('lets a reviewer explore blocked and unselected states without API calls', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NETWORK_FORBIDDEN'))
    try {
      render(BlogStrategyReviewPage())
      expect(screen.getByText(/실제 가게·고객 데이터가 아니며/)).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('시나리오'), { target: { value: 'blocked' } })
      expect(screen.getByRole('region', { name: '다음 행동' })).toHaveTextContent('최신 정보로 다시 확인')
      fireEvent.change(screen.getByLabelText('시나리오'), { target: { value: 'unselected' } })
      expect(screen.getByRole('region', { name: '제안 기회' })).toHaveTextContent('주제를 하나 골라')
      fireEvent.click(screen.getByRole('button', { name: '예시 처음으로' }))
      expect(screen.getByRole('region', { name: '다음 행동' })).toHaveTextContent('전략만 승인')
      expect(fetcher).not.toHaveBeenCalled()
    } finally { fetcher.mockRestore() }
  })
})
