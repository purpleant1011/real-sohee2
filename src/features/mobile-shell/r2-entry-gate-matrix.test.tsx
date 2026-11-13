import type { ReactElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SHELL_ROUTES } from './routes'

// ANI-1740 (partial): PC·노트북은 현재 UI 유지, 모바일 접속에서만 새 R2 UI 라는 사용자 확정 방침을
// 한 곳에서 구조적으로 보증하는 단일 게이트 테스트.
//
// R2 진입점은 모두 `useMobileR2Active()`(플래그 ON && 폭 ≤767)로 갈라진다. 이 파일은 그 계약을
// 진입점별로 폭·플래그 조합에 대해 단언한다:
//   (a) 플래그 OFF                      → 기존 화면
//   (b) 플래그 ON + 768/820/1024/1440px → 기존 화면 (PC 레이아웃 보존)
//   (c) 플래그 ON + 767px(경계)/390px   → R2 화면
//
// 폭은 boolean 이 아니라 실제 px 로 판정한다. matchMedia stub 이 쿼리를 해석하므로 768px 이
// R2 로 새는 회귀가 (b)에서 잡힌다.
//
// 새 R2 진입점이 생기면 R2_ENTRY_REGISTRY 에 한 줄만 추가한다.
// 하위 화면은 표식 텍스트로 대체해 진입점의 분기만 검증한다(화면 내용은 각 화면의 테스트가 맡는다).

const routerReplace = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, back: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
}))
// ssr:false 로딩하는 기존 화면은 모두 이 표식 하나로 대체한다(어느 화면인지는 진입점 분기와 무관).
vi.mock('next/dynamic', () => ({ default: () => () => <p>legacy-dynamic</p> }))
vi.mock('nuqs/adapters/next/app', () => ({ NuqsAdapter: ({ children }: { children: ReactElement }) => <>{children}</> }))
vi.mock('@/features/mobile-shell', () => ({ MobileAppShell: ({ children }: { children: ReactElement }) => <>{children}</> }))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: ReactElement }) => <>{children}</>,
}))
vi.mock('@/hooks/use-workspace-context', () => ({ useWorkspaceId: () => '11111111-1111-4111-8111-111111111111' }))

// 기존 화면 표식
vi.mock('@/features/channels/ui/channel-connections', () => ({ ChannelConnections: () => <p>legacy-channels</p> }))
vi.mock('@/components/quick-post/content-hub', () => ({ ContentHub: () => <p>legacy-content</p> }))
vi.mock('@/components/v088/command/command-center-client', () => ({ CommandCenterClient: () => <p>legacy-command</p> }))
vi.mock('@/features/engagement/engagement-inbox', () => ({ EngagementInbox: () => <p>legacy-engagement</p> }))
vi.mock('@/app/app/inbox/inbox-legacy', () => ({ default: () => <p>legacy-inbox</p> }))
vi.mock('@/features/notifications/notification-center', () => ({ NotificationCenter: () => <p>legacy-notifications</p> }))
vi.mock('@/features/mobile-decision/mobile-approval-page', () => ({ MobileApprovalPage: () => <p>legacy-approvals</p> }))
vi.mock('@/features/schedule/schedule-board', () => ({ ScheduleBoard: () => <p>legacy-schedule</p> }))

