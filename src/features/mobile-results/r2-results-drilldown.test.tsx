import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { R2ResultsDrilldown } from './r2-results-drilldown'

vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ShellScreen: ({ children, backHref }: { children: React.ReactNode; backHref?: string }) => (
    <>{children}<span data-testid="back-href">{backHref}</span></>
  ),
}))

const WS = '11111111-1111-4111-8111-111111111111'
const OTHER_WS = '22222222-2222-4222-8222-222222222222'
const PERIOD = { start: '2026-10-01T00:00:00.000Z', end: '2026-10-08T00:00:00.000Z' }
const FRESH = new Date().toISOString()

function observed(value: number | null, overrides: Record<string, unknown> = {}) {
  return {
    value,
    state: 'OBSERVED',
    source: 'external_action_receipts.independent_publish_readback',
    period: PERIOD,
    observedAt: FRESH,
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
    generatedAt: FRESH,
    ...overrides,
  }
}

const periodLabel = '2026.10.01 ~ 2026.10.08 (한국 시간 기준)'

function okResponse(payload: unknown) {
  return { status: 200, ok: true, json: async () => payload }
}

function renderDrilldown(metricId: string, period?: 'current' | 'previous') {
  return render(<R2ResultsDrilldown workspaceId={WS} metricId={metricId} period={period} />)
}

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  delete process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST
})

