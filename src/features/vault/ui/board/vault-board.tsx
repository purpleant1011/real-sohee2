'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react'
import { StateView, StatusPill } from '@/components/mobile-ui'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { PaginatedResult, VaultCalendarDto, VaultItemDetailDto, VaultItemUserDto, VaultPeriod, VaultSummaryDto } from '@/features/vault/query/types'
import { ReleasePanel } from '@/features/vault/ui/release-panel/release-panel'
import { VaultBundleDialog } from './vault-bundle-dialog'
import { VaultCardMenu } from './vault-card-menu'
import { VaultItemSheet } from './vault-item-sheet'
import { defaultVaultFetch, getEnveloped, vaultBase, type VaultFetch } from './vault-api'

export type VaultBoardData = {
  items: PaginatedResult<VaultItemUserDto>
  calendar: VaultCalendarDto
  summary: VaultSummaryDto
}

type LoadState = 'loading' | 'error' | 'ready'

/** Only used by the static development page, where no real workspace exists and requests go to fixtures. */
const STATIC_WORKSPACE = 'preview'

const PERIODS: { label: string; value: VaultPeriod }[] = [
  { label: '이번 주', value: 'this_week' },
  { label: '다음 주', value: 'next_week' },
  { label: '월간', value: 'month' },
  { label: '시간 미정', value: 'unscheduled' },
  { label: '전체', value: 'all' },
]

// The calendar endpoint uses channel keys for aggregation, unlike user-facing item DTOs.
// Never render an unrecognized key (or any internal code) as fallback text.
const CHANNEL_NAMES: Record<string, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  daangn_business: '당근 비즈니스',
}

function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(ym: string, direction: number): string {
  const [year, month] = ym.split('-').map(Number)
  return monthOf(new Date(year, month - 1 + direction, 1))
}

function readableDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return `${year}년 ${month}월 ${day}일`
}

function channelBreakdown(channels: Record<string, number | undefined>): string {
  return Object.entries(channels)
    .filter(([key, count]) => CHANNEL_NAMES[key] && typeof count === 'number' && count > 0)
    .map(([key, count]) => `${CHANNEL_NAMES[key]} ${count}건`)
    .join(' · ')
}

function VaultKpis({ summary }: { summary: VaultSummaryDto }) {
  const stats = [
    { title: '보관', value: summary.stored_count, note: '발행 전 안전하게 보관 중' },
    { title: '재확인 필요', value: summary.needs_reapproval_count, note: '다시 살펴볼 항목' },
    { title: '외부 게시', value: summary.external_action_count, note: '보관 중 연결된 게시 기록' },
  ]
  return <>
    <section aria-label="보관함 요약" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {stats.map(({ title, value, note }) => (
        <Card key={title} className="gap-2 border-border/80 py-4 shadow-xs">
          <CardHeader className="px-4"><p className="text-sm font-semibold text-foreground">{title}</p></CardHeader>
          <CardContent className="space-y-1 px-4">
            <p className="text-2xl font-bold tabular-nums text-foreground">{title} {value.toLocaleString('ko-KR')}건</p>
            <p className="text-sm text-muted-foreground">{note}</p>
          </CardContent>
        </Card>
      ))}
    </section>
    {summary.external_action_warning && (
      <div role="alert" className="rounded-xl border border-state-warn/40 bg-state-warn-soft p-4 text-sm font-medium text-state-warn ">
        보관 중 외부 게시 기록이 감지됐어요. 관리자에게 확인해 주세요.
      </div>
    )}
  </>
}

