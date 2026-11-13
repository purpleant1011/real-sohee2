'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppLink as Link } from '@/components/navigation/app-link'
import { cancelMessageAction } from './actions/cancel-message'
import { retryMessageAction } from './actions/retry-message'
import { describeStartFailure } from './start-failure'
import { ConversationShell } from './conversation-shell'
import { BlogStrategyCard } from './blog-strategy-card'
import { parseBlogStrategySelection } from './blog-strategy-selection'
import { parseConversationPostRequest } from './conversation-post-intent'
import { requestsAttachedMediaReuse } from './naver-existing-media-reuse'
import { routeConversationRequest } from './conversation-runtime-router'
import type { ConversationWorkRef } from './conversation-work-ref'
import type { BlogStrategyProposal } from './blog-strategy-proposal'
import { ConversationThreadPanel } from './conversation-thread-panel'
import type { ComposerSubmit } from './conversation-composer'
import type { ConversationArtifact, ConversationMessage } from './types'
import type { ContentInterviewView } from './content-interview'
import {
  conversationArtifactMessageArtifact,
  type ChatStreamEvent,
  type MessageArtifact,
  type MessageEvidenceView,
} from './stream-events'
import { persistedImageArtifact } from './persisted-image-artifact'
import { parseTaskTimeline, restoreTaskTimeline } from './task-timeline'
import type { M01ProactiveReport } from './proactive-report'
import type { ConversationThreadSummary } from './thread-repository'
import { useConversationWorkStatus } from './conversation-work-status-context'
import styles from './conversation-shell.module.css'

export type ScheduleEntryContext = Readonly<{
  intent: 'create_schedule' | 'revise_content' | 'review_context' | 'recover_publish'
  returnTo: string
  scheduleId?: string
  contentId?: string
  contentVersionId?: string
  conversationThreadId?: string
}>

type StreamEvent = ChatStreamEvent

const EMPTY_CONVERSATION_ARTIFACTS: Readonly<Record<string, readonly ConversationArtifact[]>> = Object.freeze({})

function optimisticUserMessage(input: {
  workspaceId: string
  threadId: string
  submission: ComposerSubmit
}): ConversationMessage {
  const now = new Date().toISOString()
  return {
    id: input.submission.clientMessageId,
    clientMessageId: input.submission.clientMessageId,
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    role: 'user',
    content: input.submission.displayMessage ?? input.submission.message,
    status: 'completed',
    workItemId: null,
    createdAt: now,
    completedAt: now,
  }
}

