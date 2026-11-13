import type { ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  CalendarClock,
  Camera,
  CheckCircle2,
  ChevronRight,
  Home,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Send,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FreshnessLabel, StateView, StatusPill } from '@/components/mobile-ui'

export type AbVariant = 'a' | 'b'
export type AbState =
  | 'ready'
  | 'loading'
  | 'empty'
  | 'partial'
  | 'stale'
  | 'error'
  | 'offline'
  | 'unauthorized'

export const isAbVariant = (value: string): value is AbVariant => value === 'a' || value === 'b'

const STATES: readonly AbState[] = [
  'ready',
  'loading',
  'empty',
  'partial',
  'stale',
  'error',
  'offline',
  'unauthorized',
]

export const isAbState = (value: string): value is AbState => (STATES as readonly string[]).includes(value)

/** 검수용 예시 데이터. 서버 시각을 흉내 내되, 화면에는 "예시"라고 항상 밝힌다. */
const CHECKED_AT = '2026-10-22T07:40:00Z'

const STATE_KIND = {
  loading: 'loading',
  empty: 'confirmed_empty',
  partial: 'partial',
  stale: 'stale',
  error: 'error',
  offline: 'offline',
  unauthorized: 'unauthorized',
} as const

function ExampleBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[12px] leading-4 text-muted-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/50" />
      예시 화면 · 실제 데이터 아님
    </span>
  )
}

function StateAction({ children }: Readonly<{ children: ReactNode }>) {
  return <span className="block">{children}</span>
}

function stateAction(state: AbState) {
  switch (state) {
    case 'empty':
      return <StateAction><Button className="h-12 w-full rounded-lg text-[16px]">소희에게 맡기기</Button></StateAction>
    case 'error':
      return <StateAction><Button className="h-12 w-full rounded-lg text-[16px]">다시 확인</Button></StateAction>
    case 'offline':
      return (
        <StateAction>
          <Button className="h-12 w-full rounded-lg text-[16px]">연결되면 다시 확인</Button>
          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">연결될 때 자동으로 보내지 않아요.</p>
        </StateAction>
      )
    case 'unauthorized':
      return <StateAction><Button variant="outline" className="h-12 w-full rounded-lg text-[16px]">가게 다시 선택</Button></StateAction>
    case 'partial':
      return <StateAction><Button variant="outline" className="h-11 rounded-lg px-3 text-[14px]">연결 상태 확인</Button></StateAction>
    case 'stale':
      return <StateAction><Button variant="outline" className="h-11 rounded-lg px-3 text-[14px]">다시 확인</Button></StateAction>
    default:
      return null
  }
}

function StateScreen({ state, className }: Readonly<{ state: AbState; className?: string }>) {
  const kind = STATE_KIND[state as keyof typeof STATE_KIND]
  if (!kind) return null
  return (
    <StateView
      kind={kind}
      checkedAt={state === 'ready' ? undefined : CHECKED_AT}
      action={stateAction(state)}
      className={className}
    />
  )
}

function isBanner(state: AbState): state is 'partial' | 'stale' {
  return state === 'partial' || state === 'stale'
}

function isFullState(state: AbState): boolean {
  return state === 'loading' || state === 'empty' || state === 'error' || state === 'offline' || state === 'unauthorized'
}

/* ------------------------------------------------------------------ */
/* A안 — 결정 우선                                                     */
/* ------------------------------------------------------------------ */

const TABS = [
  { key: 'today', label: '오늘', Icon: Home },
  { key: 'chat', label: '대화', Icon: MessageCircle },
  { key: 'customers', label: '고객', Icon: Users },
  { key: 'results', label: '성과', Icon: BarChart3 },
  { key: 'more', label: '더보기', Icon: MoreHorizontal },
] as const

