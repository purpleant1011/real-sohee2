// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import type { LedgerEntryDto } from '@/features/mobile-inbox/ledger-model'
import type { LedgerViewSnapshot } from '@/features/mobile-inbox/ledger-view'
import type { ScheduleBoard as BoardData } from '@/features/schedule/repository'
import { ScheduleBoard } from '@/features/schedule/schedule-board'
import { ScheduleEntry } from './schedule-entry'
import { buildLedgerSnapshot, type ReservationLedgerRow } from './ledger-snapshot'

const WS = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-10-24T05:00:00.000Z'

// 기존 화면은 NuqsAdapter 안에서 nuqs useQueryStates 가 정상 동작해야 한다.
vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="pc-shell">{children}</div>,
}))

vi.mock('@/features/schedule/schedule-board', async () => {
  const { useQueryStates, parseAsString } = await vi.importActual<typeof import('nuqs')>('nuqs')
  return {
    ScheduleBoard: () => {
      useQueryStates({ kind: parseAsString })
      return <p>legacy-schedule-board</p>
    },
  }
})

import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'

const refresh = vi.fn()
const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh,
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/schedule',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => mockRouter,
}))

const EMPTY_BOARD = {
  source: 'actual',
  partialData: false,
  unavailableSources: [],
  ready: [],
  plans: [],
  schedules: [],
  attempts: [],
  customerReservations: [],
  localPublishes: [],
  internalTasks: [],
} as unknown as BoardData

const BOARD = { data: EMPTY_BOARD, workspaceId: WS, role: 'owner' as const }

const ENTRY: LedgerEntryDto = {
  id: 'res_1',
  workspaceId: WS,
  customerName: '김민지',
  serviceLabel: '속눈썹 연장',
  startsAt: '2026-10-24T05:00:00.000Z',
  endsAt: '2026-10-24T06:30:00.000Z',
  status: 'confirmed',
  source: 'customer_accepted',
  ledgerVerifiedAt: NOW,
  otherSurfaceStatus: null,
}

function snapshot(overrides: Partial<LedgerViewSnapshot> = {}): LedgerViewSnapshot {
  return {
    loadState: 'ready',
    entries: [ENTRY],
    workspaceId: WS,
    timeZone: 'Asia/Seoul',
    now: NOW,
    complete: true,
    checkedAt: NOW,
    ...overrides,
  }
}

/** CSS 미디어 쿼리를 실제 px 로 판정한다. 게이트 경계(767)를 px 로 확인하기 위함. */
function matchesAt(query: string, px: number): boolean {
  const max = /\(max-width:\s*(\d+)px\)/.exec(query)
  const min = /\(min-width:\s*(\d+)px\)/.exec(query)
  const checks: boolean[] = []
  if (max) checks.push(px <= Number(max[1]))
  if (min) checks.push(px >= Number(min[1]))
  return checks.length > 0 && checks.every(Boolean)
}

