'use client'

import { AppLink as Link } from '@/components/navigation/app-link'
import { Archive, ArchiveRestore, BookOpen, ChevronDown, Clock3, Ellipsis, History, MessagesSquare, Monitor, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatKoreanMonthDayTime } from '@/lib/format-display-date'
import type { ConversationThreadSummary } from './thread-repository'
import { useConversationWorkStatus } from './conversation-work-status-context'
import type { ThreadWorkStatus } from './conversation-work-status'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { useHasMobileShell, useOptionalShellScreen, type HeaderAction } from '@/features/mobile-shell'
import { ConversationMobileBar } from './conversation-mobile-bar'
import styles from './conversation-shell.module.css'

type Props = Readonly<{
  workspaceId: string
  currentThreadId: string | null
  initialThreads: readonly ConversationThreadSummary[]
  initialLoadFailed?: boolean
  hasMore: boolean
  initiallyOpen?: boolean
  canManageThreads: boolean
  unreadInboxCount?: number
  directWorkHref?: string
  variant?: 'tools' | 'sidebar'
}>

function activityTime(thread: ConversationThreadSummary) {
  const value = thread.lastMessageAt ?? thread.createdAt
  return formatKoreanMonthDayTime(value)
}

function activityTimestamp(thread: ConversationThreadSummary) {
  return thread.lastMessageAt ?? thread.createdAt
}

function monthKey(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Asia/Seoul',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}`
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value))
}

