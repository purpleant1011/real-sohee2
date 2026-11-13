import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { R2EvidenceRecordList } from './r2-evidence-record-list'

vi.mock('@/features/mobile-shell', () => ({
  MobileAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ShellScreen: ({ children, backHref }: { children: React.ReactNode; backHref?: string }) => (
    <>{children}<span data-testid="back-href">{backHref}</span></>
  ),
}))

const WS = '11111111-1111-4111-8111-111111111111'
const PERIOD = { start: '2026-10-13T00:00:00.000Z', end: '2026-10-19T23:59:59.000Z' }
const FRESH = new Date().toISOString()

function dto() {
  return {
    workspaceId: WS,
    metric: 'bookings',
    state: 'OBSERVED',
    datasetMode: 'ACTUAL',
    metricConnected: true,
    period: PERIOD,
    checkedAt: FRESH,
    observedAt: FRESH,
    totalCount: 1,
    records: [{
      recordRef: null, kind: 'BOOKING_CONFIRMED', kindLabel: '예약 확정',
      summary: '10월 18일 예약', occurredAt: '2026-10-18T05:00:00.000Z', detailHref: null,
    }],
    omittedUnknownCount: 0,
    hasMore: true,
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload }
}

function stubFetch(impl: (url: string) => unknown) {
  const spy = vi.fn((input: RequestInfo | URL) => Promise.resolve(impl(String(input))))
  vi.stubGlobal('fetch', spy)
  return spy
}

function renderList(metricId = 'bookings', period?: 'current' | 'previous') {
  return render(<R2EvidenceRecordList workspaceId={WS} metricId={metricId} period={period} />)
}

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
})

describe('R2EvidenceRecordList — 조회 배선', () => {
  it('새 읽기 경로를 no-store 로 부르고 기간·뒤로가기를 드릴다운과 맞춘다', async () => {
    const spy = stubFetch(() => jsonResponse(dto()))

    renderList('bookings', 'previous')

    await screen.findByRole('list', { name: '근거 기록 목록' })
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`/api/workspaces/${WS}/results/bookings/evidence?period=previous`)
    expect(init).toEqual({ cache: 'no-store' })
    expect(screen.getByTestId('back-href')).toHaveTextContent(`/app/results/bookings?period=previous`)
  })

  it('없는 지표 주소는 조회하지 않고 찾지 못함으로 닫는다', async () => {
    const spy = stubFetch(() => jsonResponse(dto()))

    renderList('revenue')

    await screen.findByText('그런 기록을 찾지 못했어요')
    expect(spy).not.toHaveBeenCalled()
    expect(screen.queryByRole('list', { name: '근거 기록 목록' })).toBeNull()
  })

  it('401 은 세션 만료로, 404 는 찾지 못함으로 닫는다', async () => {
    stubFetch(() => jsonResponse(null, 401))
    const first = renderList()
    await screen.findByText('로그인이 만료됐어요')
    first.unmount()

    stubFetch(() => jsonResponse({ error: '기록을 찾을 수 없어요.' }, 404))
    renderList()
    await screen.findByText('그런 기록을 찾지 못했어요')
  })

  it('서버 ERROR 응답은 0건이 아니라 실패로 그린다', async () => {
    stubFetch(() => jsonResponse({
      ...dto(), state: 'ERROR', totalCount: null, records: [], hasMore: true,
    }))

    renderList()

    await screen.findByRole('alert')
    expect(screen.queryByText('0건')).toBeNull()
    expect(screen.queryByRole('list', { name: '근거 기록 목록' })).toBeNull()
  })

  it('네트워크가 끊긴 실패는 오프라인으로 닫는다', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    renderList()

    await screen.findByText('네트워크에 연결할 수 없습니다')
  })

  it('다시 확인하기는 같은 경로를 다시 부른다', async () => {
    const spy = stubFetch(() => jsonResponse({ error: '근거 기록을 불러오지 못했어요.' }, 500))

    renderList()

    const retry = await screen.findByRole('button', { name: '다시 확인하기' })
    expect(spy).toHaveBeenCalledTimes(1)
    fireEvent.click(retry)
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })

  it('본문이 DTO 가 아니면 레코드를 그리지 않는다', async () => {
    stubFetch(() => jsonResponse({ records: [{ summary: '유출되면 안 되는 값' }] }))

    renderList()

    await screen.findByRole('alert')
    expect(screen.queryByText('유출되면 안 되는 값')).toBeNull()
  })
})
