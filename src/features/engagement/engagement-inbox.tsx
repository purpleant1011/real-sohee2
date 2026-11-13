'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, Info, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MasterDetail } from '@/components/layout/master-detail'
import { StateView } from '@/components/mobile-ui'
import { cn } from '@/lib/utils'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import { EngagementCommentCard } from './engagement-comment-card'
import { EngagementSendDialog } from './engagement-send-dialog'
import { EngagementAutoReplyPanel } from './engagement-auto-reply-panel'
import { EngagementDmView } from './engagement-dm-view'
import type { EngagementCommentItem, EngagementCommentsResponse, EngagementPolicy } from './types'

export type TabKey = 'needs_reply' | 'needs_check' | 'sent' | 'dismissed'

interface TabDefinition {
  id: TabKey
  label: string
  emptyMessage: string
  filter: (comment: EngagementCommentItem) => boolean
}

const TABS: readonly TabDefinition[] = [
  {
    id: 'needs_reply',
    label: '답글 필요',
    emptyMessage: '아직 답글이 필요한 댓글이 없어요',
    filter: (c) =>
      c.status === 'RECEIVED' ||
      c.status === 'CLASSIFIED' ||
      c.status === 'DRAFTED' ||
      c.status === 'APPROVED',
  },
  {
    id: 'needs_check',
    label: '확인 필요',
    emptyMessage: '확인이 필요한 댓글이 없어요',
    filter: (c) => c.status === 'NEEDS_CHECK' || c.status === 'FAILED',
  },
  {
    id: 'sent',
    label: '완료',
    emptyMessage: '완료된 답글이 아직 없어요',
    filter: (c) => c.status === 'SENT',
  },
  {
    id: 'dismissed',
    label: '무시함',
    emptyMessage: '무시한 댓글이 없어요',
    filter: (c) => c.status === 'DISMISSED',
  },
]

function resolveInitialTab(param: string | null): TabKey {
  if (param === 'needs_check' || param === '확인 필요') return 'needs_check'
  if (param === 'sent' || param === '완료') return 'sent'
  if (param === 'dismissed' || param === '무시함') return 'dismissed'
  return 'needs_reply'
}

export interface EngagementInboxProps {
  workspaceId: string
  initialData?: EngagementCommentsResponse | null
  initialPolicies?: {
    instagram?: EngagementPolicy | null
    threads?: EngagementPolicy | null
  }
}

