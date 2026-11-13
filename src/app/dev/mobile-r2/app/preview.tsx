'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  Bookmark,
  Briefcase,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  Coins,
  Ellipsis,
  House,
  Inbox,
  Megaphone,
  MessageSquarePlus,
  Settings,
  Share2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { DecisionCard, LiveRegion } from '@/components/mobile-ui'
import { Button } from '@/components/ui/button'
import { MobileChannelsView } from '@/features/mobile-channels/channels-view'
import { ExampleCampaignsScreen } from '@/features/mobile-campaigns/example-campaigns-screen'
import { ExampleCustomerDetailScreen, ExampleCustomersScreen } from '@/features/mobile-customers/example-customers-screen'
import { MobileHubView } from '@/features/mobile-hub/hub-view'
import { ExampleInboxScreen } from '@/features/mobile-inbox/example-inbox-screen'
import { ExampleLedgerScreen } from '@/features/mobile-inbox/example-ledger-screen'
import { NotificationList } from '@/features/mobile-notifications/notification-list'
import { ExampleResultsScreen } from '@/features/mobile-results/example-results-screen'
import { MobileCreditView } from '@/features/mobile-settings/credit-view'
import { MobileMemoryApprovalView } from '@/features/mobile-settings/memory-approval-view'
import { MobileMoreView } from '@/features/mobile-settings/more-view'
import { SHELL_TABS, type TabId } from '@/features/mobile-shell'
import { readScroll, saveScroll } from '@/features/mobile-shell/memory'
import {
  PREVIEW_CHANNELS, PREVIEW_CREDIT, PREVIEW_MEMORY_APPROVAL,
  PREVIEW_MORE, PREVIEW_NOTIFICATIONS, PREVIEW_WORK_ITEMS,
} from '../preview'
import {
  APP_SCREENS, customerIdFromHref, listedDecisions, parentScreenFor, resolveTabTap, screenFor, screenPath,
  type AppScreen,
} from './shell-model'

const TAB_ICONS: Record<TabId, LucideIcon> = {
  today: House, work: Briefcase, customers: Users, results: ChartNoAxesCombined, more: Ellipsis,
}

/** 예시 데이터가 함께 쓰는 워크스페이스 id. 실제 테넌트가 아니다. */
const PREVIEW_WORKSPACE_ID = 'preview-workspace'

/**
 * W3 모바일 R2 앱 셸 (ANI-1664).
 *
 * 하단 5탭을 누르면 그 탭의 화면만 그린다. 서버 조회·외부 쓰기는 하지 않고,
 * 이미 머지된 R2 화면과 예시 데이터만 쓴다. 탭 전환·뒤로가기 시 스크롤 위치를 복원한다.
 */