describe('/app/results/:id 근거 드릴다운(ANI-1706)', () => {
  it('지표 카드에서 확인한 값·출처·기간·기록 수를 보여준다', async () => {
    const fetchMock = vi.fn(async () => okResponse(weeklyReport()))
    vi.stubGlobal('fetch', fetchMock)
    renderDrilldown('published')

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    expect(screen.getAllByRole('heading', { name: '게시 확인' }).length).toBeGreaterThan(0)
    expect(screen.getByText('게시 확인 근거 기록')).toBeVisible()
    expect(screen.getByText(periodLabel)).toBeVisible()
    expect(screen.getByText('1건')).toBeVisible()
    expect(screen.getByText('아래 기록에서 확인한 숫자예요. 확인되지 않은 값은 더하지 않았어요.')).toBeVisible()
    expect(screen.getByRole('link', { name: '게시 확인하러 가기' })).toHaveAttribute('href', '/app/content')
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${WS}/reports/weekly`, expect.objectContaining({ cache: 'no-store' }))
  })

  it('없는 지표 주소는 숫자를 지어내지 않고 조회도 하지 않는다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderDrilldown('revenue')

    expect(await screen.findByText('그런 성과 항목을 찾지 못했어요')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
    // 지표 이름을 지어내지 않는다.
    expect(screen.queryByText('성과 자세히')).toBeVisible()
  })

  it('고객 문의는 댓글 수로 대신하지 않고 집계하지 않는다고 말한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport())))
    renderDrilldown('inquiries')

    expect(await screen.findByText('이 숫자는 집계하지 않아요')).toBeVisible()
    expect(screen.queryByText('9건')).toBeNull()
    expect(screen.getByText('고객 문의 집계 준비 중이에요. 새 문의는 소통함에서 볼 수 있어요.')).toBeVisible()
  })

  // 요약 화면이 숨긴 값을 드릴다운으로 직접 들어와 그리면 게이트를 우회한다.
  it('출처가 비어 있는 관측은 드릴다운에서도 숫자·근거를 그리지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport({
      metrics: {
        ...weeklyReport().metrics,
        verifiedPublishedPosts: observed(3, { source: '   ' }),
      },
    }))))
    renderDrilldown('published')

    expect(await screen.findByText('근거가 연결되지 않았어요')).toBeVisible()
    expect(screen.queryByText('3건')).toBeNull()
    // 근거 기록 수도, 출처 이름도 확인되지 않았으므로 붙이지 않는다.
    expect(screen.queryByText('1건')).toBeNull()
    expect(screen.queryByText('게시 확인 근거 기록')).toBeNull()
  })

  it('ACTUAL 이 아니면 숫자를 보여주지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport({ datasetMode: 'EXCLUDED' }))))
    renderDrilldown('published')

    expect(await screen.findByText('실제 기록이 아니에요')).toBeVisible()
    expect(screen.queryByText('3건')).toBeNull()
    expect(screen.getByText('실제 기록이 아니라서 숫자를 보여드리지 않아요.')).toBeVisible()
  })

  it('조회 실패는 0건이 아니라 실패로 보이고 다시 확인할 수 있다', async () => {
    const fetchMock = vi.fn(async () => ({ status: 500, ok: false, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    renderDrilldown('published')

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByText('불러오지 못했어요')).toBeVisible()
    expect(screen.queryByText('0건')).toBeNull()
    expect(screen.getByRole('link', { name: '목록으로 돌아가기' })).toHaveAttribute('href', '/app/results')

    fireEvent.click(screen.getByRole('button', { name: '다시 확인하기' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('권한이 없으면 빈 화면이 아니라 권한 없음으로 끝난다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, ok: false, json: async () => ({}) })))
    renderDrilldown('published')

    expect(await screen.findByText('이 내용을 볼 권한이 없어요')).toBeVisible()
  })

  it('네트워크가 끊긴 실패는 조회 실패와 다르게 말한다', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    renderDrilldown('published')

    expect(await screen.findByText('네트워크에 연결할 수 없습니다')).toBeVisible()
  })

  it('다른 가게 리포트는 숫자를 하나도 그리지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport({ workspaceId: OTHER_WS }))))
    renderDrilldown('published')

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByText('3건')).toBeNull()
  })

  it('지표 원천 조회만 실패하면 숫자 없이 실패를 알린다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport({
      metrics: { verifiedPublishedPosts: observed(null, { state: 'ERROR', value: null, evidenceIds: [] }) },
    }))))
    renderDrilldown('published')

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByText('불러오지 못했어요')).toBeVisible()
    expect(screen.queryByText(/건$/)).toBeNull()
  })

  it('오래된 응답은 최신 숫자처럼 보이지 않는다', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport({ generatedAt: twoHoursAgo }))))
    renderDrilldown('published')

    expect(await screen.findByText('이전에 확인한 내용')).toBeVisible()
    expect(screen.queryByText('3건')).toBeNull()
    expect(screen.getByText('마지막 확인이 오래돼서 숫자를 보여드리지 않아요. 다시 확인해 주세요.')).toBeVisible()
  })

  it('생성 시각이 없으면 오래됐다고 단정하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport({ generatedAt: undefined }))))
    renderDrilldown('published')

    // isWeeklyReport 가 generatedAt 을 요구하므로 모양이 깨진 응답은 error 로 닫힌다.
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByText('3건')).toBeNull()
  })

  // axe serious `scrollable-region-focusable` — 확인된 상태에는 누를 것이 없어
  // 셸의 스크롤 영역 안에 탭 도달 지점이 없었다.
  it('본문이 이름 있는 포커스 가능 영역이라 키보드로 내려갈 수 있다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport())))
    renderDrilldown('published')

    const region = await screen.findByRole('region', { name: '근거 상세 내용' })
    expect(region.tabIndex).toBe(0)
    expect(await screen.findByText('3건')).toBeVisible()
  })

  // ANI-1706 기간 선택 — 같은 읽기 API 의 기준 시각만 옮긴다(새 API·쓰기 경로 없음).
  it('지난주를 고르면 같은 읽기 API 에 period 를 붙이고 뒤로도 기간을 지킨다', async () => {
    const fetchMock = vi.fn(async () => okResponse(weeklyReport()))
    vi.stubGlobal('fetch', fetchMock)
    renderDrilldown('published', 'previous')

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${WS}/reports/weekly?period=previous`,
      expect.objectContaining({ cache: 'no-store' }),
    )
    expect(screen.getByTestId('back-href').textContent).toBe('/app/results?period=previous')
  })

  it('이번 주는 주소에 기간을 남기지 않는다', async () => {
    const fetchMock = vi.fn(async () => okResponse(weeklyReport()))
    vi.stubGlobal('fetch', fetchMock)
    renderDrilldown('published')

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${WS}/reports/weekly`, expect.anything())
    expect(screen.getByTestId('back-href').textContent).toBe('/app/results')
  })

  // ANI-1782 직접 선택 구간 — 목록에서 고른 구간을 상세도 그대로 들고 온다.
  it('직접 선택 구간은 조회·뒤로 가기 모두 start·end 로 남고 period 는 붙지 않는다', async () => {
    const fetchMock = vi.fn(async () => okResponse(weeklyReport()))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <R2ResultsDrilldown
        workspaceId={WS}
        metricId="published"
        period="previous"
        range={{ start: '2026-10-01', end: '2026-10-07' }}
      />,
    )

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    // 정확히 구간 쿼리여야 한다 — period 가 함께 붙으면 서버가 400 으로 닫는다.
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${WS}/reports/weekly?start=2026-10-01&end=2026-10-07`,
      expect.objectContaining({ cache: 'no-store' }),
    )
    expect(screen.getByTestId('back-href').textContent).toBe('/app/results?start=2026-10-01&end=2026-10-07')
  })
})