function stubWidth(px: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matchesAt(query, px),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

const renderEntry = (ledger: LedgerViewSnapshot | null, enabled: boolean, px: number) => {
  stubWidth(px)
  return render(
    <AppRouterContext.Provider value={mockRouter as never}>
      <MobileR2Provider enabled={enabled}>
        <ScheduleEntry board={BOARD} ledger={ledger} />
      </MobileR2Provider>
    </AppRouterContext.Provider>,
  )
}

beforeEach(() => refresh.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('M15 /app/schedule 진입 게이트 — 모바일만 장부', () => {
  it('플래그 ON + 390px → R2 장부를 그린다', () => {
    renderEntry(snapshot(), true, 390)
    expect(screen.getByRole('heading', { level: 1, name: '예약표' })).toBeTruthy()
    expect(screen.queryByText('legacy-schedule-board')).toBeNull()
  })

  it('플래그 ON + 767px(경계) → R2 장부를 그린다', () => {
    renderEntry(snapshot(), true, 767)
    expect(screen.getByRole('heading', { level: 1, name: '예약표' })).toBeTruthy()
  })

  it.each([390, 767, 768, 820, 1024, 1440])(
    '플래그 OFF + %ipx → 기존 일정 화면 그대로',
    px => {
      // 플래그 OFF 면 서버가 스냅샷을 만들지 않는다(ledger=null). 폭과 무관하게 장부를 그리지 않는다.
      renderEntry(null, false, px)
      expect(screen.getByText('legacy-schedule-board')).toBeTruthy()
      expect(screen.queryByRole('heading', { level: 1, name: '예약표' })).toBeNull()
    },
  )

  it.each([768, 820, 1024, 1440])(
    '플래그 ON + %ipx → 기존 일정 화면 그대로(PC·태블릿 원기능 보존)이며 V088AppShell로 감싼다',
    px => {
      renderEntry(snapshot(), true, px)
      expect(screen.getByText('legacy-schedule-board')).toBeTruthy()
      expect(screen.getByTestId('pc-shell')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { level: 1, name: '예약표' })).toBeNull()
    },
  )

  it('플래그 ON 이어도 서버가 스냅샷을 만들지 않았으면(allowlist 밖) 장부를 그리지 않는다', () => {
    renderEntry(null, false, 390)
    expect(screen.getByText('legacy-schedule-board')).toBeTruthy()
  })
})

describe('M15 장부 5상태 — 모바일 진입점에서 그대로 확인된다', () => {
  const render390 = (ledger: LedgerViewSnapshot) => renderEntry(ledger, true, 390)

  it('loading — 기다리는 중임을 알리고 목록을 그리지 않는다', () => {
    const { container } = render390(snapshot({ loadState: 'loading', checkedAt: null }))
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(screen.getByText('확인하는 중이에요')).toBeTruthy()
    expect(screen.queryByText('김민지 · 속눈썹 연장')).toBeNull()
  })

  it('error — 빈 목록이 아니라 실패로 알린다', () => {
    render390(snapshot({ loadState: 'error', entries: [], checkedAt: null }))
    expect(screen.getByRole('alert').textContent).toContain('불러오지 못했어요')
    expect(screen.queryByText('오늘 예약이 없어요')).toBeNull()
  })

  it('stale — 이전에 확인한 내용임을 밝히고 확인된 예약은 그대로 보여 준다', () => {
    render390(snapshot({ checkedAt: '2026-10-24T04:20:00.000Z' }))
    expect(screen.getByText('이전에 확인한 내용이에요')).toBeTruthy()
    expect(screen.getByText('김민지 · 속눈썹 연장')).toBeTruthy()
  })

  it('confirmed_empty — 확인 결과 0건일 때만 비었다고 말한다', () => {
    render390(snapshot({ entries: [] }))
    expect(screen.getByText('오늘 예약이 없어요')).toBeTruthy()
  })

  it('ready — 시간·고객·서비스·근거를 보여 주고, 쓰기 동작은 예약 등록·관리·신청 링크 복사뿐이다', () => {
    render390(snapshot())
    expect(screen.getByText('14:00 – 15:30')).toBeTruthy()
    expect(screen.getByText('김민지 · 속눈썹 연장')).toBeTruthy()
    expect(screen.getByText('기록 출처: 고객이 수락')).toBeTruthy()
    expect(screen.getByText('확정')).toBeTruthy()

    // 기간 고르기·새로 확인 외에 사장님이 직접 쓰는 동작은 신청 링크 복사·예약 등록·예약 관리(변경·취소·확정)뿐이다.
    const labels = screen.getAllByRole('button').map(button => button.textContent)
    expect(labels).toEqual(expect.arrayContaining(['오늘', '이번 주', '새로 확인', '신청 링크 복사', '예약 등록', '관리']))
    expect(labels).toHaveLength(6)
  })

  it('새로 확인은 서버를 다시 읽는다(쓰기가 아니라 재조회)', () => {
    render390(snapshot())
    fireEvent.click(screen.getByRole('button', { name: '새로 확인' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

// 위 5상태 테스트는 스냅샷을 직접 주입한다. 여기서는 원장 행 → 스냅샷 빌더 → 진입점까지
// 한 줄로 이어, workspace 경계가 깨진 조회가 실제 화면에서 목록이 아니라 실패로 소비되는지 본다.
describe('M15 장부 빌더 → 진입점 계약 — 섞인 조회는 화면에서 실패로 소비된다', () => {
  const ledgerRow = (id: string, workspaceId: string): ReservationLedgerRow => ({
    id,
    workspace_id: workspaceId,
    customer_name: '김민지',
    service_name: '속눈썹 연장',
    status: 'CONFIRMED',
    confirmed_at: '2026-10-23T10:00:00.000Z',
    metadata: {
      source: 'booking_recovery',
      startsAt: '2026-10-24T05:00:00.000Z',
      endsAt: '2026-10-24T06:30:00.000Z',
    },
  })

  const build = (rows: ReservationLedgerRow[], datasetMode: string | null = 'ACTUAL') => buildLedgerSnapshot({
    workspaceId: WS,
    timeZone: 'Asia/Seoul',
    rows,
    error: null,
    checkedAt: NOW,
    datasetMode,
  })

  it('다른 가게 행 1건이 섞이면 error 화면, 같은 가게 행만이면 ready 화면', () => {
    const mixed = renderEntry(
      build([ledgerRow('res_1', WS), ledgerRow('res_other', '22222222-2222-4222-8222-222222222222')]),
      true,
      390,
    )
    expect(screen.getByRole('alert').textContent).toContain('불러오지 못했어요')
    expect(screen.queryByText('김민지 · 속눈썹 연장')).toBeNull()
    mixed.unmount()

    renderEntry(build([ledgerRow('res_1', WS)]), true, 390)
    expect(screen.getByText('김민지 · 속눈썹 연장')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('datasetMode 가 ACTUAL 이 아니면(null/TEST) 진입점에서 error 화면으로 소비된다', () => {
    const nonActual = renderEntry(build([ledgerRow('res_1', WS)], null), true, 390)
    expect(screen.getByRole('alert').textContent).toContain('불러오지 못했어요')
    expect(screen.queryByText('김민지 · 속눈썹 연장')).toBeNull()
    nonActual.unmount()

    renderEntry(build([ledgerRow('res_1', WS)], 'TEST'), true, 390)
    expect(screen.getByRole('alert').textContent).toContain('불러오지 못했어요')
  })
})

describe('NuqsAdapter 어댑터 래핑 계약 (ANI-1691)', () => {
  it('NuqsAdapter 없이 ScheduleBoard(useQueryStates)를 직접 렌더하면 에러가 발생한다', () => {
    expect(() => {
      render(
        <AppRouterContext.Provider value={mockRouter as never}>
          <ScheduleBoard {...BOARD} />
        </AppRouterContext.Provider>,
      )
    }).toThrow(/nuqs requires an adapter/)
  })

  it('ScheduleEntry는 NuqsAdapter로 감싸져 있어 ScheduleBoard(useQueryStates)가 정상 렌더링된다', () => {
    stubWidth(1024)
    expect(() => {
      renderEntry(null, false, 1024)
    }).not.toThrow()
    expect(screen.getByText('legacy-schedule-board')).toBeTruthy()
  })
})