export function EngagementInbox({
  workspaceId,
  initialData = null,
  initialPolicies,
}: Readonly<EngagementInboxProps>) {
  const searchParams = useSearchParams()

  const [activeTab, setActiveTab] = useState<TabKey>(() =>
    resolveInitialTab(searchParams ? searchParams.get('tab') : null)
  )

  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(() =>
    searchParams ? searchParams.get('item') : null
  )

  const [inboxMode, setInboxMode] = useState<'comments' | 'messages'>(() => {
    const modeParam = searchParams ? searchParams.get('mode') : null
    return modeParam === 'messages' || modeParam === 'dm' ? 'messages' : 'comments'
  })

  const [comments, setComments] = useState<EngagementCommentItem[]>(
    initialData?.items ?? []
  )
  const [sendEnabled, setSendEnabled] = useState<boolean>(
    initialData?.send_enabled ?? false
  )
  const [cycleEnabled, setCycleEnabled] = useState<boolean>(
    initialData?.cycle_enabled ?? false
  )
  const [dmRefreshToken, setDmRefreshToken] = useState<number>(0)

  const [isLoading, setIsLoading] = useState<boolean>(!initialData)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Global inline live notification
  const [liveNotification, setLiveNotification] = useState<string | null>(null)

  // Send Dialog State
  const [dialogOpen, setDialogOpen] = useState<boolean>(false)
  // 외부 전송 가드(ANI-1778)
  const runExternalWrite = useExternalWriteGuard()
  const [targetComment, setTargetComment] = useState<EngagementCommentItem | null>(null)
  const [targetReplyText, setTargetReplyText] = useState<string>('')

  // Tab button refs for keyboard arrow navigation
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const fetchComments = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/engagement/comments?limit=100`,
        { cache: 'no-store' }
      )
      if (!res.ok) {
        throw new Error('댓글 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
      }
      const data: EngagementCommentsResponse = await res.json()
      setComments(data.items ?? [])
      setSendEnabled(Boolean(data.send_enabled))
      setCycleEnabled(Boolean(data.cycle_enabled))
    } catch (err: any) {
      setLoadError(err?.message || '댓글 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  const handleRefresh = useCallback(() => {
    if (inboxMode === 'messages') {
      setDmRefreshToken((prev) => prev + 1)
    } else {
      void fetchComments()
    }
  }, [inboxMode, fetchComments])

  useEffect(() => {
    if (!initialData) {
      fetchComments()
    }
  }, [fetchComments, initialData])

  function selectTab(tabKey: TabKey) {
    setActiveTab(tabKey)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('tab', tabKey)
      window.history.replaceState(null, '', url.toString())
    }
  }

  function selectComment(commentId: string | null) {
    setSelectedCommentId(commentId)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (commentId) {
        url.searchParams.set('item', commentId)
      } else {
        url.searchParams.delete('item')
      }
      window.history.replaceState(null, '', url.toString())
    }
  }

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      nextIndex = (index + 1) % TABS.length
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      nextIndex = (index - 1 + TABS.length) % TABS.length
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      nextIndex = (index + 2 < TABS.length) ? index + 2 : (index + 1) % TABS.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      nextIndex = (index - 2 >= 0) ? index - 2 : (index - 1 + TABS.length) % TABS.length
    } else if (e.key === 'Home') {
      e.preventDefault()
      nextIndex = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      nextIndex = TABS.length - 1
    }

    if (nextIndex !== index) {
      const nextTab = TABS[nextIndex]
      if (nextTab) {
        selectTab(nextTab.id)
        tabRefs.current[nextIndex]?.focus()
      }
    }
  }

  // Action: Regenerate Draft
  async function handleRegenerateDraft(commentId: string) {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/engagement/comments/${commentId}/draft`,
      { method: 'POST', cache: 'no-store' }
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || '답글 초안을 다시 생성하지 못했습니다.')
    }
    const data = await res.json()
    // Update local state
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? {
              ...c,
              status: 'DRAFTED',
              status_label: '초안 준비됨',
              draft: data.draft ?? c.draft,
            }
          : c
      )
    )
  }

  // Action: Dismiss Comment
  async function handleDismiss(commentId: string) {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/engagement/comments/${commentId}/dismiss`,
      { method: 'POST', cache: 'no-store' }
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || '댓글을 무시 처리하지 못했습니다.')
    }
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? {
              ...c,
              status: 'DISMISSED',
              status_label: '무시함',
            }
          : c
      )
    )
  }

  // Action: Update Draft Text locally
  async function handleUpdateDraft(commentId: string, text: string) {
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? {
              ...c,
              draft: c.draft
                ? { ...c.draft, draft_text: text }
                : {
                    id: '',
                    workspace_id: workspaceId,
                    comment_id: commentId,
                    draft_text: text,
                    approved_fingerprint: null,
                    approved_by: null,
                    approved_at: null,
                    is_auto_approved: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  },
            }
          : c
      )
    )
  }

  // Open Send Dialog
  function openSendDialog(comment: EngagementCommentItem, replyText: string) {
    setTargetComment(comment)
    setTargetReplyText(replyText)
    setDialogOpen(true)
  }

  // Confirm Send Action — 오프라인 fail-closed + 중복 실행 차단(ANI-1778).
  async function handleConfirmSend() {
    if (!targetComment) return
    const outcome = await runExternalWrite('send', `comment:${targetComment.id}`, performSend)
    if (!outcome.ran) setLiveNotification(outcome.decision.message)
  }

  async function performSend() {
    if (!targetComment) return
    const commentId = targetComment.id
    const channelLabel = targetComment.channel_label

    // The server sends its stored draft: the text shown in the dialog must be saved first, or nothing is sent.
    const saved = await fetch(
      `/api/workspaces/${workspaceId}/engagement/comments/${commentId}/draft`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftText: targetReplyText }),
      }
    ).catch(() => null)
    if (!saved || !saved.ok) {
      setLiveNotification('답글 내용을 저장하지 못해 보내지 않았어요. 잠시 후 다시 시도해 주세요.')
      setDialogOpen(false)
      return
    }

    const savedJson = await saved.json().catch(() => null)
    const expectedFingerprint = savedJson?.draft?.fingerprint
    if (!expectedFingerprint) {
      setLiveNotification('저장한 답글의 최종 버전을 확인하지 못해 보내지 않았어요.')
      setDialogOpen(false)
      return
    }
    const res = await fetch(
      `/api/workspaces/${workspaceId}/engagement/comments/${commentId}/send`,
      { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedFingerprint }) }
    )

    const json = await res.json().catch(() => ({}))

    if (!res.ok || !json.ok) {
      if (json.status === 'NEEDS_CHECK' || json.status === 'FAILED') {
        // Moves to 확인 필요
        setComments((prev) =>
          prev.map((c) =>
            c.id === commentId
              ? {
                  ...c,
                  status: 'NEEDS_CHECK',
                  status_label: '확인 필요',
                  draft: c.draft ? { ...c.draft, draft_text: targetReplyText } : null,
                }
              : c
          )
        )
        setLiveNotification(
          `답글이 올라갔는지 확인해 주세요. ${channelLabel} 앱에서 확인한 뒤에 다시 보내지 말아 주세요.`
        )
      } else {
        setLiveNotification('답글을 보내지 못했어요. 잠시 후 다시 시도해 주세요.')
      }
      setDialogOpen(false)
      return
    }

    // Success!
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? {
              ...c,
              status: 'SENT',
              status_label: '답글 완료',
              draft: c.draft ? { ...c.draft, draft_text: targetReplyText } : null,
            }
          : c
      )
    )
    setLiveNotification('답글을 올렸어요')
    setDialogOpen(false)
  }

  // Counts per tab (counts as text)
  const tabCounts: Record<TabKey, number> = {
    needs_reply: comments.filter(TABS[0].filter).length,
    needs_check: comments.filter(TABS[1].filter).length,
    sent: comments.filter(TABS[2].filter).length,
    dismissed: comments.filter(TABS[3].filter).length,
  }

  const [channelFilter, setChannelFilter] = useState<'all' | 'instagram' | 'threads'>('all')

  const currentTabDef = TABS.find((t) => t.id === activeTab) ?? TABS[0]
  const tabComments = comments.filter(currentTabDef.filter)
  const filteredComments = tabComments.filter((c) => {
    if (channelFilter === 'all') return true
    return c.channel === channelFilter
  })

  return (
    <main
      aria-label="소통함"
      className="mx-auto w-full max-w-6xl min-w-0 px-4 sm:px-6 py-6 sm:py-8 space-y-6"
    >
      {/* 1. Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            소통함
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            고객 댓글을 확인하고 맞춤 답글 초안을 승인해요.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Segmented control for communication mode */}
          <div
            className="inline-flex p-1 rounded-xl bg-muted/60 border border-border/60 text-xs font-bold gap-1"
            role="group"
            aria-label="소통 유형 선택"
          >
            <button
              type="button"
              aria-pressed={inboxMode === 'comments'}
              onClick={() => setInboxMode('comments')}
              className={`px-3.5 py-1.5 rounded-lg min-h-11 transition-all cursor-pointer ${
                inboxMode === 'comments'
                  ? 'bg-background text-foreground shadow-xs cursor-default font-bold'
                  : 'text-muted-foreground hover:text-foreground font-semibold'
              }`}
            >
              댓글
            </button>
            <button
              type="button"
              aria-pressed={inboxMode === 'messages'}
              onClick={() => setInboxMode('messages')}
              className={`px-3.5 py-1.5 rounded-lg min-h-11 transition-all cursor-pointer ${
                inboxMode === 'messages'
                  ? 'bg-background text-foreground shadow-xs cursor-default font-bold'
                  : 'text-muted-foreground hover:text-foreground font-semibold'
              }`}
            >
              메시지
            </button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
            className="min-h-11 px-3 text-xs font-semibold gap-1.5 shrink-0"
          >
            <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
            <span>새로고침</span>
          </Button>
        </div>
      </header>

      {inboxMode === 'messages' ? (
        <EngagementDmView workspaceId={workspaceId} refreshToken={dmRefreshToken} />
      ) : (
        <>
          {/* 2. Honest status banner (role="status") */}
          {!isLoading && !loadError && !cycleEnabled ? (
            <aside
              aria-label="댓글 수집 상태 안내"
              className="rounded-xl border border-border/80 bg-muted/60 p-3.5 sm:p-4 text-xs sm:text-sm text-muted-foreground flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
              role="status"
            >
              <div className="flex items-center gap-2.5">
                <Info aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span>댓글 가져오기가 아직 꺼져 있어요. 설정에서 소통 채널 연결을 확인할 수 있어요.</span>
              </div>
              <Button asChild size="sm" variant="outline" className="h-8 text-xs font-semibold shrink-0 self-start sm:self-auto">
                <Link href="/app/system">
                  연결 설정 바로가기
                </Link>
              </Button>
            </aside>
          ) : !isLoading && !loadError && !sendEnabled ? (
            <aside
              aria-label="답글 발송 상태 안내"
              className="rounded-xl border border-border/80 bg-muted/60 p-3.5 sm:p-4 text-xs sm:text-sm text-muted-foreground flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
              role="status"
            >
              <div className="flex items-center gap-2.5">
                <Info aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span>답글 보내기가 아직 꺼져 있어요. 초안은 미리 확인할 수 있어요.</span>
              </div>
              <Button asChild size="sm" variant="outline" className="h-8 text-xs font-semibold shrink-0 self-start sm:self-auto">
                <Link href="/app/system">
                  연결 설정 바로가기
                </Link>
              </Button>
            </aside>
          ) : null}

      {/* Global polite notification message */}
      {liveNotification ? (
        <div
          aria-live="polite"
          className="rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm font-semibold text-primary"
        >
          {liveNotification}
        </div>
      ) : null}

      {/* 3. Filter tabs (role="tablist", arrow-key navigation, counts as text) */}
      <div className="space-y-4">
        <div
          aria-label="댓글 필터"
          className="grid grid-cols-2 min-[480px]:grid-cols-4 border-b border-border gap-1 sm:gap-2 pb-px"
          role="tablist"
        >
          {TABS.map((tab, idx) => {
            const isSelected = activeTab === tab.id
            const count = tabCounts[tab.id]
            return (
              <button
                key={tab.id}
                aria-controls={`tabpanel-${tab.id}`}
                aria-selected={isSelected}
                className={`flex items-center justify-between min-[480px]:justify-center gap-2 px-3.5 py-2.5 text-xs sm:text-sm font-bold border-b-2 whitespace-nowrap min-h-[44px] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isSelected
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
                }`}
                id={`tab-${tab.id}`}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                ref={(el) => {
                  tabRefs.current[idx] = el
                }}
                role="tab"
                tabIndex={isSelected ? 0 : -1}
                type="button"
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    isSelected
                      ? 'bg-primary/15 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Channel Filter Chips */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/60 text-xs font-bold border border-border/40">
            {[
              { id: 'all', label: '전체 채널' },
              { id: 'instagram', label: '📷 인스타그램' },
              { id: 'threads', label: '🧵 스레드' },
            ].map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setChannelFilter(ch.id as any)}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  channelFilter === ch.id
                    ? 'bg-card text-foreground shadow-2xs font-extrabold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {ch.label}
              </button>
            ))}
          </div>
        </div>

        {/* 8. MasterDetail 2단 분할 뷰 */}
        {(() => {
          const selectedComment = filteredComments.find((c) => c.id === selectedCommentId) ?? null

          const listContent = (
            <section
              aria-labelledby={`tab-${activeTab}`}
              id={`tabpanel-${activeTab}`}
              role="tabpanel"
              tabIndex={0}
              className="space-y-3"
            >
              {isLoading ? (
                <div aria-label="댓글 목록 불러오는 중" className="space-y-3 py-2">
                  <Skeleton className="h-20 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                </div>
              ) : loadError ? (
                <StateView
                  kind="error"
                  title="댓글을 불러오지 못했어요"
                  description={loadError}
                  action={
                    <Button variant="outline" size="sm" onClick={fetchComments} className="min-h-11">
                      <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
                      다시 불러오기
                    </Button>
                  }
                />
              ) : filteredComments.length === 0 ? (
                <StateView
                  kind="confirmed_empty"
                  title={currentTabDef.emptyMessage}
                  action={
                    <Button variant="outline" size="sm" onClick={fetchComments} className="min-h-11">
                      <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
                      다시 확인하기
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-2.5" role="list">
                  {filteredComments.map((comment) => {
                    const isSelected = comment.id === selectedCommentId
                    return (
                      <li key={comment.id}>
                        <button
                          type="button"
                          data-testid={`comment-card-${comment.id}`}
                          onClick={() => selectComment(comment.id)}
                          aria-current={isSelected ? 'true' : undefined}
                          className={cn(
                            'flex w-full flex-col gap-1.5 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring cursor-pointer',
                            isSelected
                              ? 'border-primary bg-primary/5 shadow-xs'
                              : 'border-border bg-card hover:border-primary/40'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-foreground">
                              @{comment.author_handle}
                            </span>
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                              {comment.status_label}
                            </span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {comment.comment_text}
                          </p>
                          <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-muted-foreground">
                            <span>{comment.channel_label}</span>
                            <span>{comment.draft ? '소희 답안 준비됨' : '초안 대기'}</span>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )

          const detailContent = selectedComment ? (
            <div className="space-y-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => selectComment(null)}
                className="lg:hidden -ml-2 mb-1 text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1.5 min-h-11 cursor-pointer"
              >
                <ChevronLeft className="size-4" />
                <span>댓글 목록으로</span>
              </Button>
              <EngagementCommentCard
                key={selectedComment.id}
                comment={selectedComment}
                onDismiss={handleDismiss}
                onOpenSendDialog={openSendDialog}
                onRegenerateDraft={handleRegenerateDraft}
                onUpdateDraft={handleUpdateDraft}
                sendEnabled={sendEnabled}
              />
            </div>
          ) : null

          return (
            <MasterDetail
              listLabel="댓글 목록"
              detailLabel="댓글 답글 검토"
              list={listContent}
              detail={detailContent}
              emptyDetail={<p className="text-sm text-muted-foreground">왼쪽에서 하나를 골라 보세요.</p>}
              hasSelection={Boolean(selectedComment)}
            />
          )
        })()}
      </div>

      {/* 4. 자동 답글 규칙 설정 (데이터/설정 확인 완료 시 접힌 상태로만 제공) */}
      {!isLoading && !loadError && cycleEnabled && !(initialPolicies && !initialPolicies.instagram && !initialPolicies.threads) ? (
        <div className="pt-2">
          <EngagementAutoReplyPanel
            initialPolicies={initialPolicies}
            workspaceId={workspaceId}
          />
        </div>
      ) : null}

      {/* 5. Send Confirmation Dialog */}
      {targetComment ? (
        <EngagementSendDialog
          channelLabel={targetComment.channel_label}
          accountLabel={targetComment.account_label}
          onConfirm={handleConfirmSend}
          onOpenChange={setDialogOpen}
          open={dialogOpen}
          replyText={targetReplyText}
        />
      ) : null}
        </>
      )}
    </main>
  )
}
