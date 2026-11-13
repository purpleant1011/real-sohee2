import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { ReportsEntry } from './reports-entry'

// PC 레거시 콘솔은 정적 import 그대로다(동적 분기 없음) — 테스트도 같은 모듈을 대체한다.
vi.mock('./reports-view', () => ({ default: () => <p>legacy-reports</p> }))
vi.mock('next/navigation', () => ({ usePathname: () => '/app/reports', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }))

const WS = '11111111-1111-4111-8111-111111111111'
const period = { start: '2026-10-18T00:00:00.000Z', end: '2026-10-25T00:00:00.000Z' }

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}

function renderEntry(r2: boolean) {
  const tree = <ReportsEntry />
  return render(
    <WorkspaceProvider value={{ workspaceId: WS, workspaceName: '테스트', workspaceKind: 'standard', membershipRole: 'owner', actorId: 'user-1', resolutionSource: 'membership' }}>
      {r2 ? <MobileR2Provider enabled>{tree}</MobileR2Provider> : tree}
    </WorkspaceProvider>
  )
}

const observed = (value: number | null) => ({
  value, state: 'OBSERVED', source: 'supabase', period, observedAt: '2026-10-24T03:00:00.000Z', evidenceIds: ['ev-1'],
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
      verifiedPublishedPosts: observed(3),
      paymentCapturedVerified: observed(1),
      revenue: observed(1_000_000),
      hoursSaved: observed(null),
    },
    executiveSummary: '',
    generatedAt: '2026-10-24T03:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('/app/reports 모바일 R2 분기(ANI-1706 잔여 B)', () => {
  it('플래그 OFF(기본)면 기존 V088 화면이고 조회하지 않는다', () => {
    narrow(true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(false)

    expect(screen.getByText('legacy-reports')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('플래그 ON 이어도 넓은 화면이면 기존 화면 그대로다', () => {
    narrow(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(true)

    expect(screen.getByText('legacy-reports')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('PC 불변: 플래그 OFF 는 화면 폭과 무관하게 같은 레거시 화면을 즉시 그린다', () => {
    for (const matches of [true, false]) {
      narrow(matches)
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const { unmount } = renderEntry(false)

      // 동적 로딩 대기 없이 같은 레거시 화면이 첫 렌더에 보인다(PC 첫 렌더 불변).
      expect(screen.getByText('legacy-reports')).toBeVisible()
      expect(screen.queryByRole('heading', { name: '주간 보고' })).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('플래그 ON + 좁은 화면이면 기존 주간 리포트를 R2 주간 보고로 그린다', async () => {
    narrow(true)
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => weeklyReport() }))
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(true)

    await waitFor(() => expect(screen.getByText('3건')).toBeVisible())
    expect(screen.queryByText('legacy-reports')).toBeNull()
    expect(screen.getByRole('heading', { name: '주간 보고' })).toBeVisible()
    // 같은 읽기 API 만 쓰고, 성과 화면의 기간 파라미터는 붙이지 않는다.
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${WS}/reports/weekly`, expect.objectContaining({ cache: 'no-store' }))
    expect(screen.getByText('1,000,000원')).toBeVisible()
  })

  it('조회 실패는 0건이 아니라 오류로 보인다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    renderEntry(true)

    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible())
    expect(screen.getByText('불러오지 못했어요')).toBeVisible()
  })

  it('ACTUAL 이 아니면 숫자를 그리지 않는다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => weeklyReport({ datasetMode: 'EXCLUDED' }) })))
    renderEntry(true)

    await waitFor(() => expect(screen.getByText('실제 기록이 아니라서 숫자를 보여드리지 않아요.')).toBeVisible())
    expect(screen.queryByText('3건')).toBeNull()
  })
})