// M20 근거 기록 목록 진입(ANI-1783 2단계) — 목록은 플래그 뒤의 페이지다.
describe('근거 기록 목록 진입점', () => {
  it('플래그 ON 이고 확인된 숫자가 있으면 기간을 지켜 목록으로 보낸다', async () => {
    process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST = 'on'
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport())))
    renderDrilldown('published', 'previous')

    const link = await screen.findByRole('link', { name: '근거 기록 보기' })
    expect(link).toHaveAttribute('href', '/app/results/published/evidence?period=previous')
  })

  it('이번 주는 주소에 기간을 남기지 않는다', async () => {
    process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST = 'on'
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport())))
    renderDrilldown('published')

    expect(await screen.findByRole('link', { name: '근거 기록 보기' }))
      .toHaveAttribute('href', '/app/results/published/evidence')
  })

  it('플래그 OFF 면 없는 페이지로 보내지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport())))
    renderDrilldown('published')

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    expect(screen.queryByRole('link', { name: '근거 기록 보기' })).toBeNull()
  })

  it('연결된 기록이 없으면 목록으로 보내지 않는다', async () => {
    process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST = 'on'
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport({
      metrics: { verifiedPublishedPosts: observed(3, { evidenceIds: [] }) },
    }))))
    renderDrilldown('published')

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    expect(screen.queryByRole('link', { name: '근거 기록 보기' })).toBeNull()
  })

  it('조회 실패·오래된 응답에서는 목록으로 보내지 않는다', async () => {
    process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST = 'on'
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport({ generatedAt: twoHoursAgo }))))
    renderDrilldown('published')

    expect(await screen.findByText('이전에 확인한 내용')).toBeVisible()
    expect(screen.queryByRole('link', { name: '근거 기록 보기' })).toBeNull()
  })
})

describe('드릴다운 최근 기록 목록 및 StickyActionBar 실행 행동', () => {
  it('flag OFF 면 /evidence 조회를 보내지 않고 unavailable 안내를 보여준다', async () => {
    delete process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST
    const fetchMock = vi.fn(async () => okResponse(weeklyReport()))
    vi.stubGlobal('fetch', fetchMock)
    renderDrilldown('published')

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/evidence'), expect.anything())
    expect(screen.getByText('상세 기록 목록은 아직 제공되지 않아요. 관련 업무 화면에서 결과를 확인해 주세요.')).toBeVisible()
    expect(screen.queryByText('확인된 최근 기록이 없어요.')).toBeNull()
  })

  it.each([
    ['HTTP 404', () => ({ status: 404, ok: false, json: async () => ({}) })],
    ['200 state ERROR', () => okResponse({ state: 'ERROR', records: [] })],
    ['200 missing state', () => okResponse({ records: [] })],
  ])('flag ON 일 때 /evidence %s 면 거짓 빈값 대신 error 안내를 보여준다', async (_, createResponse) => {
    process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST = 'on'
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/evidence')) return createResponse()
      return okResponse(weeklyReport())
    })
    vi.stubGlobal('fetch', fetchMock)
    renderDrilldown('published')

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    expect(screen.getByText('상세 기록을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.')).toBeVisible()
    expect(screen.queryByText('확인된 최근 기록이 없어요.')).toBeNull()
  })

  it('flag ON 일 때 실제 OBSERVED 이고 기록이 0건이면 기존 확인된 최근 기록이 없어요 문구를 보여준다', async () => {
    process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST = 'on'
    const genuineEmptyReport = weeklyReport({
      metrics: { verifiedPublishedPosts: observed(0, { evidenceIds: [] }) },
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/evidence')) return okResponse({ state: 'OBSERVED', records: [], totalCount: 0 })
      return okResponse(genuineEmptyReport)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderDrilldown('published')

    await waitFor(() => expect(screen.getAllByText('0건').length).toBeGreaterThanOrEqual(1))
    expect(screen.getByText('확인된 최근 기록이 없어요.')).toBeVisible()
  })

  it('기록이 전달되면 최근 기록 3~5건을 목록으로 보여준다', async () => {
    process.env.NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST = 'on'
    const evidencePayload = {
      state: 'OBSERVED',
      records: [
        { summary: '인스타그램 게시물 홍보', occurredAt: '2026-10-05T09:00:00.000Z', kindLabel: '게시 확인' },
        { summary: '네이버 블로그 포스팅', occurredAt: '2026-10-06T10:30:00.000Z', kindLabel: '게시 확인' },
        { summary: '당근마켓 피드 홍보', occurredAt: '2026-10-07T14:15:00.000Z', kindLabel: '게시 확인' },
      ],
      totalCount: 3,
      hasMore: false,
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/evidence')) return okResponse(evidencePayload)
      return okResponse(weeklyReport())
    })
    vi.stubGlobal('fetch', fetchMock)
    renderDrilldown('published')

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    expect(await screen.findByText('인스타그램 게시물 홍보')).toBeVisible()
    expect(screen.getByText('네이버 블로그 포스팅')).toBeVisible()
    expect(screen.getByText('당근마켓 피드 홍보')).toBeVisible()
    expect(screen.getByRole('region', { name: '최근 기록' })).toBeVisible()
  })

  it('지표 종류에 따라 하단 StickyActionBar 에 적절한 단일 실행 행동이 나타난다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(weeklyReport())))
    const { unmount } = renderDrilldown('bookings')
    await waitFor(() => expect(screen.getByText('2건')).toBeVisible())
    expect(screen.getByRole('link', { name: '예약 일정 확인하러 가기' })).toHaveAttribute('href', '/app/schedule')
    unmount()

    renderDrilldown('deposits')
    await waitFor(() => expect(screen.getByText('2건')).toBeVisible())
    expect(screen.getByRole('link', { name: '예약 장부 확인하러 가기' })).toHaveAttribute('href', '/app/schedule')
  })
})