function VaultCalendar({ calendar, ym, onMonthChange }: { calendar: VaultCalendarDto; ym: string; onMonthChange: (ym: string) => void }) {
  const [year, month] = ym.split('-').map(Number)
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month, 0).getDate()
  const orderedDays = Object.entries(calendar.days).filter(([date]) => date.startsWith(`${ym}-`)).sort(([a], [b]) => a.localeCompare(b))
  return <section role="region" aria-label="월간 보관 달력" className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-lg font-semibold"><CalendarDays className="size-5" aria-hidden="true" />{year}년 {month}월</h3>
      <div className="flex gap-1">
        <Button variant="outline" size="icon" aria-label="이전 달" onClick={() => onMonthChange(shiftMonth(ym, -1))}><ChevronLeft aria-hidden="true" /></Button>
        <Button variant="outline" size="icon" aria-label="다음 달" onClick={() => onMonthChange(shiftMonth(ym, 1))}><ChevronRight aria-hidden="true" /></Button>
      </div>
    </div>
    <p className="text-sm text-muted-foreground">시간 미정 {calendar.unscheduled_count}건 · 날짜별 보관 건수와 채널</p>
    <div className="hidden sm:block">
      <div className="grid grid-cols-7 gap-1 text-center text-sm font-medium text-muted-foreground" aria-hidden="true">
        {['월', '화', '수', '목', '금', '토', '일'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {Array.from({ length: firstWeekday }, (_, i) => <div key={`blank-${i}`} aria-hidden="true" />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1
          const date = `${ym}-${String(day).padStart(2, '0')}`
          const entry = calendar.days[date]
          return <div key={date} aria-label={`${readableDate(date)} ${entry?.total ?? 0}건${entry ? `, ${channelBreakdown(entry.channels)}` : ''}`} className="min-h-24 min-w-0 rounded-lg border border-border/80 p-2 text-sm">
            <span className="font-medium">{day}</span>
            {entry && <><span className="mt-1 block font-bold text-foreground">{entry.total}건</span><span className="mt-1 block wrap-break-word text-xs text-muted-foreground">{channelBreakdown(entry.channels)}</span></>}
          </div>
        })}
      </div>
    </div>
    <ul aria-label="모바일 월간 일정" className="space-y-2 sm:hidden">
      {orderedDays.length === 0 && <li className="rounded-lg bg-muted p-3 text-sm">이번 달 날짜가 정해진 콘텐츠가 없어요.</li>}
      {orderedDays.map(([date, entry]) => <li key={date} className="rounded-lg border border-border p-3 text-sm">
        <span className="font-semibold">{readableDate(date)} · {entry.total}건</span>
        <span className="mt-1 block text-muted-foreground">{channelBreakdown(entry.channels)}</span>
      </li>)}
    </ul>
  </section>
}

/** Manual-publishing channels get a copy bundle; Instagram and Threads are handled by the release flow. */
const BUNDLE_CHANNELS: ReadonlySet<VaultItemUserDto['channel']> = new Set(['naver_blog', 'daangn_business'])

type TriggerKind = 'preview' | 'menu'

function cardName(item: VaultItemUserDto): string {
  return `${item.channel_label} ${item.target_date ? readableDate(item.target_date) : '시간 미정'}`
}

function VaultCards({ items, onPreview, onBundle, registerTrigger }: {
  items: VaultItemUserDto[]
  onPreview: (item: VaultItemUserDto) => void
  onBundle: (item: VaultItemUserDto) => void
  registerTrigger: (itemRef: string, kind: TriggerKind, element: HTMLElement | null) => void
}) {
  if (items.length === 0) {
    return (
      <StateView
        kind="confirmed_empty"
        title="보관한 콘텐츠가 아직 없어요"
        description="새 글을 소희에게 맡겨 보세요."
        action={
          <Button asChild className="min-h-12 w-full">
            <Link href="/app/work/new">소희에게 글 맡기기</Link>
          </Button>
        }
      />
    )
  }
  return <ul aria-label="보관한 콘텐츠" className="grid min-w-0 gap-3 lg:grid-cols-2">
    {items.map((item) => <li key={item.item_ref} className="min-w-0">
      <Card className="h-full min-w-0 gap-2 border-border/80 p-4 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-base font-semibold leading-snug">{cardName(item)}</span>
          <StatusPill kind={item.hold_reason_label ? 'action_needed' : 'draft'} label={item.status_label} />
        </div>
        <p className="truncate text-xs text-muted-foreground">
          예정일 <span>{item.target_date ? readableDate(item.target_date) : '시간 미정'}</span>
          {item.hold_reason_label ? <> · <span>{item.hold_reason_label}</span></> : null}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            ref={(element) => registerTrigger(item.item_ref, 'preview', element)}
            type="button"
            variant="outline"
            className="min-h-11"
            aria-label={`${cardName(item)} 미리보기`}
            onClick={() => onPreview(item)}
          >미리보기</Button>
          {BUNDLE_CHANNELS.has(item.channel) && <VaultCardMenu
            ref={(element) => registerTrigger(item.item_ref, 'menu', element)}
            label={cardName(item)}
            onOpenBundle={() => onBundle(item)}
          />}
        </div>
      </Card>
    </li>)}
  </ul>
}

type Panel = { kind: 'preview' | 'bundle'; itemRef: string; channelLabel: string }

/** The list DTO is a subset of the detail DTO, so a re-read item can replace its card without a list reload. */
function toListItem(detail: VaultItemDetailDto): VaultItemUserDto {
  const { item_ref, channel, channel_label, status_label, hold_reason_label, target_date, held_at, created_at, updated_at } = detail
  return { item_ref, channel, channel_label, status_label, hold_reason_label, target_date, held_at, created_at, updated_at }
}

export type VaultBoardProps = {
  workspaceId?: string
  /** Static fixtures for the development page: no list requests are made. */
  initialData?: VaultBoardData
  /** Static page only: open a sheet or the copy dialog for this card on first render. */
  initialOpen?: { kind: Panel['kind']; itemRef: string }
  /** Serves every board request; defaults to the global fetch. */
  fetchFn?: VaultFetch
}

