'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { AtSign, BookOpen, Camera, ChevronRight, FileText, RefreshCw, Search, Store, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StateView, StatusPill } from '@/components/mobile-ui'
import { cn } from '@/lib/utils'
import { filterWork, listViewState, type WorkSegment } from './filters'
import { parseHubRestore, readHubRestoreSnapshot, writeHubRestore } from './restore'
import type { WorkRow } from './work-items'
import type { WorkItemsResult } from './use-work-items'

/** 서버·하이드레이션 단계 표식. sessionStorage는 브라우저에서만 읽을 수 있다. */
const SERVER_SNAPSHOT = '\u0000server'
const subscribe = () => () => undefined
const getServerSnapshot = () => SERVER_SNAPSHOT

const SEGMENTS: ReadonlyArray<{ value: WorkSegment; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'draft', label: '초안' },
  { value: 'review', label: '검토' },
  { value: 'scheduled', label: '예약' },
  { value: 'verifying', label: '확인 중' },
  { value: 'confirmed', label: '게시 확인' },
]

/** M11 작업함: 검색·세그먼트·상태 5종. 뒤로가기 시 검색/세그먼트/스크롤을 복원한다. */
export function MobileHubView({ workspaceId, source }: { workspaceId: string; source: WorkItemsResult }) {
  // 같은 탭에서 돌아왔을 때 검색·세그먼트를 이어간다. 스냅샷은 브라우저에서만 읽히므로
  // 서버 렌더 단계에서는 기본값을 쓰고 하이드레이션 뒤 한 번만 다시 읽는다.
  const snapshot = useSyncExternalStore(
    subscribe,
    () => readHubRestoreSnapshot(window.sessionStorage, workspaceId),
    getServerSnapshot,
  )
  const restored = parseHubRestore(snapshot === SERVER_SNAPSHOT ? null : snapshot)
  const [editedQuery, setEditedQuery] = useState<string | null>(null)
  const [editedSegment, setEditedSegment] = useState<WorkSegment | null>(null)
  const query = editedQuery ?? restored.query
  const segment = editedSegment ?? restored.segment
  const latest = useRef({ query, segment })
  const scrollRestored = useRef(false)

  useEffect(() => {
    latest.current = { query, segment }
  }, [query, segment])

  // 목록이 준비된 뒤 한 번만 스크롤 위치를 되돌린다.
  useEffect(() => {
    if (snapshot === SERVER_SNAPSHOT || scrollRestored.current) return
    if (restored.scrollY <= 0 || source.loadState === 'loading') return
    scrollRestored.current = true
    const frame = requestAnimationFrame(() => window.scrollTo({ top: restored.scrollY, behavior: 'auto' }))
    return () => cancelAnimationFrame(frame)
  }, [snapshot, source.loadState, restored.scrollY])

  // 검색·세그먼트 변경 즉시 저장한다. 스크롤 위치는 화면을 떠날 때 따로 기록한다.
  useEffect(() => {
    if (snapshot === SERVER_SNAPSHOT) return
    writeHubRestore(window.sessionStorage, workspaceId, { query, segment, scrollY: restored.scrollY })
  }, [snapshot, workspaceId, query, segment, restored.scrollY])

  useEffect(() => {
    return () => {
      if (snapshot === SERVER_SNAPSHOT) return
      writeHubRestore(window.sessionStorage, workspaceId, { ...latest.current, scrollY: window.scrollY })
    }
  }, [snapshot, workspaceId])

  const matched = filterWork(source.items, { segment, query })
  const viewState = listViewState({ loadState: source.loadState, complete: source.complete, items: source.items, matched: matched.length })

  return <div className="mx-auto w-full max-w-2xl space-y-5 pb-6 text-foreground">
    <header className="space-y-1 pt-1">
      <h1 className="text-2xl font-semibold tracking-tight">작업</h1>
      <p className="text-base leading-relaxed text-muted-foreground">준비된 작업을 확인하세요.</p>
    </header>

    <label className="flex min-h-12 items-center gap-2 rounded-xl border border-border bg-card px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">작업 검색</span>
      <input
        value={query}
        onChange={event => setEditedQuery(event.target.value)}
        placeholder="제목으로 검색"
        className="min-h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
        enterKeyHint="search"
        autoComplete="off"
      />
    </label>

    <div className="relative">
      <div
        role="tablist"
        aria-label="작업 상태"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {SEGMENTS.map(item => (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={segment === item.value}
            onClick={() => setEditedSegment(item.value)}
            className={cn(
              'min-h-11 shrink-0 snap-start rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              segment === item.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-4 top-0 bottom-1 w-8 bg-gradient-to-l from-background to-transparent"
      />
    </div>

    <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
      {viewState === 'loading' && '작업을 불러오고 있어요.'}
      {viewState === 'error' && '작업을 불러오지 못했어요.'}
      {viewState === 'stale' && '이전에 확인한 내용이에요.'}
      {viewState === 'partial' && (source.items.length === 0 ? '작업 연결을 확인 중이에요.' : `확인된 작업 ${matched.length}건이에요.`)}
      {viewState === 'no_match' && '조건에 맞는 작업이 없어요.'}
      {viewState === 'ready' && `작업 ${matched.length}건`}
    </p>

    {viewState === 'error' ? (
      <StateView
        kind="error"
        action={<Button onClick={source.refresh} variant="outline" className="min-h-12 w-full gap-2"><RefreshCw className="size-4" aria-hidden="true" />다시 확인하기</Button>}
      />
    ) : null}
    {viewState === 'loading' ? <ul aria-hidden="true" className="space-y-3">{[0, 1, 2].map(index => <li key={index} className="h-20 animate-pulse rounded-2xl bg-muted/60" />)}</ul> : null}

    {matched.length > 0 ? (
      <ul className="space-y-3">{matched.map(item => <li key={item.id}><WorkCard item={item} /></li>)}</ul>
    ) : (viewState === 'no_match' || (source.loadState === 'ready' && matched.length === 0)) ? (
      <StateView
        kind="confirmed_empty"
        title="표시할 작업이 없어요"
        description="새 글을 소희에게 맡겨 보세요."
        action={<Button asChild className="min-h-12 w-full"><Link href="/app/work/new">소희에게 글 맡기기</Link></Button>}
      />
    ) : null}

    {source.nextCursor && source.loadMore ? <Button onClick={source.loadMore} variant="outline" className="min-h-12 w-full">다음 작업 더 보기</Button> : null}

    {viewState === 'partial' && source.items.length === 0 && source.loadState === 'ready' && !source.nextCursor ?
      <div className="space-y-3 rounded-2xl border border-dashed border-border p-5">
        <p className="text-base font-medium">작업 연결 확인 중이에요</p>
        <p className="text-sm leading-relaxed text-muted-foreground">연결 상태를 다시 확인해 주세요.</p>
        <Button onClick={source.refresh} variant="outline" className="min-h-12 w-full gap-2"><RefreshCw className="size-4" aria-hidden="true" />연결 상태 다시 확인</Button>
      </div> : null}
  </div>
}

function resolveChannelMeta(channelLabel?: string): { Icon: LucideIcon; tint: string } {
  const norm = (channelLabel ?? '').toLowerCase()
  if (norm.includes('인스타그램') || norm.includes('insta')) {
    return { Icon: Camera, tint: 'bg-primary/10 text-primary' }
  }
  if (norm.includes('네이버') || norm.includes('naver') || norm.includes('블로그') || norm.includes('blog')) {
    return { Icon: BookOpen, tint: 'bg-state-ok-soft text-state-ok' }
  }
  if (norm.includes('스레드') || norm.includes('thread')) {
    return { Icon: AtSign, tint: 'bg-state-wait-soft text-state-wait' }
  }
  if (norm.includes('당근') || norm.includes('daangn')) {
    return { Icon: Store, tint: 'bg-state-warn-soft text-state-warn' }
  }
  return { Icon: FileText, tint: 'bg-muted text-muted-foreground' }
}

function formatCardTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (isToday) {
    const hours = String(d.getHours()).padStart(2, '0')
    const mins = String(d.getMinutes()).padStart(2, '0')
    return `${hours}:${mins}`
  }
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

function WorkCard({ item }: { item: WorkRow }) {
  const verified = item.status === 'confirmed' && item.publishedUrl !== null
  const pillKind = verified
    ? 'verified'
    : item.status === 'confirmed'
      ? 'checking_external'
      : item.status === 'review'
        ? 'review'
        : item.status === 'scheduled'
          ? 'review'
          : item.status === 'verifying'
            ? 'checking_external'
            : 'draft'

  const { Icon: ChannelIcon, tint: channelTint } = resolveChannelMeta(item.channelLabel)
  const formattedTime = formatCardTime(item.createdAt)

  return <Link
    prefetch={false}
    href={item.href}
    className="group flex min-h-[72px] items-center justify-between gap-3.5 rounded-2xl border border-border bg-card p-3.5 transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring"
  >
    <div
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105', channelTint)}
      aria-hidden="true"
    >
      <ChannelIcon className="size-5 shrink-0" />
    </div>

    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="flex min-w-0 items-center">
        <span className="truncate text-[15px] font-semibold leading-snug text-foreground group-hover:text-primary">{item.title}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="shrink-0 font-medium">{item.channelLabel}</span>
        <span className="shrink-0 text-muted-foreground/50" aria-hidden="true">·</span>
        <StatusPill kind={pillKind} label={item.statusLabel} compact className="shrink-0" />
        {formattedTime ? (
          <>
            <span className="shrink-0 text-muted-foreground/50" aria-hidden="true">·</span>
            <span className="shrink-0 truncate">{formattedTime}</span>
          </>
        ) : null}
      </div>
    </div>

    <ChevronRight className="size-5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
  </Link>
}
