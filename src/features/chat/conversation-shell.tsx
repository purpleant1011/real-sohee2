'use client'

import { Info } from 'lucide-react'
import { useOptionalChatPanel } from '@/features/agent-dock/chat-panel-store'
import { AppLink as Link } from '@/components/navigation/app-link'
import { useRef, useState, type CSSProperties } from 'react'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useComposerScrollClearance } from './use-composer-scroll-clearance'
import { useViewport } from '@/features/mobile-shell/viewport'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { ConversationStartHub, type ConversationSelectionState } from './conversation-start-hub'
import { ConversationWorkContext } from './conversation-work-context'
import { ConversationOperationPanel } from './conversation-operation-panel'
import type { ConversationOperationCatalog } from './conversation-operation-catalog'
import type { ConversationWorkRef } from './conversation-work-ref'
import type { ConversationMessage } from './types'
import type { MessageArtifact, MessageEvidenceView } from './stream-events'
import { ConversationComposer, type ComposerSubmit } from './conversation-composer'
import { MessageCard } from './message-card'
import { BlogArtifactPreview, type BlogBlockSelection } from './blog-artifact-preview'
import type { M01ProactiveReport } from './proactive-report'
import { ProactiveReportCard } from './proactive-report-card'
import type { PeriodPlanAction } from '@/features/plans/period-plan-card'
import styles from './conversation-shell.module.css'

type ConversationShellProps = Readonly<{
  messages?: readonly ConversationMessage[]
  onRetry?: (messageId: string) => void
  onRetrySlides?: (replyToMessageId: string, artifactId: string, selectedSlideIds: readonly string[]) => void | Promise<void>
  onSubmit?: (submission: ComposerSubmit) => void | boolean | Promise<void | boolean>
  connectionState?: 'connected' | 'compatibility' | 'disconnected'
  busy?: boolean
  onCancel?: () => void
  statusMessage?: string
  errorMessage?: string
  messageDetails?: Readonly<Record<string, Readonly<{
    evidence: readonly MessageEvidenceView[]
    artifacts: readonly MessageArtifact[]
  }>>>
  proactiveReport?: M01ProactiveReport | null
  threadTitle?: string
  threadStatus?: 'active' | 'archived'
  composerDisabled?: boolean
  workspaceId?: string
  directWorkHref?: string
  workContext?: ConversationWorkRef | null
  workModesEnabled?: boolean
  disabledReason?: string
  operationCatalog?: ConversationOperationCatalog
}>

const starterCommands = [
  '이번 주 포스팅 기획해줘',
  '받은 문의를 예약까지 이어줘',
  '지난 게시 성과를 정리해줘',
] as const

const periodPlanMessages: Record<PeriodPlanAction, string> = {
  reduce: '이 계획의 목표는 유지하고, 채널과 이미지 범위를 다시 제안해줘.',
  confirm: '기간, 목표, 채널, 작업 수를 확인했어요. 이 계획으로 시작해줘.',
}