export function MobileAppPreview() {
  const [route, setRoute] = useState<{ tab: TabId; screen: string }>({ tab: 'today', screen: 'today' })
  /** 고객 상세에서 그릴 고객. 화면 id 만으로는 어느 고객인지 알 수 없어 함께 둔다. */
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [notice, setNotice] = useState('')
  const scroller = useRef<HTMLElement>(null)
  const key = screenPath(route.screen)

  // 화면 단위 스크롤 복원. 저장은 rAF 로 모으고, 화면을 떠나는 순간 남은 값도 저장한다.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = readScroll(key)
    let raf = 0
    let pending = false
    const onScroll = () => {
      pending = true
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { pending = false; saveScroll(key, el.scrollTop) })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
      if (pending) saveScroll(key, el.scrollTop)
    }
  }, [key])

  // 화면을 옮기면서 누르고 있던 요소(뒤로가기 버튼 등)가 사라지면 포커스가 body 로 떨어진다.
  // 그대로 두면 키보드·스크린리더 사용자가 어디로 왔는지 알 수 없으므로 본문으로 옮긴다.
  // 아직 화면에 남아 있는 요소에 포커스가 있으면(탭바 등) 빼앗지 않고, 첫 진입도 건드리지 않는다.
  const focusOnNav = useRef(true)
  useEffect(() => {
    if (focusOnNav.current) { focusOnNav.current = false; return }
    const active = document.activeElement
    if (active && active !== document.body) return
    scroller.current?.focus({ preventScroll: true })
  }, [key])

  /** 화면을 떠나기 직전 위치를 남긴다. DOM 내용이 짧아져 scrollTop 이 잘리기 전에 저장해야 한다. */
  const remember = () => {
    const el = scroller.current
    if (el) saveScroll(key, el.scrollTop)
  }

  const openScreen = (screen: string, options?: { customerId?: string }) => {
    const target = screenFor(screen)
    if (!target) return
    remember()
    setNotice('')
    setCustomerId(options?.customerId ?? null)
    setRoute({ tab: target.tab, screen: target.id })
  }

  const onTab = (tab: TabId) => {
    const press = resolveTabTap({ activeTab: route.tab, tab, screen: route.screen })
    if (press.action === 'scroll-top') {
      saveScroll(key, 0)
      scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    remember()
    setNotice('')
    setCustomerId(null)
    setRoute({ tab, screen: press.screen })
  }

  const onBack = () => {
    const parent = parentScreenFor(route.screen)
    if (parent) openScreen(parent)
  }

  // 예시 화면에서는 실제 화면으로 넘어가지 않는다(이동하면 실라우트가 조회를 시작한다).
  const previewOnly = (what: string) => setNotice(`예시 화면이라 ${what}으로 넘어가지 않아요. 실제 앱에서 확인해 주세요.`)
  // 서버에 쓰는 동작도 실행하지 않는다. 이동이 아니라 '실행'이라 문구를 따로 쓴다.
  const previewAction = (what: string) => setNotice(`예시 화면이라 ${what} 동작은 실행하지 않아요. 실제 앱에서 확인해 주세요.`)

  const screen = screenFor(route.screen) ?? screenFor('today')!
  const atRoot = screen.id === screen.tab

  return (
    <div
      data-mobile-r2-app
      data-active-tab={route.tab}
      data-active-screen={screen.id}
      className="fixed inset-0 flex h-dvh flex-col bg-background text-foreground"
    >
      <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-border bg-background px-2 pt-[env(safe-area-inset-top)]">
        {atRoot ? null : (
          <button
            type="button"
            onClick={onBack}
            aria-label="뒤로"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
        )}
        <p className={`min-w-0 flex-1 truncate px-2 font-semibold tracking-tight ${atRoot ? 'text-lg' : 'text-base'}`}>
          {atRoot ? '소희' : screen.title}
        </p>
        {/* '소희에게 맡기기'는 탭이 아니라 헤더 명령이다(5탭 고정). */}
        <Button
          onClick={() => previewOnly('대화 화면')}
          aria-label="소희에게 맡기기"
          className="min-h-11 shrink-0 gap-1.5 rounded-xl px-3 text-sm"
        >
          <MessageSquarePlus className="size-4" aria-hidden="true" />맡기기
        </Button>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          예시 화면
        </span>
      </header>

      <main
        ref={scroller}
        tabIndex={-1}
        aria-label={screen.title}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 outline-none"
        // 예시 화면 안의 링크는 실제 라우트로 넘어가지 않는다. 넘어가면 그 화면이 조회를 시작한다.
        // 고객 상세 링크만 예외로, 같은 예시 데이터를 쓰는 셸 안 상세 화면으로 연다.
        onClickCapture={event => {
          const target = event.target
          if (!(target instanceof Element)) return
          const anchor = target.closest('a')
          if (!anchor) return
          event.preventDefault()
          const openedCustomerId = customerIdFromHref(anchor.getAttribute('href'))
          if (openedCustomerId) {
            openScreen('customers/detail', { customerId: openedCustomerId })
            return
          }
          previewOnly('다른 화면')
        }}
      >
        <LiveRegion
          message={notice}
          visible={notice !== ''}
          className="mx-auto mt-3 w-full max-w-2xl rounded-xl bg-state-quiet-soft px-3 py-2 text-sm text-state-quiet"
        />
        {/* 화면이 바뀔 때만 180ms 로 살짝 떠오른다(reduced-motion 이면 CSS 가 끈다). */}
        <div key={screen.id} data-screen={screen.id} className="m-state-enter">
          <ScreenBody
            screen={screen}
            customerId={customerId}
            expanded={expanded}
            onToggle={() => setExpanded(value => !value)}
            onOpen={openScreen}
            onPreviewAction={previewOnly}
            onPreviewWrite={previewAction}
          />
        </div>
      </main>

      <nav aria-label="소희 업무 메뉴" className="flex shrink-0 border-t border-border bg-background px-1 pb-[env(safe-area-inset-bottom)]">
        {SHELL_TABS.map(tab => {
          const Icon = TAB_ICONS[tab.id]
          const selected = route.tab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTab(tab.id)}
              aria-current={selected ? 'page' : undefined}
              className={`flex min-h-16 min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring ${selected ? 'text-primary' : 'text-muted-foreground'}`}
            >
              <Icon className="size-5" aria-hidden="true" />
              {tab.label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

function ScreenBody({ screen, customerId, expanded, onToggle, onOpen, onPreviewAction, onPreviewWrite }: {
  screen: AppScreen
  customerId: string | null
  expanded: boolean
  onToggle: () => void
  onOpen: (id: string) => void
  onPreviewAction: (what: string) => void
  onPreviewWrite: (what: string) => void
}) {
  switch (screen.id) {
    case 'today':
      return <TodayScreen expanded={expanded} onToggle={onToggle} onPreviewAction={onPreviewAction} />
    case 'work':
      return <WorkScreen onOpen={onOpen} onPreviewAction={onPreviewAction} />
    case 'work/list':
      return <MobileHubView workspaceId={PREVIEW_WORKSPACE_ID} source={PREVIEW_WORK_ITEMS} />
    case 'work/notifications':
      return <NotificationsScreen onPreviewWrite={onPreviewWrite} />
    case 'work/campaigns':
      return <ExampleCampaignsScreen />
    case 'customers':
      return <CustomersScreen onOpen={onOpen} />
    case 'customers/list':
      return <ExampleCustomersScreen />
    case 'customers/detail':
      // 목록을 거치지 않고 이 화면만 열렸다면 빈 id 로 끝난다 — 없는 고객을 지어내지 않는다.
      return <ExampleCustomerDetailScreen customerId={customerId ?? ''} />
    case 'customers/inbox':
      return <ExampleInboxScreen />
    case 'customers/ledger':
      return <ExampleLedgerScreen />
    case 'results':
      return <ExampleResultsScreen />
    case 'more':
      return <MoreScreen onOpen={onOpen} />
    case 'more/channels':
      return <div className="pt-3"><MobileChannelsView snapshot={PREVIEW_CHANNELS} /></div>
    case 'more/credit':
      return <div className="pt-3"><MobileCreditView snapshot={PREVIEW_CREDIT} /></div>
    case 'more/memory':
      return <div className="pt-3"><MobileMemoryApprovalView snapshot={PREVIEW_MEMORY_APPROVAL} /></div>
    case 'more/settings':
      return <div className="pt-3"><MobileMoreView snapshot={PREVIEW_MORE} /></div>
    default:
      return <MissingScreen screen={screen} />
  }
}

/** 오늘: 다음 행동 1개 + 결정 최대 3개. 나머지 결정은 '더 보기'로 펼치고 삭제하지 않는다. */
function TodayScreen({ expanded, onToggle, onPreviewAction }: {
  expanded: boolean
  onToggle: () => void
  onPreviewAction: (what: string) => void
}) {
  // 강조 카드가 첫 항목을 이미 쓰므로 목록에서는 빼고, 남은 결정만 3개씩 끊어 보여 준다.
  const { visible, hiddenCount, hasMore } = listedDecisions(EXAMPLE_DECISIONS, expanded)
  const next = EXAMPLE_DECISIONS[0]

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pt-3">
      <header className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">예시 가게 · 오늘</p>
        <h1 className="text-2xl font-semibold leading-snug tracking-tight">오늘, 소희와 함께</h1>
        <p className="text-base leading-relaxed text-muted-foreground">결정이 필요한 일만 확인하고, 나머지는 소희가 이어서 해요.</p>
      </header>

      <section aria-label="다음 행동" className="space-y-3.5 rounded-[20px] border border-primary/25 border-l-4 border-l-primary bg-accent/25 p-5 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold tracking-wide text-primary">지금 확인할 일</p>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            확인 필요 · 1순위
          </span>
        </div>
        <h2 className="break-words text-[19px] font-bold leading-snug tracking-tight text-foreground">{next.title}</h2>
        <p className="text-[13px] font-medium text-muted-foreground">{next.targetLabel}</p>
        <Button onClick={() => onPreviewAction('검토 화면')} className="m-press min-h-12 w-full text-base font-semibold shadow-xs">검토하기</Button>
      </section>

      <section aria-label="결정 필요" className="space-y-3">
        {/* 건수 합계는 그리지 않는다. 예시 목록의 길이가 실제 업무 건수처럼 읽히지 않게 한다. */}
        <h2 className="text-lg font-semibold tracking-tight">확인할 결정</h2>
        <div id="today-decisions" className="space-y-3">
          {visible.map(item => (
            <DecisionCard
              key={item.id}
              href={`/app/approvals?item=${encodeURIComponent(item.id)}`}
              kindLabel={item.kindLabel}
              targetLabel={item.targetLabel}
              title={item.title}
              onNavigate={event => { event.preventDefault(); onPreviewAction('검토 화면') }}
            />
          ))}
        </div>
        {hasMore ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls="today-decisions"
            className="min-h-12 w-full rounded-xl border border-border text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {expanded ? '접기' : `나머지 ${hiddenCount}건 더 보기`}
          </button>
        ) : null}
      </section>
    </div>
  )
}

/**
 * 알림함의 '읽음으로 표시'는 서버 액션을 부른다. 예시 화면에서 그대로 두면 누르는 순간
 * 실제 요청이 나가므로 그 버튼만 가로채 안내로 바꾼다(종류 필터 같은 로컬 동작은 그대로).
 */
function NotificationsScreen({ onPreviewWrite }: { onPreviewWrite: (what: string) => void }) {
  return (
    <div
      onClickCapture={event => {
        const target = event.target
        if (!(target instanceof Element)) return
        if (!target.closest('button')?.textContent?.includes('읽음으로 표시')) return
        event.preventDefault()
        event.stopPropagation()
        onPreviewWrite('알림 읽음 처리')
      }}
    >
      <NotificationList data={PREVIEW_NOTIFICATIONS} workspaceId={PREVIEW_WORKSPACE_ID} />
    </div>
  )
}

const ENTRY_METAS: Record<string, { Icon: LucideIcon; colorClass: string }> = {
  'work/list': { Icon: Briefcase, colorClass: 'bg-primary/10 text-primary' },
  'work/notifications': { Icon: Bell, colorClass: 'bg-state-warn-soft text-state-warn' },
  'work/campaigns': { Icon: Megaphone, colorClass: 'bg-accent text-primary' },
  'customers/list': { Icon: Users, colorClass: 'bg-state-ok-soft text-state-ok' },
  'customers/inbox': { Icon: Inbox, colorClass: 'bg-accent text-primary' },
  'customers/ledger': { Icon: CalendarDays, colorClass: 'bg-state-wait-soft text-state-wait' },
  'more/channels': { Icon: Share2, colorClass: 'bg-primary/10 text-primary' },
  'more/credit': { Icon: Coins, colorClass: 'bg-state-warn-soft text-state-warn' },
  'more/memory': { Icon: Bookmark, colorClass: 'bg-state-ok-soft text-state-ok' },
  'more/settings': { Icon: Settings, colorClass: 'bg-muted text-foreground' },
}

const MORE_SUMMARY: Record<string, string> = {
  'more/channels': '게시할 수 있는 채널을 확인해요',
  'more/credit': '남은 크레딧과 사용 내역을 봐요',
  'more/memory': '소희가 기억할 내용을 승인해요',
  'more/settings': '가게 전환 · 알림 · 개인정보',
}

/** 더보기: 채널 · 크레딧 · 가게 기억 · 설정 진입 목록. */
function MoreScreen({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <EntryList
      title="더보기"
      description="채널·크레딧·가게 기억·설정을 여기서 확인해요."
      entries={APP_SCREENS.filter(screen => screen.tab === 'more' && screen.id !== 'more')
        .map(screen => ({ id: screen.id, title: screen.title, summary: MORE_SUMMARY[screen.id] }))}
      onOpen={onOpen}
    />
  )
}

interface Entry { id: string; title: string; summary: string }

function EntryRow({ entry, onOpen }: { entry: Entry; onOpen: (id: string) => void }) {
  const meta = ENTRY_METAS[entry.id] ?? { Icon: Briefcase, colorClass: 'bg-primary/10 text-primary' }
  const Icon = meta.Icon

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry.id)}
        className="m-press group flex min-h-16 w-full items-center justify-between gap-3.5 rounded-2xl border border-border/80 bg-card px-4 py-3 text-left shadow-xs transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${meta.colorClass} transition-transform group-hover:scale-105`}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold leading-tight text-foreground group-hover:text-primary">{entry.title}</span>
          <span className="block text-[13px] leading-5 text-muted-foreground">{entry.summary}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </button>
    </li>
  )
}

