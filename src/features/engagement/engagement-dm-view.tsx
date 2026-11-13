'use client'

import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, Info, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MasterDetail } from '@/components/layout/master-detail'
import { StateView } from '@/components/mobile-ui'
import { cn } from '@/lib/utils'
import { useExternalWriteGuard } from '@/features/pwa/use-external-write-guard'
import { RecoveryCard } from '@/features/booking-recovery/components/recovery-card'
import type { RecoveryView } from '@/features/booking-recovery/contracts'
import { EngagementDmThreadCard } from './engagement-dm-thread-card'
import { EngagementDmSendDialog } from './engagement-dm-send-dialog'
import type {
  InstagramDmThreadItem,
  InstagramDmThreadsResponse,
} from './dm/types'

export type DmTabKey = 'needs_reply' | 'needs_check' | 'sent' | 'expired'

interface DmTabDefinition {
  id: DmTabKey
  label: string
  emptyMessage: string
  filter: (thread: InstagramDmThreadItem) => boolean
}

const DM_TABS: readonly DmTabDefinition[] = [
  {
    id: 'needs_reply',
    label: '답장 필요',
    emptyMessage: '답장이 필요한 메시지가 없어요',
    filter: (t) => t.status === 'NEEDS_REPLY' && !t.is_expired,
  },
  {
    id: 'needs_check',
    label: '확인 필요',
    emptyMessage: '확인이 필요한 메시지가 없어요',
    filter: (t) => t.status === 'NEEDS_CHECK',
  },
  {
    id: 'sent',
    label: '완료',
    emptyMessage: '완료된 메시지가 아직 없어요',
    filter: (t) => t.status === 'SENT',
  },
  {
    id: 'expired',
    label: '만료됨',
    emptyMessage: '만료된 메시지가 없어요',
    filter: (t) => t.status === 'EXPIRED' || t.is_expired,
  },
]

export interface EngagementDmViewProps {
  workspaceId: string
  initialData?: InstagramDmThreadsResponse | null
  refreshToken?: number
}