function TabBar() {
  return (
    <nav
      aria-label="주요 메뉴"
      className="sticky bottom-0 z-10 grid grid-cols-5 border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)]"
    >
      {TABS.map(({ key, label, Icon }) => {
        const active = key === 'today'
        return (
          <span
            key={key}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 ${
              active ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <Icon aria-hidden className="size-5" strokeWidth={active ? 2.4 : 1.9} />
            <span className={`text-[12px] leading-4 ${active ? 'font-semibold' : 'font-medium'}`}>{label}</span>
          </span>
        )
      })}
    </nav>
  )
}

function TodayContentA() {
  return (
    <div className="space-y-5">
      <section aria-labelledby="a-decision">
        <p id="a-decision" className="text-[13px] font-medium text-muted-foreground">
          지금 결정할 일
        </p>
        <div className="mt-2 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <StatusPill kind="review" />
            <span className="text-[13px] leading-5 text-muted-foreground">약 5분</span>
          </div>
          <h2 className="mt-2.5 text-[18px] font-semibold leading-7 text-foreground">금요일 새 메뉴 홍보</h2>
          <p className="mt-1 text-[15px] leading-6 text-muted-foreground">
            매장 사진과 지난주 반응을 근거로 문안을 준비했어요. 확인하면 게시 준비를 시작합니다.
          </p>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5">
            <Megaphone aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-[13px] leading-5 text-muted-foreground">근거 · 매장 사진 3장, 지난주 반응 기록</p>
          </div>
          <Button className="mt-3 h-12 w-full rounded-lg text-[16px] font-semibold">
            문안 확인하기
            <ArrowRight aria-hidden className="size-4" />
          </Button>
          <Button variant="ghost" className="mt-1 h-11 w-full text-[14px] text-muted-foreground">
            나중에 할게요
          </Button>
        </div>
      </section>

      <section aria-labelledby="a-news">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="a-news" className="text-[15px] font-semibold text-foreground">
            소희가 확인한 소식
          </h2>
          <span className="text-[13px] font-medium text-primary">전체 보기</span>
        </div>
        <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          <li className="flex items-center gap-3 px-3.5 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-state-ok-soft text-state-ok">
              <CheckCircle2 aria-hidden className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium leading-6 text-foreground">게시 확인됨</span>
              <span className="block truncate text-[13px] leading-5 text-muted-foreground">네이버 플레이스 · 가을 메뉴 소식</span>
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </li>
          <li className="flex items-center gap-3 px-3.5 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-state-wait-soft text-state-wait">
              <MessageSquare aria-hidden className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium leading-6 text-foreground">새 문의 확인</span>
              <span className="block truncate text-[13px] leading-5 text-muted-foreground">예약 가능한 시간을 묻는 문의예요</span>
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </li>
          <li className="flex items-center gap-3 px-3.5 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-state-quiet-soft text-state-quiet">
              <CalendarClock aria-hidden className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium leading-6 text-foreground">이번 주 예약</span>
              <span className="block truncate text-[13px] leading-5 text-muted-foreground">원장에서 확인된 예약만 보여드려요</span>
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </li>
        </ul>
        <FreshnessLabel checkedAt={CHECKED_AT} className="mt-2 block text-right" />
      </section>

      <Button variant="outline" className="h-12 w-full rounded-lg text-[15px]">
        <Camera aria-hidden className="size-4" />
        새 홍보 맡기기
      </Button>
    </div>
  )
}

function VariantA({ state }: Readonly<{ state: AbState }>) {
  return (
    <div data-variant="a" data-state={state} className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col bg-background text-foreground">
      <header className="border-b border-border px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
        <div className="flex items-center justify-between">
          <p className="text-[13px] leading-5 text-muted-foreground">10월 22일 목요일</p>
          <span role="img" aria-label="알림" className="grid size-9 place-items-center rounded-full text-muted-foreground">
            <Bell aria-hidden className="size-5" />
          </span>
        </div>
        <h1 className="mt-0.5 text-[22px] font-semibold leading-8">오늘, 사장님</h1>
        <p className="text-[15px] leading-6 text-muted-foreground">확인이 필요한 일이 있어요</p>
      </header>

      <main className="flex-1 px-4 pb-5 pt-4">
        <div className="mb-3 flex justify-start">
          <ExampleBadge />
        </div>
        {isFullState(state) ? (
          <StateScreen state={state} className="pt-8" />
        ) : isBanner(state) ? (
          <StateView kind={STATE_KIND[state]} checkedAt={CHECKED_AT} action={stateAction(state)}>
            <div className="pt-4">
              <TodayContentA />
            </div>
          </StateView>
        ) : (
          <TodayContentA />
        )}
      </main>

      <TabBar />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* B안 — 대화 우선                                                     */
/* ------------------------------------------------------------------ */

const CHIPS = [
  { label: '사진 보내기', Icon: Camera },
  { label: '이번 주 홍보', Icon: Megaphone },
  { label: '예약 문의 확인', Icon: CalendarClock },
] as const

function SoheeAvatar({ className = '' }: Readonly<{ className?: string }>) {
  return (
    <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full bg-accent text-[12px] font-bold text-primary ${className}`}>
      소
    </span>
  )
}

function ChatThread() {
  return (
    <div className="space-y-4">
      <p className="text-center text-[12px] leading-4 text-muted-foreground">오늘</p>

      <div className="flex items-start gap-2">
        <SoheeAvatar />
        <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-border bg-card px-3.5 py-2.5 text-[15px] leading-6 text-card-foreground">
          사장님, 금요일 새 메뉴 홍보 문안을 준비했어요. 매장 사진과 지난주 반응을 근거로 만들었습니다.
        </div>
      </div>

      <div className="ml-9 rounded-xl border border-border bg-card p-3.5">
        <div className="flex items-center justify-between gap-2">
          <StatusPill kind="review" />
          <span className="text-[13px] leading-5 text-muted-foreground">약 5분</span>
        </div>
        <p className="mt-2 text-[16px] font-semibold leading-6 text-foreground">금요일 새 메뉴 홍보</p>
        <p className="mt-0.5 text-[14px] leading-5 text-muted-foreground">근거 · 매장 사진 3장, 지난주 반응 기록</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button className="h-11 flex-1 rounded-lg text-[15px]">
            문안 보기
            <ArrowRight aria-hidden className="size-4" />
          </Button>
          <Button variant="outline" className="h-11 rounded-lg px-3 text-[14px]">
            나중에
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-primary px-3.5 py-2.5 text-[15px] leading-6 text-primary-foreground">
          이번 주 금요일로 올려줘
        </div>
      </div>

      <div className="flex items-start gap-2">
        <SoheeAvatar />
        <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-border bg-card px-3.5 py-2.5 text-[15px] leading-6 text-card-foreground">
          <p>게시 준비를 시작할게요. 외부 채널에 실제로 올라간 것이 확인되면 알려드릴게요.</p>
          <div className="mt-2">
            <StatusPill kind="checking_external" />
          </div>
        </div>
      </div>

      <p className="pl-9 text-[12px] leading-4 text-muted-foreground">
        <FreshnessLabel checkedAt={CHECKED_AT} /> · 확인된 내용만 알려드려요
      </p>
    </div>
  )
}

function Composer({ state }: Readonly<{ state: AbState }>) {
  const blocked = state === 'offline' || state === 'unauthorized' || state === 'error'
  return (
    <div className="sticky bottom-0 border-t border-border bg-background pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] pt-2">
      <div className="flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        {CHIPS.map(({ label, Icon }) => (
          <Button key={label} variant="outline" className="h-11 shrink-0 rounded-full px-3.5 text-[14px] font-medium">
            <Icon aria-hidden className="size-4 text-muted-foreground" />
            {label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2 px-4 pt-0.5">
        <input
          aria-label="소희에게 메시지"
          placeholder={blocked ? '연결되면 보낼 수 있어요' : '소희에게 맡길 일을 적어 주세요'}
          disabled={blocked}
          className="h-11 min-w-0 flex-1 rounded-full border border-border bg-muted px-4 text-[16px] text-foreground placeholder:text-muted-foreground disabled:opacity-60"
        />
        <Button aria-label="보내기" className="size-11 shrink-0 rounded-full p-0" disabled={blocked}>
          <Send aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function VariantB({ state }: Readonly<{ state: AbState }>) {
  return (
    <div data-variant="b" data-state={state} className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-2 pb-2.5 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)]">
        <span role="img" aria-label="뒤로" className="grid size-11 place-items-center rounded-full text-muted-foreground">
          <ArrowLeft aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold leading-6">소희</p>
          <p className="truncate text-[12px] leading-4 text-muted-foreground">확인된 것만 알려드려요</p>
        </div>
        <span role="img" aria-label="더보기" className="grid size-11 place-items-center rounded-full text-muted-foreground">
          <MoreHorizontal aria-hidden className="size-5" />
        </span>
      </header>

      <main className="flex-1 px-4 pb-4 pt-3">
        <div className="mb-3 flex justify-start">
          <ExampleBadge />
        </div>
        {isFullState(state) ? (
          <StateScreen state={state} className="pt-6" />
        ) : isBanner(state) ? (
          <StateView kind={STATE_KIND[state]} checkedAt={CHECKED_AT} action={stateAction(state)}>
            <div className="pt-4">
              <ChatThread />
            </div>
          </StateView>
        ) : (
          <ChatThread />
        )}
      </main>

      <Composer state={state} />
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function MobileAbPreview({
  variant,
  state,
  nav = false,
}: Readonly<{ variant: AbVariant; state: AbState; nav?: boolean }>) {
  const body = variant === 'a' ? <VariantA state={state} /> : <VariantB state={state} />

  if (!nav) return body

  const states: Array<[AbState, string]> = [
    ['ready', '기본'],
    ['loading', '불러오는 중'],
    ['empty', '빈 목록'],
    ['partial', '일부'],
    ['stale', '이전 확인'],
    ['error', '오류'],
    ['offline', '오프라인'],
    ['unauthorized', '권한 없음'],
  ]

  return (
    <div>
      <div className="mx-auto w-full max-w-[390px] border-b border-border bg-background px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {(['a', 'b'] as const).map((v) => (
            <a
              key={v}
              href={`?variant=${v}&state=${state}&nav=1`}
              className={`inline-flex min-h-11 items-center rounded-full px-3 text-[13px] font-medium ${
                v === variant ? 'bg-primary text-primary-foreground' : 'border border-border text-foreground'
              }`}
            >
              {v.toUpperCase()}안
            </a>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {states.map(([value, label]) => (
            <a
              key={value}
              href={`?variant=${variant}&state=${value}&nav=1`}
              className={`inline-flex min-h-11 items-center rounded-full px-2.5 text-[13px] ${
                value === state ? 'bg-accent text-accent-foreground' : 'border border-border text-muted-foreground'
              }`}
            >
              {label}
            </a>
          ))}
        </div>
      </div>
      {body}
    </div>
  )
}