// R2 화면 표식
vi.mock('@/features/mobile-channels/r2-channels', () => ({ R2Channels: () => <p>r2-channels</p> }))
vi.mock('@/features/mobile-campaigns/r2-campaigns', () => ({ R2Campaigns: () => <p>r2-campaigns</p> }))
vi.mock('@/features/mobile-customers/r2-customers', () => ({ R2Customers: () => <p>r2-customers</p> }))
vi.mock('@/features/mobile-customers/r2-customer-detail', () => ({ R2CustomerDetail: () => <p>r2-customer-detail</p> }))
vi.mock('@/features/mobile-inbox/r2-inbox', () => ({ R2Inbox: () => <p>r2-inbox</p> }))
vi.mock('@/features/mobile-inbox/r2-conversation-detail', () => ({ R2ConversationDetail: ({ embedded }: { embedded?: boolean }) => <p>{embedded ? 'desktop-conversation-detail' : 'r2-conversation-detail'}</p> }))
vi.mock('@/features/mobile-inbox/r2-booking-timeline', () => ({ R2BookingTimeline: ({ embedded }: { embedded?: boolean }) => <p>{embedded ? 'desktop-booking-timeline' : 'r2-booking-timeline'}</p> }))
vi.mock('@/features/mobile-today/r2-today', () => ({ R2Today: () => <p>r2-today</p> }))
vi.mock('@/features/mobile-hub/hub-view', () => ({ MobileHubView: () => <p>r2-content</p> }))
vi.mock('@/features/mobile-chat/r2-chat', () => ({ R2Chat: () => <p>r2-command</p> }))
vi.mock('@/features/mobile-hub/use-work-items', () => ({ useWorkItems: () => ({ items: [], loading: false, error: false }) }))
vi.mock('@/features/mobile-notifications/notification-list', () => ({ NotificationList: () => <p>r2-notifications</p> }))
vi.mock('@/features/mobile-notifications/notification-preferences', () => ({ NotificationPreferences: () => null }))
vi.mock('@/features/notifications/notifications-realtime', () => ({ NotificationsRealtime: () => null }))
vi.mock('@/components/start/start-wizard', () => ({ StartWizard: () => <p>legacy-start-wizard</p> }))
vi.mock('@/features/mobile-approvals/r2-approval-view', () => ({
  R2ApprovalList: () => <p>r2-approvals</p>,
  R2ApprovalDetail: () => <p>r2-approvals</p>,
}))
vi.mock('@/features/mobile-approvals/r2-work-approve', () => ({ R2WorkApprove: () => <p>r2-work-approve</p> }))
vi.mock('@/features/mobile-firstpost/first-post-flow', () => ({
  FirstPostFlow: () => <p>r2-first-post</p>,
  isFirstPostR2Enabled: () => true,
}))
vi.mock('@/features/mobile-firstpost/first-post-entry', () => ({ FirstPostEntry: () => <p>r2-first-post-entry</p> }))
vi.mock('@/features/mobile-settings/r2-memory', () => ({ R2Memory: () => <p>r2-memory</p> }))
vi.mock('@/features/mobile-settings/r2-autonomy', () => ({ R2Autonomy: () => <p>r2-autonomy</p> }))
vi.mock('@/features/mobile-settings/r2-credit', () => ({ R2Credit: () => <p>r2-credits</p> }))
vi.mock('@/features/mobile-results/r2-results-drilldown', () => ({ R2ResultsDrilldown: () => <p>r2-results-drilldown</p> }))

// 기존 홈의 무거운 하위 블록은 진입점 분기와 무관하므로 비운다.
vi.mock('@/features/mobile-decision/mobile-ui-provider', () => ({ useMobileUi: () => ({ enabled: false }) }))
vi.mock('@/hooks/use-sohee-autonomy', () => ({ useSoheeAutonomy: () => ({ isPaused: false, toggleAutonomy: vi.fn() }) }))
vi.mock('@/components/home-today/home-approval-hub', () => ({ HomeApprovalHub: () => null }))
vi.mock('@/components/home-today/magic-photo-dropzone', () => ({ MagicPhotoDropzone: () => null }))
vi.mock('@/components/home-today/busy-mode-switch', () => ({ BusyModeSwitch: () => null }))
vi.mock('@/components/home-today/home-display-density', () => ({ HomeDisplayDensityToggle: () => null }))
vi.mock('@/features/reporting/weekly-truth-summary', () => ({ WeeklyTruthSummary: () => null }))

import { MobileR2Provider } from './r2-gate'
import { TodayHome } from '@/components/home-today/today-home'
import { CustomersEntry } from '@/app/app/customers/customers-entry'
import { CustomerDetailEntry } from '@/app/app/customers/[id]/customer-detail-entry'
import { InboxEntry } from '@/app/app/inbox/inbox-entry'
import { BookingInquiryEntry } from '@/app/app/inbox/[id]/booking-inquiry-entry'
import { ConversationDetailEntry } from '@/app/app/engagement/[threadKey]/conversation-detail-entry'
import { ContentEntry } from '@/app/app/content/content-entry'
import { EngagementEntry } from '@/app/app/engagement/engagement-entry'
import { CampaignsEntry } from '@/app/app/campaigns/campaigns-entry'
import { ChannelsEntry } from '@/app/app/channels/channels-entry'
import { NotificationsEntry } from '@/app/app/notifications/notifications-entry'
import { ApprovalsEntry } from '@/app/app/approvals/approvals-entry'
import { ApprovalDetailEntry } from '@/app/app/approvals/[id]/approval-detail-entry'
import { WorkApproveEntry } from '@/app/app/work/[contentId]/approve/approve-entry'
import { ResultsDetailEntry } from '@/app/app/results/[id]/results-detail-entry'
import { CommandEntry } from '@/app/app/command/command-entry'
import { FirstPostResume } from '@/features/mobile-firstpost/first-post-resume'
import { FirstPostNewEntry } from '@/app/app/work/new/first-post-new-entry'
import { MemoryEntry } from '@/app/app/memory/memory-entry'
import { AutomationEntry } from '@/app/app/account/automation/automation-entry'
import { CreditsEntry } from '@/app/app/account/credits/credits-entry'
import type { NotificationCenterData } from '@/features/notifications/repository'
import type { CreditViewSnapshot } from '@/features/mobile-settings/credit-view'
import { DEPOSITS_WIDE_NOTICE, DepositsEntry } from '@/app/app/schedule/payments/deposits-entry'
import { ScheduleEntry } from '@/app/app/schedule/schedule-entry'
import OnboardingEntry from '@/app/start/onboarding-entry'
import type { DepositsViewSnapshot } from '@/features/mobile-deposits/deposits-view'
import type { LedgerViewSnapshot } from '@/features/mobile-inbox/ledger-view'
import type { ScheduleBoard as BoardData } from '@/features/schedule/repository'

