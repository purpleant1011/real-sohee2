'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Bell, CalendarClock, CheckCheck, RefreshCw, ShieldAlert } from 'lucide-react'
import { markNotificationReadAction } from '@/features/notifications/actions/manage-notifications'
import type { NotificationCenterData } from '@/features/notifications/repository'
import { previewText, resolveNotificationTarget, type NotificationKind } from './deeplink'

type Notification = NotificationCenterData['notifications'][number]
const KIND_LABEL: Record<NotificationKind, string> = { approval: '승인', schedule: '일정', publish: '게시', system: '안내' }
const FILTERS: ReadonlyArray<{ value: 'all' | NotificationKind; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'approval', label: '승인' },
  { value: 'schedule', label: '일정' },
  { value: 'publish', label: '게시' },
  { value: 'system', label: '안내' },
]

/** M23 알림함. 읽음 상태는 서버 정본(readAt)만 표시하고, 이동은 검증된 내부 경로만 허용한다. */
export function NotificationList({ data, workspaceId }: { data: NotificationCenterData; workspaceId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const search = useSearchParams()
  const [filter, setFilter] = useState<'all' | NotificationKind>(() => FILTERS.find(item => item.value === search?.get('kind'))?.value ?? 'all')
  const returnHref = filter === 'all' ? '/app/notifications' : `/app/notifications?kind=${filter}`
  const [message, setMessage] = useState('')

  const unread = data.notifications.filter(item => item.readAt === null).length
  const shown = useMemo(
    () => data.notifications.filter(item => filter === 'all' || item.kind === filter),
    [data.notifications, filter],
  )

  function selectFilter(next: 'all' | NotificationKind) {
    setFilter(next)
    router.replace(next === 'all' ? '/app/notifications' : `/app/notifications?kind=${next}`, { scroll: false })
  }

  function markRead(id: string) {
    setMessage('')
    startTransition(async () => {
      const result = await markNotificationReadAction({ notificationId: id })
      if (result.error) { setMessage(result.error.message); return }
      // 서버 정본을 다시 읽어 표시를 맞춘다. 로컬에서 읽음으로 낙관 처리하지 않는다.
      router.refresh()
    })
  }

  return <div className="mx-auto w-full max-w-2xl space-y-5 pb-6 text-foreground">
    <header className="flex items-end justify-between gap-3 pt-1">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">알림</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">내 알림만 보여드려요.</p>
      </div>
      <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-3 py-1 text-sm font-medium">{unread}개 읽지 않음</span>
    </header>

    <div role="tablist" aria-label="알림 종류" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {FILTERS.map(item => <button key={item.value} role="tab" type="button" aria-selected={filter === item.value}
        id={`notification-filter-${item.value}`} aria-controls="notification-results" tabIndex={filter === item.value ? 0 : -1}
        onClick={() => selectFilter(item.value)}
        onKeyDown={event => {
          if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const current = FILTERS.findIndex(option => option.value === item.value)
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? FILTERS.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + FILTERS.length) % FILTERS.length
          const next = FILTERS[index].value
          selectFilter(next)
          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#notification-filter-${next}`)?.focus()
        }}
        className={`min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${filter === item.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground'}`}
      >{item.label}</button>)}
    </div>

    {message ? <p role="alert" className="rounded-xl border border-border p-4 text-sm">{message}</p> : null}

    <div id="notification-results" role="tabpanel" aria-labelledby={`notification-filter-${filter}`}>
    {shown.length === 0 ?
      <div className="space-y-2 rounded-2xl border border-dashed border-border p-5">
        <p className="text-base font-medium">{data.notifications.length === 0 ? '아직 받은 알림이 없어요' : '이 종류의 알림이 없어요'}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">새 알림은 서버에 저장된 뒤 이 화면에 표시돼요.</p>
      </div> :
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {shown.map(item => <NotificationRow item={item} workspaceId={workspaceId} returnHref={returnHref} pending={pending} onMarkRead={markRead} key={item.id} />)}
      </ul>}
    </div>

    <p className="text-xs leading-relaxed text-muted-foreground">승인·일정 알림은 잠금 화면에 고객 정보가 보이지 않도록 일반 문구로 표시해요.</p>
  </div>
}

function NotificationRow({ item, workspaceId, returnHref, pending, onMarkRead }: {
  item: Notification
  workspaceId: string
  returnHref: string
  pending: boolean
  onMarkRead: (id: string) => void
}) {
  const target = resolveNotificationTarget({ workspaceId, href: item.href }, workspaceId)
  let detailHref = ''
  if (target.ok) {
    const url = new URL(target.href, 'https://sohee.invalid')
    url.searchParams.set('from', returnHref)
    detailHref = `${url.pathname}${url.search}${url.hash}`
  }
  const unread = item.readAt === null
  return <li className="space-y-2 p-4" data-unread={unread}>
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {item.kind === 'schedule' ? <CalendarClock className="size-3.5" aria-hidden="true" /> : <Bell className="size-3.5" aria-hidden="true" />}
        {KIND_LABEL[item.kind]}
      </span>
      <span className={`shrink-0 whitespace-nowrap text-xs font-medium ${unread ? 'text-primary' : 'text-muted-foreground'}`}>{unread ? '읽지 않음' : '읽음'}</span>
    </div>
    <p className="break-words break-keep text-base leading-relaxed">{previewText(item.kind, item.body)}</p>
    <div className="flex flex-wrap items-center gap-3">
      {target.ok ? <Link prefetch={false} href={detailHref} className="inline-flex min-h-11 items-center text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring">관련 화면 열기</Link>
        : target.reason === 'no_link' ? <span className="text-sm text-muted-foreground">연결된 화면 없음</span>
        : <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ShieldAlert className="size-4" aria-hidden="true" />안전하지 않아 열 수 없는 연결</span>}
      {unread ? <button type="button" disabled={pending} onClick={() => onMarkRead(item.id)}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring">
        <CheckCheck className="size-4" aria-hidden="true" />읽음으로 표시
      </button> : null}
    </div>
    <p className="text-xs text-muted-foreground">{formatTime(item.createdAt)}</p>
  </li>
}

export function NotificationListFailure({ onRetry }: { onRetry: () => void }) {
  return <section role="alert" className="mx-auto max-w-2xl space-y-3 rounded-2xl border border-border p-5">
    <h1 className="text-xl font-semibold">알림</h1>
    <p className="text-base leading-relaxed">알림을 불러오지 못했어요. 알림이 없다는 뜻은 아니에요.</p>
    <button type="button" onClick={onRetry} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border text-base font-medium">
      <RefreshCw className="size-4" aria-hidden="true" />다시 확인하기
    </button>
  </section>
}

// 서버(Node ICU)와 브라우저(ICU)가 만드는 문자열이 갈리면 하이드레이션이 어긋난다.
// 로케일·시간대·12/24시간제를 모두 고정해 `오후`/`PM` 차이를 없앤다.
const TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatTime(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return '시각 확인 필요'
  try { return TIME_FORMAT.format(new Date(parsed)) }
  catch { return '시각 확인 필요' }
}