function ThreadList({
  canManageThreads,
  currentThreadId,
  error,
  hasMore,
  hideHeader = false,
  initialLoadUnavailable,
  loading,
  onArchive,
  onCreate,
  onLoadMore,
  onRestore,
  threads,
  unreadInboxCount,
  variant = 'drawer',
  workStatusByThread,
}: Readonly<{
  canManageThreads: boolean
  currentThreadId: string | null
  error: string
  hasMore: boolean
  hideHeader?: boolean
  initialLoadUnavailable: boolean
  loading: boolean
  onArchive: (threadId: string) => void
  onCreate: () => void
  onLoadMore: () => void
  onRestore: (threadId: string) => void
  threads: readonly ConversationThreadSummary[]
  unreadInboxCount: number
  variant?: 'drawer' | 'sidebar'
  workStatusByThread: Readonly<Record<string, ThreadWorkStatus>>
}>) {
  const groups = useMemo(() => {
    const byMonth = new Map<string, { label: string; threads: ConversationThreadSummary[] }>()
    for (const thread of threads) {
      const timestamp = activityTimestamp(thread)
      const key = monthKey(timestamp)
      const group = byMonth.get(key) ?? { label: monthLabel(timestamp), threads: [] }
      group.threads.push(thread)
      byMonth.set(key, group)
    }
    return [...byMonth.entries()].map(([key, group]) => ({ key, ...group }))
  }, [threads])
  const [openMonths, setOpenMonths] = useState<ReadonlySet<string>>(() =>
    new Set(groups[0] ? [groups[0].key] : []),
  )

  return (
    <div
      aria-label={variant === 'sidebar' ? '최근 대화' : '과거 대화 목록'}
      className={`${styles.threadPanelBody} ${variant === 'sidebar' ? styles.sidebarThreadPanel : ''}`}
      role={variant === 'sidebar' ? 'navigation' : undefined}
    >
      {!hideHeader ? (
        <div className={styles.threadPanelHeading}>
          <div>
            <strong>{variant === 'sidebar' ? '최근 대화' : '과거 대화'}</strong>
            {variant === 'drawer' ? <p>메시지와 저장된 결과물을 다시 열 수 있어요.</p> : null}
          </div>
          {canManageThreads ? (
            <button aria-label="새 대화 시작" disabled={loading} onClick={onCreate} type="button">
              <Plus aria-hidden="true" />
              {variant === 'drawer' ? '새 대화' : null}
            </button>
          ) : null}
        </div>
      ) : null}
      {threads.length === 0 && initialLoadUnavailable ? (
        <div aria-live="polite" className={styles.threadEmpty}>
          <History aria-hidden="true" />
          <strong>최근 대화를 다시 연결하고 있어요</strong>
          <p>저장된 대화는 그대로 보존되어 있어요.</p>
        </div>
      ) : threads.length === 0 && !loading ? (
        <div className={styles.threadEmpty}>
          <History aria-hidden="true" />
          <strong>아직 저장된 대화가 없어요</strong>
          <p>새 대화를 시작하면 여기에 안전하게 남아요.</p>
        </div>
      ) : (
        <div className={styles.threadMonthGroups}>
          {groups.map((group) => (
            <details
              aria-label={`${group.label} 대화`}
              className={styles.threadMonth}
              key={group.key}
              onToggle={(event) => {
                const opened = event.currentTarget.open
                setOpenMonths((current) => {
                  const next = new Set(current)
                  if (opened) next.add(group.key)
                  else next.delete(group.key)
                  return next
                })
              }}
              open={openMonths.has(group.key)}
            >
              <summary aria-label={`${group.label} 대화 펼치기`}>
                <span>{group.label}</span>
                <small>{group.threads.length}개</small>
                <ChevronDown aria-hidden="true" />
              </summary>
              <ol aria-label={`${group.label} 대화 목록`} className={styles.threadList}>
                {group.threads.map((thread) => (
                  <li data-current={thread.id === currentThreadId} key={thread.id}>
                    <a
                      aria-current={thread.id === currentThreadId ? 'page' : undefined}
                      href={`/app/conversations/${thread.id}`}
                    >
                      <strong>{thread.title}</strong>
                      <span>
                        <time dateTime={activityTimestamp(thread)}>{activityTime(thread)}</time>
                        {thread.status === 'archived' ? (
                          <em data-status="archived">보관됨</em>
                        ) : workStatusByThread[thread.id] === 'working' ? (
                          <em data-status="working">작업 중</em>
                        ) : workStatusByThread[thread.id] === 'attention' ? (
                          <em data-status="attention">확인 필요</em>
                        ) : null}
                      </span>
                    </a>
                    {canManageThreads ? thread.status === 'active' ? (
                      <button
                        aria-label={`${thread.title} 보관`}
                        disabled={loading}
                        onClick={() => onArchive(thread.id)}
                        type="button"
                      ><Archive aria-hidden="true" /></button>
                    ) : (
                      <button
                        aria-label={`${thread.title} 복원`}
                        disabled={loading}
                        onClick={() => onRestore(thread.id)}
                        type="button"
                      ><ArchiveRestore aria-hidden="true" /></button>
                    ) : null}
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </div>
      )}
      {error ? (
        <div className={styles.threadError} role="alert">
          <p>{error}</p>
          <button disabled={loading} onClick={onLoadMore} type="button">다시 시도</button>
        </div>
      ) : hasMore ? (
        <button className={styles.loadThreads} disabled={loading} onClick={onLoadMore} type="button">
          {loading ? '불러오는 중…' : '이전 대화 더 보기'}
        </button>
      ) : null}
      {variant === 'drawer' ? <nav aria-label="대화 업무 바로가기" className={styles.conversationShortcuts}>
        <Link aria-label={`소희 문의답변 ${unreadInboxCount}`} href="/app/inbox">
          <MessagesSquare aria-hidden="true" />
          <span><strong>소희 문의답변</strong><small>댓글·DM·예약 문의</small></span>
          {unreadInboxCount > 0 ? <b>{Math.min(unreadInboxCount, 99)}</b> : null}
        </Link>
      </nav> : null}
    </div>
  )
}

export function ConversationThreadPanel(props: Props) {
  const router = useRouter()
  const mobile = useMobileR2Active()
  const workStatus = useConversationWorkStatus()
  const [drawerOpen, setDrawerOpen] = useState(props.initiallyOpen ?? false)
  const [additionalThreads, setAdditionalThreads] = useState<readonly ConversationThreadSummary[]>([])
  const [threadUpdates, setThreadUpdates] = useState<Readonly<Record<string, ConversationThreadSummary>>>({})
  const [hasMore, setHasMore] = useState(props.hasMore)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(Boolean(props.initialLoadFailed))
  const [initialLoadUnavailable, setInitialLoadUnavailable] = useState(Boolean(props.initialLoadFailed))
  const [error, setError] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const threads = useMemo(() => {
    const byId = new Map(additionalThreads.map((thread) => [thread.id, thread]))
    for (const thread of props.initialThreads) byId.set(thread.id, thread)
    for (const thread of Object.values(threadUpdates)) byId.set(thread.id, thread)
    return [...byId.values()].sort((left, right) =>
      activityTimestamp(right).localeCompare(activityTimestamp(left)),
    )
  }, [additionalThreads, props.initialThreads, threadUpdates])
  const workStatusByThread = useMemo(() => Object.fromEntries(
    (workStatus?.threads ?? []).map((thread) => [thread.threadId, thread.displayStatus]),
  ), [workStatus])

  const lastActiveElementRef = useRef<HTMLElement | null>(null)

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    if (triggerRef.current) {
      triggerRef.current.focus()
    } else if (lastActiveElementRef.current) {
      lastActiveElementRef.current.focus()
    }
  }, [])

  useEffect(() => {
    if (!props.initialLoadFailed) return
    let active = true
    void fetch(`/api/workspaces/${props.workspaceId}/conversations?page=0`, { method: 'GET' })
      .then(async (response) => {
        if (!response.ok) throw new Error('initial_list_failed')
        const payload = await response.json() as {
          data: { items: readonly ConversationThreadSummary[]; hasMore: boolean }
        }
        if (!active) return
        setAdditionalThreads(payload.data.items)
        setHasMore(payload.data.hasMore)
        setPage(0)
        setInitialLoadUnavailable(false)
        setError('')
      })
      .catch(() => {
        if (active) setError('최근 대화를 다시 연결하지 못했어요.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [props.initialLoadFailed, props.workspaceId])

  useEffect(() => {
    if (!drawerOpen) return
    if (document.activeElement && document.activeElement !== document.body) {
      lastActiveElementRef.current = document.activeElement as HTMLElement
    }
    closeRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDrawer()
      if (event.key !== 'Tab') return
      const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeDrawer, drawerOpen])

  const startNewConversation = useCallback(() => {
    setDrawerOpen(false)
    router.push('/app/conversations')
  }, [router])

  async function loadMore() {
    if (loading) return
    setLoading(true)
    setError('')
    const nextPage = initialLoadUnavailable ? 0 : page + 1
    try {
      const response = await fetch(
        `/api/workspaces/${props.workspaceId}/conversations?page=${nextPage}`,
        { method: 'GET' },
      )
      if (!response.ok) throw new Error('list_failed')
      const payload = await response.json() as {
        data: { items: readonly ConversationThreadSummary[]; hasMore: boolean }
      }
      setAdditionalThreads((current) => {
        const byId = new Map(current.map((thread) => [thread.id, thread]))
        for (const thread of payload.data.items) byId.set(thread.id, thread)
        return [...byId.values()]
      })
      setPage(nextPage)
      setHasMore(payload.data.hasMore)
      if (nextPage === 0) setInitialLoadUnavailable(false)
    } catch {
      setError('대화 목록을 불러오지 못했어요.')
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(threadId: string, status: 'active' | 'archived') {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch(
        `/api/workspaces/${props.workspaceId}/conversations/${threadId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      )
      if (!response.ok) throw new Error('update_failed')
      const payload = await response.json() as { data: { thread: ConversationThreadSummary } }
      setThreadUpdates((current) => ({
        ...current,
        [payload.data.thread.id]: payload.data.thread,
      }))
      if (threadId === props.currentThreadId && status === 'archived') router.push('/app/conversations')
      else router.refresh()
    } catch {
      setError(status === 'archived'
        ? '대화를 보관하지 못했어요.'
        : '대화를 복원하지 못했어요.')
    } finally {
      setLoading(false)
    }
  }

  const hasMobileShell = useHasMobileShell()
  const shellTitle = threads.find((t) => t.id === props.currentThreadId)?.title || '소희와의 대화'
  const ITEM = 'flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium active:bg-muted'

  const shellActions = useMemo<HeaderAction[]>(() => {
    if (!mobile || !hasMobileShell) return []
    const actions: HeaderAction[] = [
      {
        id: 'history',
        label: '과거 대화',
        icon: <Clock3 className="size-5" aria-hidden="true" />,
        onPress: () => setDrawerOpen(true),
      },
    ]
    if (props.canManageThreads) {
      actions.push({
        id: 'new',
        label: '새 대화',
        icon: <Plus className="size-5" aria-hidden="true" />,
        onPress: startNewConversation,
      })
    }
    const unreadCount = props.unreadInboxCount ?? 0
    actions.push({
      id: 'more',
      label: '더보기',
      element: (
        <details className="group relative shrink-0">
          <summary aria-label="더보기" className="m-press inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span className="sr-only">더보기</span>
            <Ellipsis className="size-5" aria-hidden="true" />
            {unreadCount > 0 ? <span aria-label={`읽지 않은 문의 ${unreadCount}건`} className="absolute right-2 top-2 size-2 rounded-full bg-destructive ring-2 ring-background" /> : null}
          </summary>
          <div className="absolute right-0 top-12 z-50 w-64 space-y-0.5 rounded-2xl border border-border bg-popover p-1.5 shadow-xl">
            <Link prefetch={false} href="/app/inbox" className={ITEM}>
              <MessagesSquare className="size-5 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1 font-medium">소희 문의답변</span>
              {unreadCount > 0 ? <b className="rounded-full bg-destructive px-2 py-0.5 text-xs text-destructive-foreground">{Math.min(unreadCount, 99)}</b> : null}
            </Link>
            <Link prefetch={false} href="/app/conversations/capabilities" className={ITEM}><BookOpen className="size-5 text-muted-foreground" aria-hidden="true" /><span className="font-medium">소희가 할 수 있는 일</span></Link>
            <Link prefetch={false} href={props.directWorkHref ?? '/app'} className={ITEM}><Monitor className="size-5 text-muted-foreground" aria-hidden="true" /><span className="font-medium">화면에서 직접 하기</span></Link>
            <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">게시·발송은 검토 후 승인해요. 공개 게시와 비용이 드는 작업은 내용을 확인하고 승인해 주세요.</p>
          </div>
        </details>
      ),
    })
    return actions
  }, [mobile, hasMobileShell, props.canManageThreads, props.unreadInboxCount, props.directWorkHref, startNewConversation])

  const shellConfig = useMemo(() => {
    if (!mobile || !hasMobileShell) return null
    return {
      mode: 'CHAT' as const,
      title: shellTitle,
      actions: shellActions,
    }
  }, [mobile, hasMobileShell, shellTitle, shellActions])

  useOptionalShellScreen(shellConfig)

  const listProps = {
    canManageThreads: props.canManageThreads,
    currentThreadId: props.currentThreadId,
    error,
    hasMore,
    initialLoadUnavailable,
    loading,
    onArchive: (threadId: string) => updateStatus(threadId, 'archived'),
    onCreate: startNewConversation,
    onLoadMore: loadMore,
    onRestore: (threadId: string) => updateStatus(threadId, 'active'),
    threads,
    unreadInboxCount: props.unreadInboxCount ?? 0,
    workStatusByThread,
  } as const

  if (props.variant === 'sidebar') {
    return <ThreadList {...listProps} variant="sidebar" />
  }

  return (
    <>
      {mobile && hasMobileShell ? null : mobile ? (
        <ConversationMobileBar
          title={shellTitle}
          unreadInboxCount={props.unreadInboxCount ?? 0}
          canCreate={Boolean(props.canManageThreads)}
          directWorkHref={props.directWorkHref ?? '/app'}
          historyTriggerRef={triggerRef}
          onNew={startNewConversation}
          onOpenHistory={() => setDrawerOpen(true)}
        />
      ) : (
      <nav aria-label="대화 도구" className={styles.conversationTools}>
        {props.canManageThreads ? (
          <button onClick={startNewConversation} type="button"><Plus aria-hidden="true" />새 대화</button>
        ) : null}
        <button
          aria-expanded={drawerOpen}
          aria-haspopup="dialog"
          onClick={() => setDrawerOpen(true)}
          ref={triggerRef}
          type="button"
        ><Clock3 aria-hidden="true" />과거 대화</button>
        <Link aria-label={`소희 문의답변 ${props.unreadInboxCount ?? 0}`} href="/app/inbox">
          <MessagesSquare aria-hidden="true" />소희 문의답변
          {(props.unreadInboxCount ?? 0) > 0 ? <b>{Math.min(props.unreadInboxCount ?? 0, 99)}</b> : null}
        </Link>
      </nav>
      )}
      {drawerOpen ? (
        <div className={styles.threadDrawerBackdrop} data-mobile={mobile ? 'true' : 'false'}>
          <section
            aria-label="과거 대화"
            aria-modal="true"
            className={styles.threadDrawer}
            data-mobile={mobile ? 'true' : 'false'}
            ref={drawerRef}
            role="dialog"
          >
            <div className={styles.threadDrawerHeader}>
              <div className={styles.threadDrawerTitleGroup}>
                <h2 className={styles.threadDrawerTitle}>과거 대화</h2>
                <p className={styles.threadDrawerSubtitle}>메시지와 저장된 결과물을 다시 열 수 있어요.</p>
              </div>
              <div className={styles.threadDrawerActions}>
                {props.canManageThreads ? (
                  <button
                    aria-label="새 대화 시작"
                    className={styles.threadDrawerNewChatBtn}
                    disabled={loading}
                    onClick={startNewConversation}
                    type="button"
                  >
                    <Plus aria-hidden="true" />
                    <span>새 대화</span>
                  </button>
                ) : null}
                <button
                  aria-label="과거 대화 닫기"
                  className={styles.closeThreadDrawer}
                  onClick={closeDrawer}
                  ref={closeRef}
                  type="button"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className={styles.threadScroller}>
              <ThreadList {...listProps} hideHeader={true} />
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