const WS = '11111111-1111-4111-8111-111111111111'

/** M16 예약금 — 결제사 미연결 상태의 스냅샷. 게이트 분기만 검증한다. */
const DEPOSITS_SNAPSHOT: DepositsViewSnapshot = {
  loadState: 'ready',
  checkedAt: '2026-10-24T00:00:00Z',
  deposits: [{
    workspaceId: WS,
    bookingId: 'b1',
    provider: 'none',
    availability: 'supported',
    amount: 30000,
    currency: 'KRW',
    termsAcceptedAt: null,
    transport: 'not_started',
    providerAccepted: null,
    readback: 'unavailable',
    readbackAt: null,
    receiptRef: null,
    refund: null,
    idempotencyKey: null,
    seenCallbacks: [],
  }],
}

/** M15 예약 장부 — 오늘 예약 1건. 게이트 분기만 검증한다. */
const LEDGER_SNAPSHOT: LedgerViewSnapshot = {
  loadState: 'ready',
  workspaceId: WS,
  timeZone: 'Asia/Seoul',
  now: '2026-10-24T05:00:00.000Z',
  complete: true,
  checkedAt: '2026-10-24T05:00:00.000Z',
  entries: [{
    id: 'res_1',
    workspaceId: WS,
    customerName: '김민지',
    serviceLabel: '속눈썹 연장',
    startsAt: '2026-10-24T05:00:00.000Z',
    endsAt: '2026-10-24T06:30:00.000Z',
    status: 'confirmed',
    source: 'customer_accepted',
    ledgerVerifiedAt: '2026-10-24T05:00:00.000Z',
    otherSurfaceStatus: null,
  }],
}

/** /app/schedule 의 기존 화면 props. ScheduleBoard 는 이 파일에서 모킹되어 값은 쓰이지 않는다. */
const SCHEDULE_BOARD = {
  data: {
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
  } as unknown as BoardData,
  workspaceId: WS,
  role: 'owner' as const,
}

/** 저장된 초안이 있는 미션. R2 흐름으로 이어지는 경우에만 호출된다. */
const draftFetch = (async () => ({
  ok: true,
  json: async () => ({ success: true, missionStatus: 'DRAFT', draft: { missionId: '11111111-2222-4333-8444-555555555555', title: '가을 신상 안내', body: '본문', channel: 'instagram', assets: [] } }),
})) as unknown as typeof fetch

const NOTIFICATIONS = {
  userId: '22222222-2222-4222-8222-222222222222',
  preferences: { approvalEvents: true, scheduleEvents: true, publishEvents: true },
  notifications: [],
} as unknown as NotificationCenterData

const CREDITS: CreditViewSnapshot = {
  loadState: 'ready',
  credit: { available: 47, reserved: 3, consumed: 40, refunded: 7, observedAt: '2026-10-24T05:00:00.000Z' },
  customerDeposit: null,
  estimate: null,
  checkedAt: '2026-10-24T05:00:00.000Z',
}

type GateEntry = Readonly<{
  /** 진입 경로. 실패 메시지에만 쓴다. */
  path: string
  mount: () => ReactElement
  /** R2 화면에서만 보이는 표식 */
  r2: string
  /** 기존 화면에서만 보이는 표식 (legacyRedirect 가 있으면 생략) */
  legacy?: string
  /** 기존 화면이 화면 대신 이동하는 경우(예: 캠페인 탭) */
  legacyRedirect?: string
}>

/**
 * R2 진입점 레지스트리. 새 R2 진입점은 여기에 한 줄 추가한다.
 * /app/approvals 도 #2056 에서 useMobileR2Active() 로 이관되어 이 게이트의 대상이다.
 */