export function EngagementDmView({
  workspaceId,
  initialData = null,
  refreshToken = 0,
}: Readonly<EngagementDmViewProps>) {
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<DmTabKey>('needs_reply')
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(() =>
    searchParams ? searchParams.get('item') : null
  )

  function selectThread(threadId: string | null) {
    setSelectedThreadId(threadId)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (threadId) {
        url.searchParams.set('item', threadId)
      } else {
        url.searchParams.delete('item')
      }
      window.history.replaceState(null, '', url.toString())
    }
  }

  const [threads, setThreads] = useState<InstagramDmThreadItem[]>(
    initialData?.items ?? []
  )
  const [sendEnabled, setSendEnabled] = useState<boolean>(
    initialData?.send_enabled ?? false
  )
  const [isLoading, setIsLoading] = useState<boolean>(!initialData)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [liveNotification, setLiveNotification] = useState<string | null>(null)
  const [recoveryCases, setRecoveryCases] = useState<RecoveryView[]>([])

  // Send dialog state
  const [dialogOpen, setDialogOpen] = useState<boolean>(false)
  const [targetThread, setTargetThread] = useState<InstagramDmThreadItem | null>(null)
  const [targetReplyText, setTargetReplyText] = useState<string>('')
  // 외부 전송 가드(ANI-1778). 오프라인이면 서버를 부르지 않고, 중복 클릭은 한 번만 실행한다.
  const runExternalWrite = useExternalWriteGuard()

  const fetchThreads = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/engagement/dm/threads`,
        { cache: 'no-store' }
      )
      if (!res.ok) {
        throw new Error('메시지 목록을 불러오지 못했어요.')
      }
      const data: InstagramDmThreadsResponse = await res.json()
      setThreads(data.items || [])
      setSendEnabled(Boolean(data.send_enabled))

      // 회수 케이스 조회 (Task 10)
      void fetch(`/api/workspaces/${workspaceId}/booking-recovery/cases`)
        .then((r) => (r.ok ? r.json() : null))
        .then((cData) => {
          if (Array.isArray(cData?.cases)) {
            setRecoveryCases(cData.cases)
          }
        })
        .catch(() => {})
    } catch (err: any) {
      setLoadError(err?.message || '메시지 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!initialData) {
      void fetchThreads()
    }
  }, [initialData, fetchThreads])

  useEffect(() => {
    if (refreshToken > 0) {
      void fetchThreads()
    }
  }, [refreshToken, fetchThreads])

  // Open Send Dialog
  function openSendDialog(thread: InstagramDmThreadItem, replyText: string) {
    setTargetThread(thread)
    setTargetReplyText(replyText)
    setDialogOpen(true)
  }

  // Handle select option
  async function handleSelectOption(threadId: string, optionId: string) {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/engagement/dm/threads/${threadId}/draft`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionId }),
      }
    )
    if (!res.ok) return
    const json = await res.json().catch(() => ({}))
    if (json.draft) {
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, draft: json.draft } : t))
      )
    }
  }

  // Handle regenerate draft
  async function handleRegenerateDraft(threadId: string) {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/engagement/dm/threads/${threadId}/draft`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    )
    if (!res.ok) {
      throw new Error('답장 초안을 다시 생성하지 못했어요.')
    }
    const json = await res.json().catch(() => ({}))
    if (json.draft) {
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, draft: json.draft } : t))
      )
      setLiveNotification('추천 안내 방향을 다시 생성했어요.')
    }
  }

  // Handle dismiss
  async function handleDismiss(threadId: string) {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/engagement/dm/threads/${threadId}/dismiss`,
      { method: 'POST', cache: 'no-store' }
    )
    if (!res.ok) {
      throw new Error('대화를 숨기지 못했어요.')
    }
    setThreads((prev) => prev.filter((t) => t.id !== threadId))
    setLiveNotification('대화를 목록에서 숨겼어요.')
  }

  // Handle update draft text
  async function handleUpdateDraft(threadId: string, text: string) {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? {
              ...t,
              draft: t.draft
                ? {
                    ...t.draft,
                    draft_text: text,
                    approved_fingerprint: null,
                  }
                : null,
            }
          : t
      )
    )
  }

  // Confirm Send Action — 오프라인 fail-closed + 중복 실행 차단(ANI-1778).
  async function handleConfirmSend() {
    if (!targetThread) return
    const outcome = await runExternalWrite('send', targetThread.id, performSend)
    if (!outcome.ran) setLiveNotification(outcome.decision.message)
  }

  async function performSend() {
    if (!targetThread) return
    const threadId = targetThread.id
    const expectedSourceMessageId = targetThread.messages?.filter(message => message.sender_type === 'customer').at(-1)?.id
    if (!expectedSourceMessageId) {
      setLiveNotification('최신 고객 대화를 확인하지 못해 보내지 않았어요. 대화를 다시 열어 주세요.')
      setDialogOpen(false)
      return
    }

    // 1. Save current text to draft first
    const saved = await fetch(
      `/api/workspaces/${workspaceId}/engagement/dm/threads/${threadId}/draft`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftText: targetReplyText }),
      }
    ).catch(() => null)

    if (!saved || !saved.ok) {
      setLiveNotification('답장 내용을 저장하지 못해 보내지 않았어요. 잠시 후 다시 시도해 주세요.')
      setDialogOpen(false)
      return
    }

    const savedJson = await saved.json().catch(() => null)
    const expectedFingerprint = savedJson?.draft?.approved_fingerprint || savedJson?.draft?.fingerprint

    // 2. Perform send
    const res = await fetch(
      `/api/workspaces/${workspaceId}/engagement/dm/threads/${threadId}/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedFingerprint, expectedSourceMessageId }),
        cache: 'no-store',
      }
    )

    const json = await res.json().catch(() => ({}))

    if (!res.ok || !json.ok) {
      if (json.status === 'NEEDS_CHECK') {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  status: 'NEEDS_CHECK',
                  status_label: '확인 필요',
                  draft: t.draft ? { ...t.draft, draft_text: targetReplyText } : null,
                }
              : t
          )
        )
        setLiveNotification('답장이 보내졌는지 확인해 주세요. Instagram 앱에서 확인해 주세요.')
      } else if (json.status === 'EXPIRED') {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  status: 'EXPIRED',
                  status_label: '만료됨',
                  is_expired: true,
                }
              : t
          )
        )
        setLiveNotification('고객이 메시지를 보낸 지 24시간이 지나 답장을 보낼 수 없어요. Instagram 앱에서 직접 확인해 주세요.')
      } else {
        setLiveNotification(json.error || '메시지를 보내지 못했어요. 잠시 후 다시 시도해 주세요.')
      }
      setDialogOpen(false)
      return
    }

    // Success!
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? {
              ...t,
              status: 'SENT',
              status_label: '완료',
              draft: t.draft ? { ...t.draft, draft_text: targetReplyText } : null,
            }
          : t
      )
    )
    setLiveNotification('메시지를 성공적으로 보냈어요.')
    setDialogOpen(false)
  }

  // Keyboard navigation for tabs
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      const nextIndex = (index + 1) % DM_TABS.length
      setActiveTab(DM_TABS[nextIndex].id)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const prevIndex = (index - 1 + DM_TABS.length) % DM_TABS.length
      setActiveTab(DM_TABS[prevIndex].id)
    }
  }

  const tabCounts: Record<DmTabKey, number> = {
    needs_reply: threads.filter(DM_TABS[0].filter).length,
    needs_check: threads.filter(DM_TABS[1].filter).length,
    sent: threads.filter(DM_TABS[2].filter).length,
    expired: threads.filter(DM_TABS[3].filter).length,
  }

  const currentTabDef = DM_TABS.find((t) => t.id === activeTab) ?? DM_TABS[0]
  const filteredThreads = threads.filter(currentTabDef.filter)

  return (
    <div className="space-y-6">
      {/* 1. Status notice: 로딩/오류 중에는 발송 꺼짐을 확정 표시하지 않음 */}
      {!isLoading && !loadError && !sendEnabled ? (
        <aside
          aria-label="메시지 발송 상태 안내"
          className="rounded-xl border border-border/80 bg-muted/60 p-4 text-xs sm:text-sm text-muted-foreground flex items-center gap-3 shadow-2xs"
          role="status"
        >
          <Info aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span>메시지 직접 보내기가 아직 꺼져 있어요. 추천 문안은 미리 확인하실 수 있어요.</span>
        </aside>
      ) : null}

      {/* Global polite notification banner */}
      {liveNotification ? (
        <div
          aria-live="polite"
          className="rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm font-semibold text-primary"
        >
          {liveNotification}
        </div>
      ) : null}

      {/* 예약 문의 회수 진행 중인 카드 섹션 (Task 10) */}
      {recoveryCases.length > 0 && (
        <section aria-label="예약 문의 회수 현황" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">💌 예약 전환 회수 진행 중인 문의 ({recoveryCases.length}건)</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recoveryCases.map((rc) => (
              <RecoveryCard
                key={rc.caseId}
                view={rc}
                onCommand={async (cmd) => {
                  // 회수 명령 중 외부로 나가는 두 가지(답변 전송 승인·예약 확정 승인)만 가드한다.
                  // 준비·거절·재확인은 바깥에 아무것도 쓰지 않으므로 그대로 보낸다(ANI-1778).
                  const kind =
                    cmd.kind === 'approve_send'
                      ? ('send' as const)
                      : cmd.kind === 'approve_booking'
                        ? ('reservation' as const)
                        : null
                  const submit = async () => {
                    const res = await fetch(
                      `/api/workspaces/${encodeURIComponent(workspaceId)}/booking-recovery/cases/${encodeURIComponent(rc.caseId)}/commands`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(cmd),
                      }
                    )
                    const json = await res.json().catch(() => ({}))
                    if (!res.ok) {
                      throw new Error(json.error || json.message || '명령 처리에 실패했습니다.')
                    }
                    if (json.view) {
                      setRecoveryCases((prev) =>
                        prev.map((c) => (c.caseId === rc.caseId ? json.view : c))
                      )
                    }
                  }
                  if (!kind) return submit()
                  const outcome = await runExternalWrite(kind, `recovery:${rc.caseId}`, submit)
                  // 카드가 이 예외를 설정 메시지로 표시한다 — 막힌 이유를 삼키지 않는다.
                  if (!outcome.ran) throw new Error(outcome.decision.message)
                  return outcome.value
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* 2. Filter tabs */}
      <div className="space-y-4">
        <div
          aria-label="메시지 필터"
          className="grid grid-cols-2 min-[480px]:grid-cols-4 border-b border-border gap-1 sm:gap-2 pb-px"
          role="tablist"
        >
          {DM_TABS.map((tab, idx) => {
            const isSelected = activeTab === tab.id
            const count = tabCounts[tab.id]
            return (
              <button
                key={tab.id}
                aria-controls={`dm-tabpanel-${tab.id}`}
                aria-selected={isSelected}
                className={`flex items-center justify-between min-[480px]:justify-center gap-2 px-3.5 py-2.5 text-xs sm:text-sm font-bold border-b-2 whitespace-nowrap min-h-[44px] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isSelected
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                id={`dm-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                role="tab"
                tabIndex={isSelected ? 0 : -1}
                type="button"
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[11px] px-1.5 py-0.5 rounded-full ${
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

        {/* 3. MasterDetail 2단 분할 뷰 */}
        {(() => {
          const selectedThread = filteredThreads.find((t) => t.id === selectedThreadId) ?? null

          const listContent = (
            <div
              aria-labelledby={`dm-tab-${activeTab}`}
              id={`dm-tabpanel-${activeTab}`}
              role="tabpanel"
              tabIndex={0}
              className="space-y-3 pt-1"
            >
              {isLoading ? (
                <div className="space-y-3" aria-label="메시지 목록 불러오는 중">
                  <Skeleton className="h-20 w-full rounded-xl" />
                  <Skeleton className="h-20 w-full rounded-xl" />
                </div>
              ) : loadError ? (
                <StateView
                  kind="error"
                  title="메시지를 불러오지 못했어요"
                  description={loadError}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void fetchThreads()}
                      className="min-h-11"
                    >
                      <RefreshCw aria-hidden="true" className="mr-1.5 size-3.5" />
                      다시 시도
                    </Button>
                  }
                />
              ) : filteredThreads.length === 0 ? (
                <StateView
                  kind="confirmed_empty"
                  title={currentTabDef.emptyMessage}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void fetchThreads()}
                      className="min-h-11"
                    >
                      <RefreshCw aria-hidden="true" className="mr-1.5 size-3.5" />
                      다시 확인하기
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-2.5" role="list">
                  {filteredThreads.map((thread) => {
                    const isSelected = thread.id === selectedThreadId
                    const senderName = thread.customer_handle
                      ? `@${thread.customer_handle}`
                      : (thread.customer_name || '고객')
                    return (
                      <li key={thread.id}>
                        <button
                          type="button"
                          onClick={() => selectThread(thread.id)}
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
                              {senderName}
                            </span>
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                              {thread.status_label}
                            </span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {thread.last_message_text || '메시지 내용 없음'}
                          </p>
                          <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-muted-foreground">
                            <span>Instagram DM</span>
                            <span>{thread.draft?.draft_text ? '소희 답변 준비됨' : '답변 대기'}</span>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )

          const detailContent = selectedThread ? (
            <div className="space-y-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => selectThread(null)}
                className="lg:hidden -ml-2 mb-1 text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1.5 min-h-11 cursor-pointer"
              >
                <ChevronLeft className="size-4" />
                <span>메시지 목록으로</span>
              </Button>
              <EngagementDmThreadCard
                key={selectedThread.id}
                thread={selectedThread}
                sendEnabled={sendEnabled}
                onOpenSendDialog={openSendDialog}
                onSelectOption={handleSelectOption}
                onRegenerateDraft={handleRegenerateDraft}
                onDismiss={handleDismiss}
                onUpdateDraft={handleUpdateDraft}
              />
            </div>
          ) : null

          return (
            <MasterDetail
              listLabel="메시지 목록"
              detailLabel="메시지 답장 검토"
              list={listContent}
              detail={detailContent}
              emptyDetail={<p className="text-sm text-muted-foreground">왼쪽에서 하나를 골라 보세요.</p>}
              hasSelection={Boolean(selectedThread)}
            />
          )
        })()}
      </div>

      {/* 4. DM Send Dialog (Zero Auto-Send: 100% Owner Approval Modal) */}
      <EngagementDmSendDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        channelLabel={targetThread?.channel_label ?? 'Instagram'}
        accountLabel={targetThread?.account_label}
        customerHandle={targetThread?.customer_handle ?? ''}
        replyText={targetReplyText}
        onConfirm={handleConfirmSend}
      />
    </div>
  )
}