/** 탭 첫 화면의 진입 목록. 화면표(APP_SCREENS)에 있는 하위 화면만 그린다. */
function EntryList({ title, description, entries, onOpen }: {
  title: string
  description: string
  entries: readonly Entry[]
  onOpen: (id: string) => void
}) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pt-3">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-base leading-relaxed text-muted-foreground">{description}</p>
      </header>
      <ul aria-label={`${title} 목록`} className="space-y-2.5">
        {entries.map(entry => (
          <EntryRow key={entry.id} entry={entry} onOpen={onOpen} />
        ))}
      </ul>
    </div>
  )
}

const WORK_SUMMARY: Record<string, string> = {
  'work/list': '상태별로 준비된 일을 봐요',
  'work/notifications': '승인·일정·게시 알림을 확인해요',
  'work/campaigns': '비는 시간에 어울리는 제안을 봐요',
}

/** 작업: 목록·알림함·캠페인 제안으로 들어가고, 대화는 헤더 명령과 같은 안내만 보여 준다. */
function WorkScreen({ onOpen, onPreviewAction }: { onOpen: (id: string) => void; onPreviewAction: (what: string) => void }) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pt-3">
      <EntryList
        title="작업"
        description="소희가 준비한 일과 알림을 여기서 확인해요."
        entries={APP_SCREENS.filter(screen => screen.tab === 'work' && screen.id !== 'work')
          .map(screen => ({ id: screen.id, title: screen.title, summary: WORK_SUMMARY[screen.id] }))}
        onOpen={onOpen}
      />
      <button
        type="button"
        onClick={() => onPreviewAction('대화 화면')}
        className="m-press group flex min-h-16 w-full items-center justify-between gap-3.5 rounded-2xl border border-dashed border-primary/40 bg-accent/30 px-4 py-3 text-left transition-colors hover:border-primary/60 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs transition-transform group-hover:scale-105">
          <MessageSquarePlus className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold leading-tight text-foreground group-hover:text-primary">소희와 대화</span>
          <span className="block text-[13px] leading-5 text-muted-foreground">맡길 일을 말로 요청해요</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </button>
    </div>
  )
}