const R2_ENTRY_REGISTRY: ReadonlyArray<GateEntry> = [
  { path: '/app', mount: () => <TodayHome workspaceId={WS} />, r2: 'r2-today', legacy: 'legacy-dynamic' },
  { path: '/app/customers', mount: () => <CustomersEntry />, r2: 'r2-customers', legacy: 'legacy-dynamic' },
  { path: '/app/customers/:id', mount: () => <CustomerDetailEntry customerId="c1" workspaceId={WS} />, r2: 'r2-customer-detail', legacy: '고객 정보를 확인하고 있어요.' },
  { path: '/app/inbox', mount: () => <InboxEntry />, r2: 'r2-inbox', legacy: 'legacy-inbox' },
  { path: '/app/inbox/:id', mount: () => <BookingInquiryEntry caseId="c1" />, r2: 'r2-booking-timeline', legacy: 'desktop-booking-timeline' },
  // ANI-2033: PC도 같은 문의를 열되 모바일 셸 대신 PC 호스트/인라인 CTA를 사용한다.
  { path: '/app/engagement/:threadKey', mount: () => <ConversationDetailEntry threadKey="dm:33333333-3333-4333-8333-333333333333" />, r2: 'r2-conversation-detail', legacy: 'desktop-conversation-detail' },
  { path: '/app/content', mount: () => <ContentEntry workspaceId={WS} />, r2: 'r2-content', legacy: 'legacy-content' },
  { path: '/app/engagement', mount: () => <EngagementEntry workspaceId={WS} initialPolicies={{}} />, r2: 'r2-inbox', legacy: 'legacy-engagement' },
  { path: '/app/campaigns', mount: () => <CampaignsEntry workspaceId={WS} />, r2: 'r2-campaigns', legacyRedirect: '/app/sohee?tab=campaigns' },
  { path: '/app/channels', mount: () => <ChannelsEntry />, r2: 'r2-channels', legacy: 'legacy-channels' },
  { path: '/app/notifications', mount: () => <NotificationsEntry data={NOTIFICATIONS} workspaceId={WS} />, r2: 'r2-notifications', legacy: 'legacy-notifications' },
  { path: '/app/approvals', mount: () => <ApprovalsEntry />, r2: 'r2-approvals', legacy: '확인할 작업' },
  { path: '/app/memory', mount: () => <MemoryEntry />, r2: 'r2-memory', legacy: 'legacy-dynamic' },
  { path: '/app/account/automation', mount: () => <AutomationEntry workspaceId={WS} legacy={<p>legacy-automation</p>} />, r2: 'r2-autonomy', legacy: 'legacy-automation' },
  { path: '/app/approvals/:id', mount: () => <ApprovalDetailEntry item="a1" workspaceId={WS} />, r2: 'r2-approvals', legacyRedirect: '/app/approvals?item=a1' },
  { path: '/app/work/:id/approve', mount: () => <WorkApproveEntry workspaceId={WS} contentId="c1" role="owner" snapshot={null} />, r2: 'r2-work-approve', legacyRedirect: '/app/work/c1' },
  { path: '/app/results/:id', mount: () => <ResultsDetailEntry metricId="published" />, r2: 'r2-results-drilldown', legacy: '성과 기록을 확인하고 있어요.' },
  { path: '/app/account/credits', mount: () => <CreditsEntry snapshot={CREDITS} legacy={<p>legacy-credits</p>} />, r2: 'r2-credits', legacy: 'legacy-credits' },
  { path: '/app/command', mount: () => <CommandEntry />, r2: 'r2-command', legacy: 'legacy-command' },
  { path: '/app/schedule', mount: () => <ScheduleEntry board={SCHEDULE_BOARD} ledger={LEDGER_SNAPSHOT} />, r2: '예약표', legacy: 'legacy-schedule' },
  { path: '/app/schedule/payments', mount: () => <DepositsEntry snapshot={DEPOSITS_SNAPSHOT} />, r2: '예약금 결제하기', legacy: DEPOSITS_WIDE_NOTICE },
  { path: '/app/missions/:id', mount: () => <FirstPostResume missionId="11111111-2222-4333-8444-555555555555" workspaceId={WS} fetchImpl={draftFetch}><p>legacy-mission</p></FirstPostResume>, r2: 'r2-first-post', legacy: 'legacy-mission' },
  { path: '/app/work/new', mount: () => <FirstPostNewEntry workspaceId={WS} />, r2: 'r2-first-post-entry', legacyRedirect: '/app/content?studio=four-channel' },
  { path: '/start', mount: () => <OnboardingEntry />, r2: '가게 소개', legacy: 'legacy-start-wizard' },
]

