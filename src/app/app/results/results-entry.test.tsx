import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { ResultsEntry } from './results-entry'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/results', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => <p>legacy-results</p> }))

const WS = '11111111-1111-4111-8111-111111111111'
const period = { start: '2026-10-01T00:00:00.000Z', end: '2026-10-08T00:00:00.000Z' }

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}

function renderEntry(r2: boolean, initialPeriod?: 'current' | 'previous', initialRange?: { start: string; end: string } | null) {
  const tree = <ResultsEntry initialPeriod={initialPeriod} initialRange={initialRange} />
  return render(
    <WorkspaceProvider value={{ workspaceId: WS, workspaceName: '테스트', workspaceKind: 'standard', membershipRole: 'owner', actorId: 'user-1', resolutionSource: 'membership' }}>
      {r2 ? <MobileR2Provider enabled>{tree}</MobileR2Provider> : tree}
    </WorkspaceProvider>
  )
}

const observed = (value: number | null, state = 'OBSERVED') => ({
  value, state, source: 'supabase', period, observedAt: '2026-10-24T03:00:00.000Z', evidenceIds: ['ev-1'],
})

function weeklyReport(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WS,
    datasetMode: 'ACTUAL',
    periodLabel: '이번 주',
    period,
    hoursSaved: null,
    costSavedWon: null,
    confirmedBookingsCount: null,
    totalRevenueWon: null,
    publishedPostsCount: null,
    engagementCount: null,
    metrics: {
      bookingConfirmed: observed(2),
      bookingCanceled: observed(0),
      verifiedPublishedPosts: observed(3),
      publicationPending: observed(1),
      storedComments: observed(9),
      paymentCapturedVerified: observed(2),
      revenue: observed(1_000_000),
      visitCompletedVerified: observed(1),
      hoursSaved: observed(null, 'NOT_OBSERVED'),
      costSavedWon: observed(null, 'NOT_OBSERVED'),
    },
    executiveSummary: '',
    generatedAt: '2026-10-24T03:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('/app/results 배선(ANI-1771)', () => {
  it('플래그 OFF(기본) 이면 기존 화면이고 새 API 호출이 없다', () => {
    narrow(true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(false)
    expect(screen.getByText('legacy-results')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('플래그 ON 이어도 넓은 화면이면 기존 화면이고 API 호출이 없다', () => {
    narrow(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(true)
    expect(screen.getByText('legacy-results')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('플래그 ON + 좁은 화면이면 기존 주간 리포트를 성과 화면으로 옮겨 그린다', async () => {
    narrow(true)
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => weeklyReport() }))
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(true)
    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    expect(screen.queryByText('legacy-results')).toBeNull()
    expect(screen.getByRole('heading', { name: '성과' })).toBeVisible()
    expect(screen.getByText('1,000,000원')).toBeVisible()
    // 고객 문의는 댓글 수와 다른 값이므로 숫자를 만들지 않는다.
    expect(screen.getByText('고객 문의')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${WS}/reports/weekly`, expect.objectContaining({ cache: 'no-store' }))
  })

  it('ACTUAL 이 아니면 숫자를 그리지 않는다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => weeklyReport({ datasetMode: 'EXCLUDED' }) })))
    renderEntry(true)
    await waitFor(() => expect(screen.getByText('실제 기록이 아니라서 숫자를 보여드리지 않아요.')).toBeVisible())
    expect(screen.queryByText('3건')).toBeNull()
  })

  it('조회 실패는 0건이 아니라 오류로 보인다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    renderEntry(true)
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
    expect(screen.getByText('불러오지 못했어요')).toBeVisible()
  })

  it('다른 가게 리포트는 숫자를 그리지 않고 오류로 끝난다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => weeklyReport({ workspaceId: 'other-ws' }) })))
    renderEntry(true)
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
    expect(screen.queryByText('3건')).toBeNull()
  })
})

// ANI-1706 기간 선택 — 새 API·쓰기 경로 없이 기존 주간 읽기 API 에 기준 시각만 넘긴다.
describe('/app/results 기간 선택(ANI-1706)', () => {
  it('지난주로 바꾸면 같은 읽기 API 에 period 를 붙이고, 바뀐 기간의 응답만 그린다', async () => {
    narrow(true)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => weeklyReport() })
      .mockResolvedValueOnce({ ok: true, json: async () => weeklyReport({
        periodLabel: '지난주',
        metrics: { bookingConfirmed: observed(5), verifiedPublishedPosts: observed(7) },
      }) })
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(true)

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: '지난주' }))

    // 이전 기간 숫자를 새 기간 라벨 아래 그리지 않는다.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${WS}/reports/weekly?period=previous`,
      expect.objectContaining({ cache: 'no-store' }),
    ))
    await waitFor(() => expect(screen.getByText('7건')).toBeVisible())
    expect(screen.queryByText('3건')).toBeNull()
    expect(screen.getByRole('button', { name: '지난주' }).getAttribute('aria-pressed')).toBe('true')
  })

  // 새로고침·탭 왕복 시 initialPeriod 는 searchParams 에서 복원되므로 주소도 같이 옮겨야 한다.
  it('기간을 바꾸면 주소도 같이 옮겨 새로고침해도 보던 기간이 남는다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => weeklyReport() })))
    renderEntry(true)
    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())

    fireEvent.click(screen.getByRole('button', { name: '지난주' }))
    expect(window.location.search).toBe('?period=previous')

    fireEvent.click(screen.getByRole('button', { name: '이번 주' }))
    expect(window.location.search).toBe('')
  })

  it('드릴다운에서 돌아올 때 보던 기간으로 다시 조회한다', async () => {
    narrow(true)
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => weeklyReport() }))
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(true, 'previous')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${WS}/reports/weekly?period=previous`,
      expect.anything(),
    ))
    expect(screen.getByRole('button', { name: '지난주' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('기간을 고른 뒤 지표 카드도 같은 기간을 들고 드릴다운으로 간다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => weeklyReport() })))
    renderEntry(true, 'previous')

    const link = await screen.findByRole('link', { name: '게시 확인 어디서 확인했는지 보기' })
    expect(link.getAttribute('href')).toBe('/app/results/published?period=previous')
  })
})

// ANI-1782 AC-7 — PC 화면은 직접 고른 구간을 그리지 않는다. 주소에 구간이 남아 있으면
// 어떤 기록을 보여주는지 한 줄로 밝혀, 주소와 숫자가 어긋난 채 읽히지 않게 한다.
describe('/app/results 직접 구간과 PC 화면(ANI-1782)', () => {
  const RANGE = { start: '2026-09-01', end: '2026-09-30' }
  const NOTICE = '직접 고른 기간은 모바일에서 볼 수 있어요. 여기서는 이번 주 기록을 보여드리고 있어요.'

  it('PC 는 구간을 조회하지 않고 이번 주 기록임을 밝힌다', () => {
    narrow(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderEntry(false, undefined, RANGE)

    expect(screen.getByText('legacy-results')).toBeVisible()
    expect(screen.getByText(NOTICE)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('구간이 없으면 PC 화면에 안내 문구가 붙지 않는다', () => {
    narrow(false)
    vi.stubGlobal('fetch', vi.fn())

    renderEntry(false)

    expect(screen.queryByText(NOTICE)).toBeNull()
  })
})