function streamingSoheeMessage(input: {
  workspaceId: string
  threadId: string
  messageId: string
}): ConversationMessage {
  return {
    id: input.messageId,
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    role: 'sohee',
    content: '',
    status: 'streaming',
    workItemId: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function isOption(value: unknown): value is Readonly<{ value: string; label: string }> {
  return isRecord(value) && typeof value.value === 'string' && typeof value.label === 'string'
}

function isContentInterviewView(value: unknown): value is ContentInterviewView {
  if (!isRecord(value)) return false
  if (
    value.kind !== 'content_interview'
    || !['collecting', 'ready_to_generate', 'completed', 'cancelled'].includes(String(value.status))
    || ![1, 2, 3, 4].includes(Number(value.step))
    || value.totalSteps !== 4
    || typeof value.question !== 'string'
    || !Array.isArray(value.options)
    || !value.options.every(isOption)
    || !Array.isArray(value.optionGroups)
    || !Array.isArray(value.previousAnswers)
  ) return false
  if (!value.optionGroups.every((group) => {
    if (!isRecord(group) || !['imageMood', 'callToAction'].includes(String(group.key))) return false
    return typeof group.label === 'string' && Array.isArray(group.options) && group.options.every(isOption)
  })) return false
  if (!value.previousAnswers.every((answer) => {
    if (!isRecord(answer)) return false
    return [1, 2, 3, 4].includes(Number(answer.step))
      && typeof answer.label === 'string'
      && (answer.customText === undefined || typeof answer.customText === 'string')
  })) return false

  if (value.summary === undefined) return true
  if (!isRecord(value.summary)) return false
  return Array.isArray(value.summary.channels)
    && value.summary.channels.every((item) => typeof item === 'string')
    && typeof value.summary.goal === 'string'
    && typeof value.summary.audience === 'string'
    && typeof value.summary.structure === 'string'
    && typeof value.summary.imageMood === 'string'
    && typeof value.summary.callToAction === 'string'
    && typeof value.summary.referenceMediaCount === 'number'
    && Array.isArray(value.summary.mustInclude)
    && value.summary.mustInclude.every((item) => typeof item === 'string')
    && Array.isArray(value.summary.mustAvoid)
    && value.summary.mustAvoid.every((item) => typeof item === 'string')
    && typeof value.summary.audienceProblem === 'string'
    && typeof value.summary.tone === 'string'
    && typeof value.summary.messageAngle === 'string'
    && typeof value.summary.imageComposition === 'string'
    && Array.isArray(value.summary.sceneRoles)
    && value.summary.sceneRoles.every((item) => typeof item === 'string')
    && Array.isArray(value.summary.imageAvoid)
    && value.summary.imageAvoid.every((item) => typeof item === 'string')
}

export function parseEvent(value: unknown): StreamEvent | null {
  if (!value || typeof value !== 'object' || !('type' in value) || !('messageId' in value)) return null
  if (typeof value.type !== 'string' || typeof value.messageId !== 'string') return null
  if (value.type === 'message.started' || value.type === 'message.completed') return value as StreamEvent
  if (value.type === 'message.pending' && 'message' in value && typeof value.message === 'string') {
    return value as StreamEvent
  }
  if (value.type === 'message.delta' && 'delta' in value && typeof value.delta === 'string') return value as StreamEvent
  if (value.type === 'message.clarification' && 'clarification' in value && isContentInterviewView(value.clarification)) {
    return value as StreamEvent
  }
  if (value.type === 'message.evidence' && 'evidence' in value) return value as StreamEvent
  if (value.type === 'message.artifact' && 'artifact' in value) return value as StreamEvent
  if (
    value.type === 'artifact_created'
    && 'artifactId' in value
    && 'requestedCount' in value
    && typeof value.artifactId === 'string'
    && typeof value.requestedCount === 'number'
  ) return value as StreamEvent
  if (
    value.type === 'slide_progress'
    && 'slideId' in value
    && 'position' in value
    && 'status' in value
    && typeof value.slideId === 'string'
    && typeof value.position === 'number'
    && typeof value.status === 'string'
  ) return value as StreamEvent
  if (
    (value.type === 'artifact_ready' || value.type === 'artifact_partial')
    && 'artifact' in value
    && typeof value.artifact === 'object'
    && value.artifact !== null
  ) return value as StreamEvent
  if (
    value.type === 'recovery.updated'
    && 'caseId' in value
    && 'view' in value
    && typeof value.caseId === 'string'
  ) return value as StreamEvent
  if (
    value.type === 'task_progress'
    && 'timeline' in value
    && parseTaskTimeline(value.timeline) !== null
  ) return value as StreamEvent
  if (
    value.type === 'message.failed'
    && 'code' in value
    && 'message' in value
    && typeof value.code === 'string'
    && typeof value.message === 'string'
  ) return value as StreamEvent
  return null
}

export function ConversationClient({
  initialMessages,
  initialConversationArtifacts = EMPTY_CONVERSATION_ARTIFACTS,
  workspaceId,
  threadId,
  persistenceMode = 'persisted',
  proactiveReport = null,
  initialThreads = [],
  hasMoreThreads = false,
  currentThread,
  canManageThreads = false,
  unreadInboxCount = 0,
  openThreadPanel = false,
  reportDecisionContext = null,
  scheduleEntryContext = null,
  backgroundJobs = false,
  initialThreadLoadFailed = false,
  readOnly = false,
  workContext = null,
  workModesEnabled = true,
  messageRequest = fetch,
}: Readonly<{
  initialMessages: readonly ConversationMessage[]
  initialConversationArtifacts?: Readonly<Record<string, readonly ConversationArtifact[]>>
  workspaceId: string
  threadId: string | null
  persistenceMode?: 'persisted' | 'stateless'
  proactiveReport?: M01ProactiveReport | null
  initialThreads?: readonly ConversationThreadSummary[]
  hasMoreThreads?: boolean
  currentThread?: ConversationThreadSummary
  canManageThreads?: boolean
  unreadInboxCount?: number
  openThreadPanel?: boolean
  reportDecisionContext?: Readonly<{
    id: string
    title: string
    hypothesis: string
    changeVariable: 'opening' | 'format' | 'cta' | 'timing' | 'other'
    invariants: readonly string[]
    evidenceVersionIds: readonly string[]
  }> | null
  scheduleEntryContext?: ScheduleEntryContext | null
  backgroundJobs?: boolean
  initialThreadLoadFailed?: boolean
  readOnly?: boolean
  workContext?: ConversationWorkRef | null
  workModesEnabled?: boolean
  messageRequest?: typeof fetch
}>) {
  const router = useRouter()
  const workStatus = useConversationWorkStatus()
  const [messages, setMessages] = useState<readonly ConversationMessage[]>(initialMessages)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(threadId)
  const [activeThread, setActiveThread] = useState<ConversationThreadSummary | undefined>(currentThread)
  const [busy, setBusy] = useState(false)
  const [strategyRequestToken, setStrategyRequestToken] = useState(0)
  const strategyGenerationActive = useRef(false)
  const strategyReplyHandler = useRef<((text: string) => Promise<boolean>) | null>(null)
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [messageDetails, setMessageDetails] = useState<Record<string, {
    evidence: MessageEvidenceView[]
    artifacts: MessageArtifact[]
  }>>(() => Object.fromEntries(initialMessages.flatMap((message) => {
    const persistedArtifact = persistedImageArtifact(message)
    const conversationArtifacts = (initialConversationArtifacts?.[message.id] ?? [])
      .map(conversationArtifactMessageArtifact)
    const artifacts = [
      ...(persistedArtifact ? [persistedArtifact] : []),
      ...conversationArtifacts,
    ]
    return artifacts.length > 0
      ? [[message.id, { evidence: [], artifacts }]]
      : []
  })))
  const abortController = useRef<AbortController | null>(null)
  const startRequestKey = useRef<string | null>(null)
  const pendingCanonicalPath = useRef<string | null>(null)
  const optimisticMessageIds = useRef<Set<string>>(new Set())
  const refreshVersion = useRef(0)
  const artifactRefreshVersion = useRef(0)
  const previousThreadWorkStatus = useRef<string | null>(null)
  const refreshRouter = router.refresh
  const pendingTaskMessages = messages.filter(message => message.role === 'sohee' && message.id !== activeAssistantId && ['queued', 'streaming'].includes(message.status)).map(message => message.id).join(',')

  useEffect(() => {
    if (!backgroundJobs || !activeThreadId || !pendingTaskMessages) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const ids = new Set(pendingTaskMessages.split(','))
    async function refreshTasks() {
      const deadline = setTimeout(() => controller.abort(), 15_000)
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/conversations/${activeThreadId}/messages?view=tasks`, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('TASK_READ_FAILED')
        const payload = await response.json() as { data?: { messageId: string; status: string; timeline: unknown }[] }
        if (!Array.isArray(payload.data) || controller.signal.aborted) return
        const rows = payload.data.filter(row => ids.has(row.messageId))
        setMessages(current => current.map(message => {
          const row = rows.find(item => item.messageId === message.id)
          const timeline = row ? restoreTaskTimeline(row.timeline, row.status) : null
          return timeline ? { ...message, taskTimeline: timeline } : message
        }))
        if (rows.some(row => ['completed', 'failed', 'cancelled'].includes(row.status))) refreshRouter()
      } catch {
        if (!controller.signal.aborted) setMessages(current => current.map(message => ids.has(message.id) && message.taskTimeline
          ? { ...message, taskTimeline: restoreTaskTimeline(message.taskTimeline, 'completed')! } : message))
      } finally {
        clearTimeout(deadline)
        if (!controller.signal.aborted) timer = setTimeout(refreshTasks, 2500)
      }
    }
    void refreshTasks()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [workspaceId, activeThreadId, backgroundJobs, pendingTaskMessages, refreshRouter])

  useEffect(() => {
    if (!activeThreadId || !backgroundJobs) return
    const current = workStatus?.threads.find((thread) => thread.threadId === activeThreadId)?.displayStatus ?? null
    if (previousThreadWorkStatus.current === 'working' && current && current !== 'working') {
      router.refresh()
      setActiveJobId(null)
      setStatusMessage(current === 'attention'
        ? '작업 결과를 확인해 주세요.'
        : '소희가 작업을 완료했어요.')
    }
    previousThreadWorkStatus.current = current
  }, [activeThreadId, backgroundJobs, router, workStatus])

  useEffect(() => {
    const version = refreshVersion.current + 1
    refreshVersion.current = version
    const refreshMessages = () => {
      if (refreshVersion.current !== version) return
      setMessages((current) => {
        const initialIds = new Set(initialMessages.map((message) => message.id))
        const confirmedOptimisticIds = new Set([
          ...initialIds,
          ...initialMessages.flatMap((message) => message.clientMessageId ? [message.clientMessageId] : []),
        ])
        for (const confirmedId of confirmedOptimisticIds) {
          optimisticMessageIds.current.delete(confirmedId)
        }
        const localOnly = current.filter((message) =>
          !confirmedOptimisticIds.has(message.id) && optimisticMessageIds.current.has(message.id),
        )
        return [...initialMessages, ...localOnly]
      })
    }
    queueMicrotask(refreshMessages)
  }, [initialMessages])

  useEffect(() => {
    const version = artifactRefreshVersion.current + 1
    artifactRefreshVersion.current = version
    queueMicrotask(() => {
      if (artifactRefreshVersion.current !== version) return
      setMessageDetails((current) => {
        let changed = false
        const next = { ...current }

        for (const message of initialMessages) {
          const persistedArtifact = persistedImageArtifact(message)
          const refreshedArtifacts = [
            ...(persistedArtifact ? [persistedArtifact] : []),
            ...(initialConversationArtifacts[message.id] ?? []).map(conversationArtifactMessageArtifact),
          ]
          if (refreshedArtifacts.length === 0) continue

          const existing = current[message.id] ?? { evidence: [], artifacts: [] }
          const merged = new Map(existing.artifacts.map((artifact) => [`${artifact.kind}:${artifact.id}`, artifact]))
          for (const artifact of refreshedArtifacts) {
            merged.set(`${artifact.kind}:${artifact.id}`, artifact)
          }
          const artifacts = [...merged.values()]
          if (
            artifacts.length === existing.artifacts.length
            && artifacts.every((artifact, index) => artifact === existing.artifacts[index])
          ) continue

          next[message.id] = { evidence: existing.evidence, artifacts }
          changed = true
        }

        return changed ? next : current
      })
    })
  }, [initialConversationArtifacts, initialMessages])

  function updateAssistant(messageId: string, update: (message: ConversationMessage) => ConversationMessage) {
    setMessages((current) => current.map((message) => message.id === messageId ? update(message) : message))
  }

  async function send(
    submission: ComposerSubmit,
    retryAssistantMessageId?: string,
    artifactReference?: Readonly<{ replyToMessageId: string; retryFailedSlideId: string }>,
    marketingStrategy?: NonNullable<BlogStrategyProposal['reference']>,
  ): Promise<boolean> {
    if (busy || readOnly || activeThread?.status === 'archived') return false
    if (workContext && (workContext.workspaceId !== workspaceId || routeConversationRequest(submission.message).kind === 'existing_flow'
      || parseConversationPostRequest(submission.message) || submission.attachmentIds.length || artifactReference || marketingStrategy)) {
      setStatusMessage('선택한 원고는 이 대화에서 읽기 전용으로 검토해요. 수정·승인·게시는 원래 원고 화면에서 이어서 진행해 주세요.')
      return false
    }
    if (!strategyGenerationActive.current) {
      for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        if (message.workspaceId !== workspaceId || message.threadId !== activeThreadId || message.role !== 'sohee') continue
        const question = message.clarification
        if (question?.kind === 'content_interview' && (question.status === 'collecting' || question.status === 'ready_to_generate')) {
          strategyGenerationActive.current = true
        }
        break
      }
    }
    if (!marketingStrategy && !retryAssistantMessageId && !artifactReference && submission.attachmentIds.length === 0
      && strategyReplyHandler.current && parseBlogStrategySelection(submission.message)) {
      const reply = strategyReplyHandler.current
      setBusy(true)
      try { return await reply(submission.message) } finally { setBusy(false) }
    }
    if (!marketingStrategy && !strategyGenerationActive.current && !retryAssistantMessageId && !artifactReference
      && activeThreadId && persistenceMode === 'persisted' && submission.attachmentIds.length === 0
      && /(?:네이버|블로그)/u.test(submission.message) && /(?:주제|전략|작성|만들|써\s*줘)/u.test(submission.message)) {
      setStrategyRequestToken(value => value + 1)
      return true
    }
    if (marketingStrategy || (!activeThreadId && persistenceMode === 'persisted'
      && !retryAssistantMessageId && !artifactReference
      && parseConversationPostRequest(submission.message)?.candidates.some(candidate => candidate.channel === 'naver_blog'))) {
      strategyGenerationActive.current = true
    }
    setBusy(true)
    setErrorMessage('')
    setStatusMessage('소희가 확인된 자료를 살펴보고 있어요.')
    let targetThreadId = activeThreadId
    let startedThreadPath: string | null = pendingCanonicalPath.current
    let controller: AbortController | null = null
    let streamStarted = false
    let streamingMessageId: string | null = null
    let awaitingStrategyReply = false

    try {
      if (targetThreadId === null) {
        startRequestKey.current ??= crypto.randomUUID()
        const startResponse = await fetch(`/api/workspaces/${workspaceId}/conversations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            requestKey: startRequestKey.current,
            firstMessage: {
              clientMessageId: submission.clientMessageId,
              content: submission.displayMessage ?? submission.message,
            },
          }),
        })
        if (!startResponse.ok) throw new Error('conversation_start_failed')
        const payload = await startResponse.json() as {
          data?: {
            thread?: ConversationThreadSummary
            userMessage?: ConversationMessage
          }
        }
        if (!payload.data?.thread?.id || !payload.data.userMessage?.id) {
          throw new Error('conversation_start_invalid')
        }
        targetThreadId = payload.data.thread.id
        startRequestKey.current = null
        startedThreadPath = `/app/conversations/${targetThreadId}${workContext ? `?workRef=${workContext.versionId}` : ''}`
        pendingCanonicalPath.current = startedThreadPath
        setActiveThreadId(targetThreadId)
        setActiveThread(payload.data.thread)
        optimisticMessageIds.current.add(payload.data.userMessage.id)
        setMessages((current) => [...current, payload.data!.userMessage!])
      } else if (!retryAssistantMessageId) {
        const existingThreadId = targetThreadId
        optimisticMessageIds.current.add(submission.clientMessageId)
        setMessages((current) => [...current, optimisticUserMessage({
          workspaceId,
          threadId: existingThreadId,
          submission,
        })])
      }

      if (targetThreadId === null) throw new Error('conversation_start_invalid')
      const resolvedThreadId = targetThreadId
      if (backgroundJobs && persistenceMode === 'persisted' && !strategyGenerationActive.current && !workContext && !retryAssistantMessageId && !requestsAttachedMediaReuse(submission.message)) {
        const response = await fetch(`/api/workspaces/${workspaceId}/conversations/${resolvedThreadId}/jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            content: submission.message,
            ...(submission.displayMessage ? { displayContent: submission.displayMessage } : {}),
            clientMessageId: submission.clientMessageId,
            attachmentIds: submission.attachmentIds,
            ...(retryAssistantMessageId ? { retryAssistantMessageId } : {}),
            ...(artifactReference ?? {}),
          }),
        })
        const payload = response.ok ? await response.json() as {
          data?: {
            job?: { id: string }
            userMessage?: ConversationMessage
            assistantMessage?: ConversationMessage
          }
        } : null
        if (response.status !== 202 || !payload?.data?.job?.id
          || !payload.data.userMessage || !payload.data.assistantMessage) {
          throw new Error('conversation_job_start_failed')
        }
        optimisticMessageIds.current.delete(submission.clientMessageId)
        setMessages((current) => [
          ...current.filter((message) =>
            message.id !== submission.clientMessageId
            && message.id !== payload.data!.userMessage!.id
            && message.id !== payload.data!.assistantMessage!.id,
          ),
          payload.data!.userMessage!,
          payload.data!.assistantMessage!,
        ])
        setActiveJobId(payload.data.job.id)
        setActiveAssistantId(payload.data.assistantMessage.id)
        previousThreadWorkStatus.current = 'working'
        setStatusMessage('작업을 접수했어요. 실행 순서에 따라 진행하며 다른 대화로 이동해도 상태를 확인할 수 있어요.')
        window.dispatchEvent(new Event('sohee:work-status-refresh'))
        if (startedThreadPath) { router.replace(startedThreadPath); pendingCanonicalPath.current = null }
        else router.refresh()
        return true
      }
      controller = new AbortController()
      abortController.current = controller
      const response = await messageRequest(`/api/workspaces/${workspaceId}/conversations/${resolvedThreadId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: submission.message,
          ...(submission.displayMessage ? { displayContent: submission.displayMessage } : {}),
          clientMessageId: submission.clientMessageId,
          attachmentIds: submission.attachmentIds,
          ...(retryAssistantMessageId ? { retryAssistantMessageId } : {}),
          ...(artifactReference ?? {}),
          ...(marketingStrategy ? { marketingStrategy } : {}),
          ...(workContext ? { workRef: workContext.versionId } : {}),
        }),
        signal: controller.signal,
      })
      if (workContext && response.status === 409) throw new Error('selected_work_unavailable')
      if (response.status === 422) {
        const code = (await response.json().catch(() => null))?.error?.code
        if (code === 'CHAT_SOURCE_PHOTO_REQUIRED' || code === 'CHAT_ATTACHED_MEDIA_COUNT_UNSUPPORTED' || code === 'CHAT_PHOTO_PLAN_CHANGED') throw new Error(code)
      }
      if (!response.ok || !response.body) throw new Error('chat_request_failed')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffered = ''
      let providerFailed = false
      let cancelledInterviewMessageId: string | null = null

      while (true) {
        const result = await reader.read()
        buffered += decoder.decode(result.value, { stream: !result.done })
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          let event: StreamEvent | null = null
          try {
            event = parseEvent(JSON.parse(line))
          } catch {
            event = null
          }
          if (!event) continue

          if (event.type === 'message.started') {
            streamStarted = true
            streamingMessageId = event.messageId
            optimisticMessageIds.current.add(event.messageId)
            setActiveAssistantId(event.messageId)
            setMessages((current) => [
              ...current.filter((message) => message.id !== event.messageId),
              streamingSoheeMessage({ workspaceId, threadId: resolvedThreadId, messageId: event.messageId }),
            ])
          } else if (event.type === 'message.delta') {
            updateAssistant(event.messageId, (message) => ({ ...message, content: message.content + event.delta }))
          } else if (event.type === 'message.pending') {
            setStatusMessage('처리 중인 응답을 확인하고 있어요')
          } else if (event.type === 'message.clarification') {
            cancelledInterviewMessageId = event.clarification.status === 'cancelled' ? event.messageId : null
            awaitingStrategyReply = strategyGenerationActive.current && event.clarification.kind === 'content_interview'
              && (event.clarification.status === 'collecting' || event.clarification.status === 'ready_to_generate')
            updateAssistant(event.messageId, (message) => ({ ...message, clarification: event.clarification }))
          } else if (event.type === 'message.completed') {
            updateAssistant(event.messageId, (message) => ({
              ...message,
              status: 'completed',
              completedAt: new Date().toISOString(),
            }))
            setStatusMessage('소희가 답변을 완료했어요.')
          } else if (event.type === 'message.evidence') {
            setMessageDetails((current) => ({
              ...current,
              [event.messageId]: {
                evidence: [...(current[event.messageId]?.evidence ?? []), event.evidence],
                artifacts: current[event.messageId]?.artifacts ?? [],
              },
            }))
          } else if (event.type === 'task_progress') {
            updateAssistant(event.messageId, message => ({ ...message, taskTimeline: event.timeline }))
            setMessageDetails((current) => ({ ...current, [event.messageId]: {
              evidence: current[event.messageId]?.evidence ?? [],
              artifacts: [...(current[event.messageId]?.artifacts ?? []).filter(item => item.kind !== 'task_timeline'), event.timeline],
            } }))
          } else if (event.type === 'message.artifact') {
            setMessageDetails((current) => ({
              ...current,
              [event.messageId]: {
                evidence: current[event.messageId]?.evidence ?? [],
                artifacts: [...(current[event.messageId]?.artifacts ?? []), event.artifact],
              },
            }))
          } else if (event.type === 'artifact_created') {
            setStatusMessage(`이미지 ${event.requestedCount}장 생성을 준비하고 있어요.`)
          } else if (event.type === 'slide_progress') {
            setStatusMessage(`${event.position}번 이미지 상태를 확인하고 있어요.`)
          } else if (event.type === 'artifact_ready' || event.type === 'artifact_partial') {
            const artifact = conversationArtifactMessageArtifact(event.artifact)
            setMessageDetails((current) => ({
              ...current,
              [event.messageId]: {
                evidence: current[event.messageId]?.evidence ?? [],
                artifacts: [
                  ...(current[event.messageId]?.artifacts ?? []).filter((candidate) =>
                    candidate.kind !== 'conversation_artifact' || candidate.id !== artifact.id,
                  ),
                  artifact,
                ],
              },
            }))
            setStatusMessage(event.type === 'artifact_partial'
              ? '완료된 이미지를 보존했어요. 실패한 장만 다시 시도할 수 있어요.'
              : '문안과 이미지를 검토할 준비가 됐어요.')
          } else if (event.type === 'recovery.updated') {
            const recoveryArtifact: MessageArtifact = {
              id: `recovery-${event.caseId}-${event.version}`,
              kind: 'booking_recovery',
              title: '예약 문의 관리',
              href: `/app/conversations`,
              requiresConfirmation: true,
              caseId: event.caseId,
              missionId: event.missionId,
              version: event.version,
              view: event.view,
            }
            setMessageDetails((current) => ({
              ...current,
              [event.messageId]: {
                evidence: current[event.messageId]?.evidence ?? [],
                artifacts: [
                  ...(current[event.messageId]?.artifacts ?? []).filter(
                    (a) => a.kind !== 'booking_recovery' || (a as any).caseId !== event.caseId,
                  ),
                  recoveryArtifact,
                ],
              },
            }))
            setStatusMessage('예약 문의 확인 카드가 준비되었어요.')
          } else if (event.type === 'message.failed') {
            const interviewCancelled = event.code === 'CHAT_CANCELLED' && cancelledInterviewMessageId === event.messageId
            providerFailed ||= !interviewCancelled
            setStatusMessage(interviewCancelled ? event.message : '')
            updateAssistant(event.messageId, (message) => ({
              ...message,
              content: message.content || event.message,
              status: event.code === 'CHAT_CANCELLED' ? 'cancelled' : 'failed',
              completedAt: new Date().toISOString(),
            }))
            if (!interviewCancelled) setErrorMessage(event.message)
          }
        }

        if (result.done) break
      }

      if (!providerFailed && persistenceMode === 'persisted') {
        if (startedThreadPath) { router.replace(startedThreadPath); pendingCanonicalPath.current = null }
        else router.refresh()
      }
      return !providerFailed
    } catch (caught) {
      setStatusMessage('')
      if (caught instanceof Error && caught.message === 'CHAT_SOURCE_PHOTO_REQUIRED') {
        setErrorMessage('원본으로 사용할 사진을 먼저 첨부해 주세요. 새 AI 이미지로 대신 만들지 않았어요.')
      } else if (caught instanceof Error && caught.message === 'CHAT_PHOTO_PLAN_CHANGED') {
        setErrorMessage('첨부 사진 수가 검토한 제작안과 달라요. 사용할 사진을 다시 첨부해 새 제작안을 요청해 주세요.')
      } else if (caught instanceof Error && caught.message === 'CHAT_ATTACHED_MEDIA_COUNT_UNSUPPORTED') {
        setErrorMessage('인스타그램·스레드 원본 사진은 한 번에 3장까지 준비할 수 있어요. 사진 수를 줄여 다시 요청해 주세요.')
      } else if (caught instanceof Error && caught.message === 'selected_work_unavailable') {
        setErrorMessage('선택한 원고가 변경됐거나 현재 검토할 수 없어요. 원래 화면에서 최신 버전을 다시 선택해 주세요.')
      } else if (controller?.signal.aborted) {
        setStatusMessage('응답 생성을 중단했어요.')
      } else if (targetThreadId === null) {
        setErrorMessage(`새 대화를 시작하지 못했어요. 입력을 보존했으니 다시 시도해 주세요. (오류: ${describeStartFailure(caught)})`)
      } else {
        setErrorMessage(`응답을 시작하지 못했습니다. 입력을 확인하고 다시 시도해 주세요. (오류: ${describeStartFailure(caught)})`)
      }
      return streamStarted
    } finally {
      setMessages(current => current.map(message => message.id === streamingMessageId && message.taskTimeline?.isLive
        ? { ...message, taskTimeline: restoreTaskTimeline(message.taskTimeline, ['failed', 'cancelled'].includes(message.status) ? message.status : 'completed')! }
        : message))
      setMessageDetails(current => Object.fromEntries(Object.entries(current).map(([id, details]) => [id, {
        ...details, artifacts: details.artifacts.map(item => item.kind === 'task_timeline' && item.isLive
          ? restoreTaskTimeline(item, 'completed')! : item),
      }])))
      strategyGenerationActive.current = awaitingStrategyReply
      abortController.current = null
      setActiveAssistantId(null)
      setBusy(false)
    }
  }

  async function retry(messageId: string) {
    if (activeThreadId === null) {
      setErrorMessage('저장된 대화에서만 답변을 다시 시도할 수 있어요.')
      return
    }
    if (persistenceMode === 'stateless') {
      setErrorMessage('DB 연결 대기 모드에서는 실패한 답변을 새 질문으로 다시 보내 주세요.')
      return
    }
    const result = await retryMessageAction({ workspaceId, threadId: activeThreadId, assistantMessageId: messageId })
    if (result.error) {
      setErrorMessage(result.error.message)
      return
    }
    await send({
      message: result.data.content,
      attachmentIds: [],
      clientMessageId: result.data.clientMessageId,
    }, result.data.retryAssistantMessageId)
  }

  async function cancel() {
    if (activeJobId && activeThreadId && backgroundJobs && persistenceMode === 'persisted') {
      const response = await fetch(`/api/workspaces/${workspaceId}/conversation-jobs/${activeJobId}/cancel`, {
        method: 'POST',
      })
      if (!response.ok) {
        setErrorMessage('작업 중단 요청을 전달하지 못했어요.')
        return
      }
      setStatusMessage('작업 중단을 요청했어요.')
      return
    }
    abortController.current?.abort()
    if (activeAssistantId && activeThreadId && persistenceMode === 'persisted') {
      await cancelMessageAction({ workspaceId, messageId: activeAssistantId })
    }
    setStatusMessage('응답 생성을 중단했어요.')
  }

  async function retryFailedSlides(replyToMessageId: string, artifactId: string, slideIds: readonly string[]) {
    if (!activeThreadId || slideIds.length < 1 || slideIds.length > 20) return
    setErrorMessage('')
    setStatusMessage(`실패 이미지 ${slideIds.length}장을 같은 결과물 안에서 다시 만들고 있어요.`)
    for (const slideId of slideIds) {
      const response = await fetch(`/api/workspaces/${workspaceId}/conversations/${activeThreadId}/artifacts/${artifactId}/retry-slide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ replyToMessageId, slideId, requestKey: crypto.randomUUID() }),
      })
      const payload = response.ok ? await response.json() as { data?: { artifact?: ConversationArtifact } } : null
      if (!payload?.data?.artifact) {
        setErrorMessage('이미지를 다시 만들지 못했어요. 완료된 이미지는 그대로 보존했습니다.')
        return
      }
      const updated = conversationArtifactMessageArtifact(payload.data.artifact)
      setMessageDetails((current) => ({
        ...current,
        [replyToMessageId]: {
          evidence: current[replyToMessageId]?.evidence ?? [],
          artifacts: [
            ...(current[replyToMessageId]?.artifacts ?? []).filter((candidate) =>
              candidate.kind !== 'conversation_artifact' || candidate.id !== artifactId,
            ),
            updated,
          ],
        },
      }))
      const retriedSlide = payload.data.artifact.slides.find((slide) => slide.id === slideId)
      if (retriedSlide?.status === 'failed') {
        const reason = retriedSlide.safeErrorCode === 'IMAGE_QUOTA_EXHAUSTED'
          ? '이미지 생성이 중단되었어요. 완료된 이미지는 그대로 보존했습니다.'
          : retriedSlide.safeErrorCode === 'IMAGE_AUTH_REQUIRED'
            ? '이미지 API 연결 인증을 확인해 주세요. 완료된 이미지는 그대로 보존했습니다.'
            : retriedSlide.safeErrorCode === 'IMAGE_MODEL_UNAVAILABLE'
              ? '현재 이미지 모델의 프로젝트 접근 권한을 확인해 주세요.'
              : retriedSlide.safeErrorCode === 'IMAGE_PROMPT_INVALID'
                ? '이미지 장면 설명을 안전하게 정리하지 못했어요. 다시 생성할 수 있도록 문안을 조정해 주세요.'
                : retriedSlide.safeErrorCode === 'IMAGE_POLICY_REJECTED'
                  ? '이 장면은 이미지 정책 확인이 필요해 자동 생성하지 않았어요.'
                  : retriedSlide.safeErrorCode === 'IMAGE_RATE_LIMITED'
                    ? '이미지 생성 요청이 잠시 몰렸어요. 잠시 후 다시 시도해 주세요.'
                    : '이미지 공급자 응답을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.'
        setStatusMessage(reason)
        throw new Error(reason)
      }
    }
    setStatusMessage('다시 생성한 이미지를 같은 결과물에 반영했어요.')
  }

  return (
    <div className={styles.conversationWorkspace}>
      <ConversationThreadPanel
        canManageThreads={canManageThreads}
        currentThreadId={activeThreadId}
        hasMore={hasMoreThreads}
        initiallyOpen={openThreadPanel}
        initialThreads={initialThreads}
        initialLoadFailed={initialThreadLoadFailed}
        key={openThreadPanel ? 'history-open' : 'history-closed'}
        unreadInboxCount={unreadInboxCount}
        directWorkHref={workContext?.returnHref ?? scheduleEntryContext?.returnTo ?? '/app'}
        workspaceId={workspaceId}
      />
      {scheduleEntryContext ? (
        <section aria-labelledby="schedule-entry-context-title" className={styles.scheduleEntryContext}>
          <div>
            <p>일정에서 이어서 확인하고 있어요.</p>
            <h2 id="schedule-entry-context-title">일정에서 이어온 대화</h2>
          </div>
          <strong>{scheduleEntryContext.intent === 'create_schedule'
            ? '새 일정의 목적과 시간을 함께 정해 보세요.'
            : scheduleEntryContext.intent === 'revise_content'
              ? '콘텐츠를 바꾸면 새 내용을 다시 확인한 뒤 일정을 정해요.'
              : scheduleEntryContext.intent === 'recover_publish'
                ? '확인한 콘텐츠를 보존한 채 게시 상태를 다시 살펴봐요.'
                : '이 일정이 시작된 맥락을 이어서 확인해요.'}</strong>
          <Link href={scheduleEntryContext.returnTo}>일정으로 돌아가기</Link>
        </section>
      ) : null}
      {reportDecisionContext ? (
        <section aria-labelledby="report-decision-context-title" className={styles.reportDecisionContext}>
          <div>
            <p>리포트 판단 #{reportDecisionContext.id.slice(0, 8)}</p>
            <h2 id="report-decision-context-title">리포트에서 가져온 개선 맥락</h2>
          </div>
          <strong>{reportDecisionContext.title}</strong>
          <dl>
            <div><dt>검증할 가설</dt><dd>{reportDecisionContext.hypothesis}</dd></div>
            <div><dt>바꿀 한 가지</dt><dd>{reportDecisionContext.changeVariable}</dd></div>
            <div><dt>유지할 조건</dt><dd>{reportDecisionContext.invariants.join(', ')}</dd></div>
            <div><dt>근거 버전</dt><dd>{reportDecisionContext.evidenceVersionIds.length}개</dd></div>
          </dl>
          <p>첫 메시지는 아직 전송되지 않았어요.</p>
        </section>
      ) : null}
      {activeThreadId && !workContext && persistenceMode === 'persisted' && activeThread?.status !== 'archived' ? <BlogStrategyCard
        key={`${workspaceId}:${activeThreadId}`}
        workspaceId={workspaceId} threadId={activeThreadId} requestToken={strategyRequestToken} disabled={busy}
        onReplyHandlerChange={handler => { strategyReplyHandler.current = handler }}
        onPrepareOnly={async () => {
          if (busy || readOnly || activeThread?.status === 'archived') return false
          // Reuse the foreground interview, not a strategy approval or a replacement background job.
          strategyGenerationActive.current = true
          return send({ message: '네이버 블로그 글 작성해줘.', displayMessage: '사업 목표 연결 없이 안내 원고 준비 질문을 시작해줘.',
            attachmentIds: [], clientMessageId: crypto.randomUUID() })
        }}
        onGenerate={reference => send({ message: '네이버 블로그 글 작성해줘.',
          displayMessage: '승인한 블로그 전략으로 원고를 준비해줘.', attachmentIds: [], clientMessageId: crypto.randomUUID() }, undefined, undefined, reference)}
      /> : null}
      <ConversationShell
        busy={busy}
        composerDisabled={readOnly || activeThread?.status === 'archived'}
        connectionState={persistenceMode === 'persisted' ? 'connected' : 'compatibility'}
        directWorkHref={workContext?.returnHref ?? scheduleEntryContext?.returnTo ?? '/app'}
        workContext={workContext}
        workModesEnabled={workModesEnabled}
        disabledReason={readOnly ? '읽기 전용 권한이에요. 업무 요청은 가게 관리자에게 문의해 주세요.' : undefined}
        errorMessage={errorMessage}
        messages={messages}
        messageDetails={messageDetails}
        onCancel={cancel}
        onRetry={retry}
        onRetrySlides={retryFailedSlides}
        onSubmit={send}
        proactiveReport={proactiveReport}
        statusMessage={statusMessage}
        threadStatus={activeThread?.status}
        threadTitle={activeThread?.title}
        workspaceId={workspaceId}
      />
    </div>
  )
}