export function ConversationShell({
  messages = [],
  onRetry,
  onRetrySlides,
  onSubmit,
  connectionState = 'disconnected',
  busy = false,
  onCancel,
  statusMessage = '',
  errorMessage = '',
  messageDetails = {},
  proactiveReport = null,
  threadTitle = '소희와의 대화',
  threadStatus = 'active',
  composerDisabled = false,
  workspaceId,
  directWorkHref = '/app',
  workContext = null,
  workModesEnabled = true,
  disabledReason = '보관된 대화는 복원한 뒤 이어서 대화할 수 있어요.',
  operationCatalog,
}: ConversationShellProps) {
  const viewport = useViewport()
  const r2Mobile = useMobileR2Active()
  const mobile = useMediaQuery('(max-width: 759px)')
  const composerDock = useRef<HTMLDivElement>(null)
  const messageList = useRef<HTMLOListElement>(null)
  useComposerScrollClearance(composerDock, mobile, viewport.keyboardHeight, {
    messageListRef: messageList,
    messagesLength: messages.length,
    latestMessageRole: messages[messages.length - 1]?.role,
  })
  const chatPanel = useOptionalChatPanel()
  const pendingDraft = !composerDisabled && workspaceId && chatPanel?.pendingMessage?.workspaceId === workspaceId
    ? chatPanel?.pendingMessage : null
  const [announcement, setAnnouncement] = useState('')
  const [attachmentIds, setAttachmentIds] = useState<readonly string[]>([])
  const [clearAttachmentToken, setClearAttachmentToken] = useState(0)
  const [selectedBlock, setSelectedBlock] = useState<Readonly<{ artifactId: string; index: number }> | null>(null)
  const [draftRequest, setDraftRequest] = useState<Readonly<{ id: number; text: string; preserveExisting?: boolean }> | null>(null)
  const [startHubSelection, setStartHubSelection] = useState<ConversationSelectionState | null>(null)

  function markAccepted() {
    setClearAttachmentToken((current) => current + 1)
  }

  function submitMessage(submission: ComposerSubmit) {
    if (onSubmit) {
      const result = onSubmit(submission)
      if (result instanceof Promise) {
        return result.then((accepted) => {
          if (accepted !== false) markAccepted()
          return accepted
        })
      }
      if (result !== false) markAccepted()
      return result
    }

    setAnnouncement('메시지 저장과 AI 응답은 다음 단계에서 서버에 연결합니다. 입력 내용은 저장하거나 전송하지 않았어요.')
  }

  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'sohee')
  const latestInterview = latestAssistantMessage?.clarification
  const latestActionableInterviewMessageId = latestInterview
    && (latestInterview.status === 'collecting' || latestInterview.status === 'ready_to_generate')
    ? latestAssistantMessage.id : null

  // 가장 최근 네이버 블로그 결과물만 PC 옆 레일에 보여 준다. 두 번째 대화 창이나 별도 앱이 아니다.
  const latestBlogArtifact = [...messages].reverse().flatMap((message) => [...(messageDetails[message.id]?.artifacts ?? [])].reverse())
    .flatMap((item) => item.kind === 'conversation_artifact' && item.artifact.type === 'naver_blog_post' ? [item.artifact] : [])[0] ?? null

  function selectBlogBlock(artifactId: string, selection: BlogBlockSelection) {
    setSelectedBlock({ artifactId, index: selection.index })
    const excerpt = selection.text.replace(/\s+/gu, ' ').trim().slice(0, 40)
    setDraftRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      text: `[원고 ${selection.index + 1}번 문단 "${excerpt}${selection.text.length > 40 ? '…' : ''}"] 이 문단을 `,
    }))
  }

  function submitStarter(message: string) {
    return submitMessage({
      attachmentIds: [],
      clientMessageId: crypto.randomUUID(),
      message,
    })
  }

  function submitPeriodPlanAction(action: PeriodPlanAction) {
    return submitMessage({
      attachmentIds: [],
      clientMessageId: crypto.randomUUID(),
      message: periodPlanMessages[action],
    })
  }

  const showHeader = !r2Mobile || Boolean(workContext) || threadStatus === 'archived'

  return (
    <section aria-label="소희와의 대화" className={`${styles.shell} ${latestBlogArtifact ? styles.shellWithRail : ''}`} data-conversation-workspace style={{ '--conversation-keyboard-inset': `${viewport.keyboardHeight}px` } as CSSProperties}>
      {showHeader ? (
        <header className={styles.conversationHeader}>
          {workModesEnabled && !r2Mobile ? <nav aria-label="업무 방식" className={styles.workModes}>
            <span aria-current="page">대화로 맡기기</span>
            <Link href={workContext?.returnHref ?? directWorkHref}>화면에서 직접</Link>
          </nav> : null}
          {workContext ? <ConversationWorkContext work={workContext} /> : null}
          {r2Mobile ? (threadStatus === 'archived' ? <p className="text-xs text-muted-foreground">보관된 대화 · 읽기 전용</p> : null) : <div className={styles.currentThreadHeading}>
            <div>
              <p>현재 대화</p>
              <h1>{threadTitle}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {threadStatus === 'archived' ? <span>보관된 대화 · 읽기 전용</span> : null}
              {workModesEnabled && workspaceId ? <ConversationOperationPanel workspaceId={workspaceId} initialCatalog={operationCatalog}
                readOnlyReason={composerDisabled ? disabledReason : workContext ? '선택한 원고는 읽기 전용 검토 중이에요. 수정·제작은 원래 원고 화면에서 이어서 진행해 주세요.' : undefined}
                onChoose={operation => {
                  setDraftRequest(current => ({ id: (current?.id ?? 0) + 1, text: operation.prompt, preserveExisting: true }))
                  setAnnouncement('선택한 업무를 입력창에 담았어요. 아직 전송하지 않았습니다.')
                }} /> : null}
            </div>
          </div>}
          {r2Mobile ? null : <details className={styles.conversationBoundary}>
            <summary>게시·발송은 검토 후 승인해요</summary>
            <Info aria-hidden="true" strokeWidth={1.8} />
            <p>초안과 실제 진행 상황을 함께 확인해요. 공개 게시와 비용이 드는 작업은 내용을 확인하고 승인해 주세요.</p>
            <span className={styles.connectionBadge} data-connected={connectionState !== 'disconnected'}>
              {connectionState === 'connected'
                ? '실제 대화 연결됨'
                : connectionState === 'compatibility'
                  ? 'AI 대화 연결됨 · DB 저장 대기'
                  : '서버 대화 연결 전'}
            </span>
          </details>}
        </header>
      ) : null}

      <ol aria-label="대화 메시지" className={styles.messageList} ref={messageList}>
        {proactiveReport ? <ProactiveReportCard report={proactiveReport} /> : null}
        {messages.map((message) => (
            <MessageCard
              attachmentIds={attachmentIds}
              artifacts={messageDetails[message.id]?.artifacts}
              evidence={messageDetails[message.id]?.evidence}
              key={message.id}
              message={message}
              onPeriodPlanAction={submitPeriodPlanAction}
              onRetry={onRetry}
              onRetrySlides={onRetrySlides}
              onSubmit={submitMessage}
              workspaceId={workspaceId}
              planActionsDisabled={
                busy
                || composerDisabled
                || Boolean(message.clarification && message.id !== latestActionableInterviewMessageId)
              }
            />
          ))}
        {messages.length === 0 && proactiveReport === null ? (
          <li className={styles.emptyState}>
            {r2Mobile && !workContext ? (
              <ConversationStartHub
                disabled={busy || composerDisabled}
                onStart={submitStarter}
                onSelectionChange={setStartHubSelection}
              />
            ) : <div className={styles.newConversationHero}>
              <small>가게와 함께하는 소희</small>
              <h2>무엇부터 함께 해볼까요?</h2>
              <p>기획부터 문의 답변까지, 필요한 일을 말씀해 주세요.</p>
              <div className={styles.starterCommands}>
                {(workContext ? ['이 원고의 핵심 내용을 정리해줘', '이 원고에서 확인할 사항을 알려줘'] : starterCommands).map((command) => (
                  <button
                    disabled={busy || composerDisabled}
                    key={command}
                    onClick={() => submitStarter(command)}
                    type="button"
                  >
                    {command}
                  </button>
                ))}
              </div>
            </div>}
          </li>
        ) : null}
      </ol>

      {latestBlogArtifact ? (
        <BlogArtifactPreview
          artifact={latestBlogArtifact}
          onSelectBlock={(selection) => selectBlogBlock(latestBlogArtifact.id, selection)}
          selectable={!composerDisabled && !busy}
          selectedIndex={selectedBlock?.artifactId === latestBlogArtifact.id ? selectedBlock.index : null}
        />
      ) : null}

      <div aria-live="polite" className={styles.announcement}>
        {statusMessage || announcement}
      </div>
      <div
        aria-hidden="true"
        className={styles.scrollClearanceSpacer}
        data-scroll-clearance-spacer
      />
      <div
        ref={composerDock}
        className={styles.composerDock}
        data-keyboard-open={viewport.keyboardOpen ? 'true' : undefined}
      >
        {errorMessage ? <div className={styles.clientError} role="alert">{errorMessage}</div> : null}
        {busy && onCancel ? (
          <div className={styles.composerHeaderRow}>
            <button className={styles.cancelGeneration} onClick={onCancel} type="button">응답 생성 중단</button>
          </div>
        ) : null}
        <ConversationComposer
          clearAttachmentToken={clearAttachmentToken}
          disabled={busy || composerDisabled}
          onAttachmentIdsChange={setAttachmentIds}
          onSubmit={submitMessage}
          draftRequest={pendingDraft ? { id: pendingDraft.id, text: pendingDraft.text, preserveExisting: true } : draftRequest}
          onDraftApplied={(id) => {
            if (pendingDraft?.id === id) chatPanel?.consumePendingMessage(pendingDraft.id)
          }}
          workspaceId={workspaceId}
          selectionBadges={startHubSelection?.badges}
          readyPrompt={startHubSelection?.prompt}
          isReady={startHubSelection?.ready}
          onClearSelection={() => setStartHubSelection(null)}
        />
        <p>{composerDisabled ? disabledReason : (
          r2Mobile || mobile ? (
            connectionState === 'connected'
              ? '작성한 내용은 자동으로 저장돼요.'
              : connectionState === 'compatibility'
                ? 'AI 응답은 작동하지만 새로고침 후 대화가 유지되지 않아요.'
                : '현재 입력은 서버에 전송되지 않아요.'
          ) : (
            <>Enter로 보내기 · Shift+Enter로 줄바꿈 · {connectionState === 'connected'
              ? '응답은 안전하게 저장돼요.'
              : connectionState === 'compatibility'
                ? 'AI 응답은 작동하지만 DB 연결 전까지 새로고침 후 대화가 유지되지 않아요.'
                : '현재 입력은 서버에 전송되지 않아요.'}</>
          )
        )}</p>
      </div>
    </section>
  )
}
