import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NaverSearchObservationCard } from './naver-search-observation-card'
import type { BlogSearchObservation } from '../official-search-observation'

describe('NaverSearchObservationCard', () => {
  const baseObservation: BlogSearchObservation = {
    source: 'NAVER_OFFICIAL_BLOG_SEARCH_API',
    query: '강남 피부관리',
    sort: 'sim',
    start: 1,
    display: 100,
    requestedAt: '2026-11-03T10:00:00Z',
    respondedAt: '2026-11-03T10:00:01Z',
    status: 'OBSERVED_IN_SAMPLE',
    matchedCanonicalUrl: 'https://blog.naver.com/test_blog/123456',
    matchedSamplePosition: 4,
    sampleCount: 100,
    apiErrorCode: null,
    limitations: [
      '공식 검색 API 응답 표본 기준이며 네이버 통합검색 실제 노출 순위가 아니에요.',
    ],
    postAgeHint: 'WITHIN_24H',
  }

  it('renders card title, query, sort, sample count, and observation time', () => {
    render(<NaverSearchObservationCard observation={baseObservation} />)

    expect(screen.getByRole('heading', { name: /내 글의 검색 발견 현황/ })).toBeInTheDocument()
    expect(screen.getByText(/강남 피부관리/)).toBeInTheDocument()
    expect(screen.getByText(/관련도순/)).toBeInTheDocument()
    expect(screen.getByText(/100개/)).toBeInTheDocument()
    expect(screen.getByText(/2026-11-03/)).toBeInTheDocument()
    expect(
      screen.getByText('공식 검색 API 응답 표본 기준이며 네이버 통합검색 실제 노출 순위가 아니에요.'),
    ).toBeInTheDocument()
  })

  it('displays correct message and sample position for OBSERVED_IN_SAMPLE without banned words', () => {
    const { container } = render(<NaverSearchObservationCard observation={baseObservation} />)

    expect(screen.getByText('이 표본에서 내 글을 발견했어요')).toBeInTheDocument()
    const samplePositions = screen.getAllByText(/표본 내 4번째 항목/)
    expect(samplePositions.length).toBeGreaterThanOrEqual(1)

    // 금지어 검증: 1위, n위, 순위, 노출점수, 지수, C-Rank, D.I.A
    const textContent = container.textContent || ''
    expect(textContent).not.toMatch(/[0-9]+위/)
    expect(textContent).not.toMatch(/노출점수/)
    expect(textContent).not.toMatch(/지수/)
    expect(textContent).not.toMatch(/C-Rank/i)
    expect(textContent).not.toMatch(/D\.I\.A/i)
    // '순위가 아니에요' 같은 면책조항 문구 외에 순위 단독/칭찬 표현 금지
    const nonDisclaimerMatches = textContent.match(/(?<!실제 노출 )순위(?!가 아니에요)/g)
    expect(nonDisclaimerMatches).toBeNull()
  })

  it('displays correct message for NOT_FOUND_IN_SAMPLE with 24h notice', () => {
    const notFoundObservation: BlogSearchObservation = {
      ...baseObservation,
      status: 'NOT_FOUND_IN_SAMPLE',
      matchedCanonicalUrl: null,
      matchedSamplePosition: null,
      limitations: [
        '공식 검색 API 응답 표본 기준이며 네이버 통합검색 실제 노출 순위가 아니에요.',
        '전체 검색에서 제외됐다는 뜻이 아니에요.',
      ],
    }

    render(<NaverSearchObservationCard observation={notFoundObservation} />)

    expect(
      screen.getByText(
        '확인한 표본에서는 아직 발견하지 못했어요. 전체 검색에서 제외됐다는 뜻은 아니며, 게시 후 24시간 미만이면 반영을 기다릴 수 있어요',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('전체 검색에서 제외됐다는 뜻이 아니에요.')).toBeInTheDocument()
  })

  it('displays honest messages for NOT_CONFIGURED, RATE_LIMITED, UNAUTHORIZED, and API_ERROR', () => {
    const { rerender } = render(
      <NaverSearchObservationCard
        observation={{ ...baseObservation, status: 'NOT_CONFIGURED', matchedSamplePosition: null }}
      />,
    )
    expect(
      screen.getByText('검색 데이터를 아직 연결하지 않았어요. 글은 지금도 만들 수 있어요'),
    ).toBeInTheDocument()

    rerender(
      <NaverSearchObservationCard
        observation={{ ...baseObservation, status: 'RATE_LIMITED', matchedSamplePosition: null }}
      />,
    )
    expect(screen.getByText('검색 조회 한도가 잠시 찼어요')).toBeInTheDocument()

    rerender(
      <NaverSearchObservationCard
        observation={{ ...baseObservation, status: 'UNAUTHORIZED', matchedSamplePosition: null }}
      />,
    )
    expect(screen.getByText('네이버 검색 연동 인증 정보를 확인해 주세요')).toBeInTheDocument()

    rerender(
      <NaverSearchObservationCard
        observation={{ ...baseObservation, status: 'API_ERROR', matchedSamplePosition: null }}
      />,
    )
    expect(screen.getByText('검색 데이터를 일시적으로 가져오지 못했어요')).toBeInTheDocument()
  })

  it('handles null observation gracefully without rendering card', () => {
    const { container } = render(<NaverSearchObservationCard observation={null} />)
    expect(container.firstChild).toBeNull()
  })
})