/** 게이트 경계(≤767)와 PC 폭. 768 이 R2 로 새면 (b)가 잡는다. */
const R2_BOUNDARY_PX = 767
const MOBILE_PX = 390
// ANI-1740 수락 기준 폭(768·820·1024·1440)을 그대로 쓴다 — 1440(와이드 모니터)도 PC 레이아웃이다.
const DESKTOP_WIDTHS = [768, 820, 1024, 1440] as const

/** CSS 미디어 쿼리를 실제 px 로 판정한다. 모르는 질의는 false — 조용히 통과하지 않게. */
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

function renderEntry(entry: GateEntry, enabled: boolean, px: number) {
  stubWidth(px)
  const tree = entry.mount()
  return render(<MobileR2Provider enabled={enabled}>{tree}</MobileR2Provider>)
}

async function expectLegacyScreen(entry: GateEntry) {
  if (entry.legacyRedirect) {
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith(entry.legacyRedirect))
  } else if (entry.legacy) {
    expect(await screen.findByText(entry.legacy)).toBeVisible()
  }
  expect(screen.queryByText(entry.r2)).toBeNull()
}

async function expectR2Screen(entry: GateEntry) {
  expect(await screen.findByText(entry.r2)).toBeVisible()
  if (entry.legacy) expect(screen.queryByText(entry.legacy)).toBeNull()
  if (entry.legacyRedirect) expect(routerReplace).not.toHaveBeenCalledWith(entry.legacyRedirect)
}

beforeEach(() => {
  routerReplace.mockClear()
  // 하위 화면의 조회는 이 게이트의 관심사가 아니다. 영원히 대기시켜 상태 갱신을 막는다.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})
afterEach(() => vi.unstubAllGlobals())

describe('R2 진입점 게이트 — PC·노트북은 현재 UI, 모바일만 R2 (ANI-1740)', () => {
  it('레지스트리에 R2 진입점이 등록되어 있다', () => {
    expect(R2_ENTRY_REGISTRY.length).toBeGreaterThan(0)
  })

  for (const entry of R2_ENTRY_REGISTRY) {
    describe(entry.path, () => {
      it('(a) 플래그 OFF + 390px → 기존 화면', async () => {
        renderEntry(entry, false, MOBILE_PX)
        await expectLegacyScreen(entry)
      })

      for (const px of DESKTOP_WIDTHS) {
        it(`(b) 플래그 ON + ${px}px → 기존 화면`, async () => {
          renderEntry(entry, true, px)
          await expectLegacyScreen(entry)
        })
      }

      it(`(c) 플래그 ON + ${R2_BOUNDARY_PX}px(경계) → R2 화면`, async () => {
        renderEntry(entry, true, R2_BOUNDARY_PX)
        await expectR2Screen(entry)
      })

      it(`(c) 플래그 ON + ${MOBILE_PX}px → R2 화면`, async () => {
        renderEntry(entry, true, MOBILE_PX)
        await expectR2Screen(entry)
      })
    })
  }

  /**
   * M04·M05 는 별도 진입점이 아니다(ANI-1781).
   * 사진 선택은 M03 가게 단계 안에서, 사실 질문은 말투 단계 안에서 처리하므로
   * `/start/photo`·`/start/facts` 는 셸 라우트 맵에서 `absorbed` 로만 남는다.
   * 여기에 진입점이 생기면 온보딩이 두 갈래로 갈라지므로 레지스트리 추가를 막는다.
   */
  describe('M03 이 흡수한 단계(M04·M05)는 별도 진입점이 아니다', () => {
    const absorbed = SHELL_ROUTES.filter(route => route.status === 'absorbed')

    it('흡수된 경로 두 개만 absorbed 로 남아 있다', () => {
      expect(absorbed.map(route => route.pattern)).toEqual(['/start/photo', '/start/facts'])
    })

    it.each(absorbed.map(route => route.pattern))('%s 는 게이트 레지스트리에 없다', path => {
      expect(R2_ENTRY_REGISTRY.some(entry => entry.path === path)).toBe(false)
    })

    it('흡수된 경로는 탭 밖이다(5탭 하이라이트를 오염시키지 않는다)', () => {
      for (const route of absorbed) expect(route.tab).toBeNull()
    })

    it('상위 M03 진입점은 실제 화면이다', () => {
      const m03 = SHELL_ROUTES.find(route => route.id === 'M03' && route.pattern === '/start')
      expect(m03?.status).toBe('existing')
    })
  })
})
