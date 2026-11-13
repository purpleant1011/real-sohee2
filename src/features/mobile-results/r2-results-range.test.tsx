import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { R2Results } from './r2-results'

vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ShellScreen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const WS = '11111111-1111-4111-8111-111111111111'
const PERIOD = { start: '2026-10-01T00:00:00.000Z', end: '2026-10-08T00:00:00.000Z' }
const RANGE_START = '2026-10-01'
const RANGE_END = '2026-10-07'
const RANGE_QUERY = `?start=${RANGE_START}&end=${RANGE_END}`

// 시트가 '오늘 이후'를 판정하는 기준일을 고정한다(타이머는 건드리지 않아 waitFor 가 돈다).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-24T13:05:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function observed(value: number, overrides: Record<string, unknown> = {}) {
  return {
    value,
    state: 'OBSERVED',
    source: 'external_action_receipts.independent_publish_readback',
    period: PERIOD,
    observedAt: new Date().toISOString(),
    evidenceIds: ['ev-1'],
    ...overrides,
  }
}

function weeklyReport(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WS,
    datasetMode: 'ACTUAL',
    period: PERIOD,
    metrics: {
      verifiedPublishedPosts: observed(3),
      storedComments: observed(9),
      bookingConfirmed: observed(2, { source: 'reservations.created_at/current_status' }),
      paymentCapturedVerified: observed(2, { source: 'reservations.created_at/current_status' }),
      revenue: observed(1_000_000),
    },
    generatedAt: new Date().toISOString(),
    ...overrides,
  }
}

const okResponse = (payload: unknown) => ({ status: 200, ok: true, json: async () => payload })
const apiUrl = (query: string) => `/api/workspaces/${WS}/reports/weekly${query}`

/** 시트를 열어 구간을 채우고 확인한다. 확인 버튼이 눌리려면 구간이 화면 규칙을 통과해야 한다. */
function selectRange() {
  fireEvent.click(screen.getByRole('button', { name: '직접 선택' }))
  fireEvent.change(screen.getByLabelText('시작일'), { target: { value: RANGE_START } })
  fireEvent.change(screen.getByLabelText('종료일'), { target: { value: RANGE_END } })
  fireEvent.click(screen.getByRole('button', { name: '이 기간 보기' }))
}

describe('M20 직접 선택 기간 배선(ANI-1782)', () => {
  it('직접 선택하면 같은 읽기 API 에 start·end 만 넘기고 period 는 붙이지 않는다', async () => {
    const fetchMock = vi.fn(async () => okResponse(weeklyReport()))
    vi.stubGlobal('fetch', fetchMock)
    render(<R2Results workspaceId={WS} />)

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    selectRange()

    // 정확히 구간 쿼리여야 한다 — period 가 함께 붙으면 서버가 400 으로 닫는다.
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      apiUrl(RANGE_QUERY),
      expect.objectContaining({ cache: 'no-store' }),
    ))
    // 주소도 같이 옮겨 새로고침해도 보던 구간이 남는다.
    expect(window.location.search).toBe(RANGE_QUERY)
  })

  it('서버가 400 으로 닫으면 숫자 없이 사유만 보여준다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse(weeklyReport()))
      .mockResolvedValueOnce({ status: 400, ok: false, json: async () => ({ error: '조회 기간을 확인해 주세요.' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<R2Results workspaceId={WS} />)

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    selectRange()

    const reason = await screen.findByText('이 기간의 기록을 불러오지 못했어요. 다른 기간을 골라 주세요.')
    expect(reason).toHaveAttribute('role', 'alert')
    expect(screen.queryByText('3건')).toBeNull()
    expect(screen.queryByText('0건')).toBeNull()
  })

  it('구간을 바꾸는 동안 이전 숫자를 새 구간 라벨 아래 그리지 않는다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse(weeklyReport()))
      .mockReturnValueOnce(new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<R2Results workspaceId={WS} />)

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    selectRange()

    expect(screen.queryByText('3건')).toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  // 회귀: 구간이 없을 때 프리셋 URL 은 예전과 100% 같아야 한다.
  it('구간이 없으면 지난주는 여전히 period 쿼리 하나다', async () => {
    const fetchMock = vi.fn(async () => okResponse(weeklyReport()))
    vi.stubGlobal('fetch', fetchMock)
    render(<R2Results workspaceId={WS} initialPeriod="previous" />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      apiUrl('?period=previous'),
      expect.objectContaining({ cache: 'no-store' }),
    ))
  })

  it('지표 카드 링크에도 고른 구간이 유지된다', async () => {
    const fetchMock = vi.fn(async () => okResponse(weeklyReport()))
    vi.stubGlobal('fetch', fetchMock)
    render(<R2Results workspaceId={WS} />)

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    selectRange()

    const link = await screen.findByRole('link', { name: '게시 확인 어디서 확인했는지 보기' })
    expect(link.getAttribute('href')).toBe(`/app/results/published${RANGE_QUERY}`)
  })
})
