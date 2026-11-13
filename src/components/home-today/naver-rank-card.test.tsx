import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NaverRankCard } from './naver-rank-card'
import type { BlogSearchObservation } from '@/features/naver-publish/official-search-observation'

describe('NaverRankCard', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when there is no observation data or fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
    } as any)

    const { container } = render(<NaverRankCard workspaceId={workspaceId} />)
    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  it('does not present an unobserved status as a success (keeps empty state)', async () => {
    const unobserved: BlogSearchObservation = {
      source: 'NAVER_OFFICIAL_BLOG_SEARCH_API',
      query: '테스트',
      sort: 'sim',
      start: 1,
      display: 100,
      requestedAt: '2026-11-03T00:00:00Z',
      respondedAt: '2026-11-03T00:00:01Z',
      status: 'NOT_FOUND_IN_SAMPLE',
      matchedCanonicalUrl: null,
      matchedSamplePosition: null,
      sampleCount: 100,
      apiErrorCode: null,
      limitations: ['공식 검색 API 응답 표본 기준이며 네이버 통합검색 실제 노출 순위가 아니에요.'],
      postAgeHint: 'WITHIN_24H',
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => unobserved,
    } as any)

    const { container } = render(<NaverRankCard workspaceId={workspaceId} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('shows official search observation without claiming ranking or score', async () => {
    const observed: BlogSearchObservation = {
      source: 'NAVER_OFFICIAL_BLOG_SEARCH_API',
      query: '강남역속눈썹',
      sort: 'sim',
      start: 1,
      display: 100,
      requestedAt: '2026-11-03T00:00:00Z',
      respondedAt: '2026-11-03T00:00:01Z',
      status: 'OBSERVED_IN_SAMPLE',
      matchedCanonicalUrl: 'https://blog.naver.com/byreum/123',
      matchedSamplePosition: 4,
      sampleCount: 100,
      apiErrorCode: null,
      limitations: ['공식 검색 API 응답 표본 기준이며 네이버 통합검색 실제 노출 순위가 아니에요.'],
      postAgeHint: 'WITHIN_24H',
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => observed,
    } as any)

    const { container } = render(<NaverRankCard workspaceId={workspaceId} />)

    expect(await screen.findByRole('heading', { name: /내 글의 검색 발견 현황/ })).toBeInTheDocument()
    expect(screen.getByText('이 표본에서 내 글을 발견했어요')).toBeInTheDocument()
    expect(screen.getAllByText(/표본 내 4번째 항목/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/강남역속눈썹/)).toBeInTheDocument()

    // 금지어 검증
    const textContent = container.textContent || ''
    expect(textContent).not.toMatch(/[0-9]+위/)
    expect(textContent).not.toMatch(/노출점수/)
    expect(textContent).not.toMatch(/지수/)
    expect(textContent).not.toMatch(/C-Rank/i)
    expect(textContent).not.toMatch(/D\.I\.A/i)
  })
})