export function VaultBoard({ workspaceId, initialData, initialOpen, fetchFn = defaultVaultFetch }: VaultBoardProps) {
  const [period, setPeriod] = useState<VaultPeriod>('all')
  const [ym, setYm] = useState(() => monthOf(new Date()))
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ key: string; state: LoadState }>(() => ({ key: initialData ? 'static' : '', state: initialData ? 'ready' : 'loading' }))
  const [data, setData] = useState<VaultBoardData | null>(initialData ?? null)
  const [items, setItems] = useState<VaultItemUserDto[]>(initialData?.items.items ?? [])
  const [nextCursor, setNextCursor] = useState<string | null>(initialData?.items.nextCursor ?? null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const [panel, setPanel] = useState<Panel | null>(() => {
    const target = initialOpen && initialData?.items.items.find((item) => item.item_ref === initialOpen.itemRef)
    return initialOpen && target ? { kind: initialOpen.kind, itemRef: target.item_ref, channelLabel: target.channel_label } : null
  })
  // Cards deleted from the sheet stay visible (with the restore wording) until the sheet closes, so Restore still works.
  const [deletedRefs, setDeletedRefs] = useState<ReadonlySet<string>>(new Set())
  const [reloadOnClose, setReloadOnClose] = useState(false)
  const [releaseVersion, setReleaseVersion] = useState(0)
  const triggers = useRef(new Map<string, HTMLElement>())
  const requestKey = initialData ? 'static' : `${workspaceId ?? ''}:${period}:${ym}:${retry}`
  const activeRequest = useRef(requestKey)
  useEffect(() => { activeRequest.current = requestKey }, [requestKey])
  const state: LoadState = initialData ? 'ready' : !workspaceId ? 'error' : result.key === requestKey ? result.state : 'loading'

  useEffect(() => {
    if (initialData) return
    if (!workspaceId) return
    const controller = new AbortController()
    const base = vaultBase(workspaceId)
    const itemQuery = new URLSearchParams({ period, ym })
    Promise.all([
      getEnveloped<PaginatedResult<VaultItemUserDto>>(fetchFn, `${base}/items?${itemQuery}`, controller.signal),
      getEnveloped<VaultCalendarDto>(fetchFn, `${base}/calendar?ym=${encodeURIComponent(ym)}`, controller.signal),
      getEnveloped<VaultSummaryDto>(fetchFn, `${base}/summary`, controller.signal),
    ]).then(([newItems, calendar, summary]) => {
      if (controller.signal.aborted) return
      setData({ items: newItems, calendar, summary })
      setItems(newItems.items)
      setNextCursor(newItems.nextCursor)
      setLoadMoreError(false)
      setResult({ key: requestKey, state: 'ready' })
    }).catch(() => { if (!controller.signal.aborted) setResult({ key: requestKey, state: 'error' }) })
    return () => controller.abort()
  }, [workspaceId, period, ym, retry, initialData, requestKey, fetchFn])

  const loadMore = useCallback(async () => {
    if (!workspaceId || !nextCursor || loadingMore || initialData) return
    setLoadingMore(true)
    setLoadMoreError(false)
    try {
      const query = new URLSearchParams({ period, ym, cursor: nextCursor })
      const next = await getEnveloped<PaginatedResult<VaultItemUserDto>>(fetchFn, `${vaultBase(workspaceId)}/items?${query}`, new AbortController().signal)
      if (requestKey === activeRequest.current) {
        setItems((previous) => [...previous, ...next.items])
        setNextCursor(next.nextCursor)
      }
    } catch { if (requestKey === activeRequest.current) setLoadMoreError(true) }
    finally { setLoadingMore(false) }
  }, [workspaceId, nextCursor, loadingMore, initialData, period, ym, requestKey, fetchFn])

  const registerTrigger = useCallback((itemRef: string, kind: TriggerKind, element: HTMLElement | null) => {
    if (element) triggers.current.set(`${kind}:${itemRef}`, element)
    else triggers.current.delete(`${kind}:${itemRef}`)
  }, [])

  const closePanel = useCallback(() => {
    if (!panel) return
    const returnTo = triggers.current.get(`${panel.kind === 'bundle' ? 'menu' : 'preview'}:${panel.itemRef}`)
    setPanel(null)
    if (deletedRefs.size > 0) {
      setItems((previous) => previous.filter((item) => !deletedRefs.has(item.item_ref)))
      setDeletedRefs(new Set())
    }
    if (reloadOnClose) {
      setReloadOnClose(false)
      setRetry((value) => value + 1)
    }
    // The opener may have been removed (deleted card); then there is nothing to return to.
    requestAnimationFrame(() => { if (returnTo?.isConnected) returnTo.focus() })
  }, [panel, deletedRefs, reloadOnClose])

  /** After a change in the sheet: the re-read item replaces its card, and the totals and release check are refreshed. */
  const handleItemChanged = useCallback((itemRef: string, detail: VaultItemDetailDto | null) => {
    setReleaseVersion((value) => value + 1)
    if (!detail) { setReloadOnClose(true); return }
    setItems((previous) => previous.map((item) => item.item_ref === itemRef ? toListItem(detail) : item))
    setDeletedRefs((previous) => {
      const next = new Set(previous)
      if (detail.is_deleted) next.add(itemRef); else next.delete(itemRef)
      return next
    })
    if (initialData || !workspaceId) return
    getEnveloped<VaultSummaryDto>(fetchFn, `${vaultBase(workspaceId)}/summary`, new AbortController().signal)
      .then((summary) => setData((previous) => previous ? { ...previous, summary } : previous))
      .catch(() => setReloadOnClose(true))
  }, [initialData, workspaceId, fetchFn])

  const board = <div className="min-w-0 space-y-6">
    <div className="flex flex-wrap gap-2" role="group" aria-label="보관 기간">
      {PERIODS.map(({ label, value }) => <Button key={value} type="button" size="sm" variant={period === value ? 'default' : 'outline'} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</Button>)}
    </div>
    {state === 'loading' && <div role="status" aria-label="보관함 불러오는 중" className="space-y-4">
      <span className="sr-only">보관함 불러오는 중</span>
      <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      <Skeleton className="h-44" /><Skeleton className="h-36" />
    </div>}
    {state === 'error' && <div role="alert" className="rounded-2xl border border-destructive bg-card p-6 text-foreground">
      <p className="font-semibold">보관함을 불러오지 못했어요</p>
      <p className="my-3 text-sm text-muted-foreground">연결을 확인하고 다시 시도해 주세요.</p>
      <Button type="button" onClick={() => setRetry((v) => v + 1)}>다시 시도</Button>
    </div>}
    {state === 'ready' && data && <>
      {data.summary.intervention?.blocked && <div role="status" className="rounded-xl border border-state-warn/40 bg-state-warn-soft p-4 text-state-warn "><p className="font-semibold">{data.summary.intervention.label}</p><p className="mt-1 text-sm">{data.summary.intervention.detail}</p></div>}
      <VaultKpis summary={data.summary} />
      {period === 'month' && <VaultCalendar calendar={data.calendar} ym={ym} onMonthChange={setYm} />}
      <section aria-label="보관 목록" className="space-y-4">
        <div className="flex items-baseline justify-between gap-3"><h2 className="text-lg font-semibold">보관한 콘텐츠</h2><span className="text-sm text-muted-foreground">{items.length}건 표시</span></div>
        <VaultCards
          items={items}
          registerTrigger={registerTrigger}
          onPreview={(item) => setPanel({ kind: 'preview', itemRef: item.item_ref, channelLabel: item.channel_label })}
          onBundle={(item) => setPanel({ kind: 'bundle', itemRef: item.item_ref, channelLabel: item.channel_label })}
        />
        {loadMoreError && <p role="alert" className="text-sm text-destructive">추가 항목을 불러오지 못했어요. 다시 시도해 주세요.</p>}
        {nextCursor && <Button type="button" variant="outline" disabled={loadingMore} onClick={loadMore}>{loadingMore ? '불러오는 중' : '더 보기'}</Button>}
      </section>
      {workspaceId && <ReleasePanel key={releaseVersion} workspaceId={workspaceId} />}
      {panel?.kind === 'preview' && <VaultItemSheet
        workspaceId={workspaceId ?? STATIC_WORKSPACE}
        itemRef={panel.itemRef}
        channelLabel={panel.channelLabel}
        open
        onOpenChange={(open) => { if (!open) closePanel() }}
        onItemChanged={(detail) => handleItemChanged(panel.itemRef, detail)}
        fetchFn={fetchFn}
      />}
      {panel?.kind === 'bundle' && <VaultBundleDialog
        workspaceId={workspaceId ?? STATIC_WORKSPACE}
        itemRef={panel.itemRef}
        channelLabel={panel.channelLabel}
        open
        onOpenChange={(open) => { if (!open) closePanel() }}
        fetchFn={fetchFn}
      />}
    </>}
  </div>

  return <div className="mx-auto w-full min-w-0 max-w-6xl space-y-7 pb-36 md:pb-16 text-foreground">
    <header className="min-w-0 space-y-2">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldCheck className="size-4" aria-hidden="true" />발행 전 안전하게 살펴보기</p>
      <h1 className="text-3xl font-bold tracking-tight">보관함</h1>
      <p className="text-sm text-muted-foreground">게시 전 상태를 확인하세요.</p>
    </header>
    {board}
  </div>
}