const CUSTOMERS_SUMMARY: Record<string, string> = {
  'customers/list': '동의 상태와 최근 소식을 봐요',
  'customers/inbox': '손님이 보낸 문의와 답장 초안을 확인해요',
  'customers/ledger': '예약과 방문 일정을 표로 봐요',
}

/** 고객: 고객 목록·소통함·예약표. 상세는 목록의 '자세히 보기'로만 열어 진입 목록에는 넣지 않는다. */
function CustomersScreen({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <EntryList
      title="고객"
      description="고객과 주고받은 내용, 예약 일정을 여기서 확인해요."
      entries={APP_SCREENS.filter(screen => screen.tab === 'customers' && CUSTOMERS_SUMMARY[screen.id])
        .map(screen => ({ id: screen.id, title: screen.title, summary: CUSTOMERS_SUMMARY[screen.id] }))}
      onOpen={onOpen}
    />
  )
}

/** 화면표에 없는 id 는 그리지 않는다(없는 화면을 있는 것처럼 만들지 않는다). */
function MissingScreen({ screen }: { screen: AppScreen }) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pt-3">
      <h1 className="text-2xl font-semibold tracking-tight">{screen.title}</h1>
      <p className="rounded-2xl border border-dashed border-border p-5 text-sm leading-relaxed text-muted-foreground">
        이 화면은 아직 예시로 준비되지 않았어요.
      </p>
    </div>
  )
}

/** 화면 모양을 보여주기 위한 예시 결정. 실제 승인 데이터가 아니다. */
const EXAMPLE_DECISIONS = [
  { id: 'preview-approval-1', kindLabel: '콘텐츠', targetLabel: '인스타그램 · 신메뉴 안내', title: '게시 전 최종 확인이 필요해요' },
  { id: 'preview-approval-2', kindLabel: '메시지', targetLabel: '예약 문의 · 김예시', title: '고객 문의 답장 초안을 확인해 주세요' },
  { id: 'preview-approval-3', kindLabel: '댓글', targetLabel: '인스타그램 · 최근 게시물', title: '댓글 답글 초안이 준비됐어요' },
  { id: 'preview-approval-4', kindLabel: '소희 제안', targetLabel: '비는 시간 · 목요일 오후 3시', title: '비는 시간을 알려드릴까요?' },
  { id: 'preview-approval-5', kindLabel: '콘텐츠', targetLabel: '인스타그램 · 주간 후기', title: '이번 주 후기 게시물을 검토해 주세요' },
] as const
