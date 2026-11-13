export const dynamic = 'force-dynamic';
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { chatRequestSchema } from '@/features/chat/chat-request-schema'
import type { approveConversationMarketingStrategy, loadConversationMarketingStrategy } from '@/features/chat/conversation-marketing-strategy'
import type { ConversationArtifactWorkflowInput } from '@/features/chat/conversation-artifact-generation'
import { parseConversationImageRequest, type ConversationImageRequest } from '@/features/chat/conversation-image-intent'
import { parseConversationPostRequest, postRequestFromInterviewState, withoutManualOnlyChannels } from '@/features/chat/conversation-post-intent'
import {
  decideContentInterviewTurn,
  interviewResponseText,
  type ContentInterviewTurnDecision,
} from '@/features/chat/content-interview-server'
import type {
  ContentBrief,
  ContentInterviewState,
} from '@/features/chat/content-interview'
import {
  cancelContentInterview,
  completeContentInterview,
  findContentInterviewByMessage,
  findLatestContentInterview,
  findLatestReadyContentInterview,
  retireContentInterview,
  terminalCancelledContentInterviewState,
  validateContentInterviewAttachments,
} from '@/features/chat/content-interview-repository'
import { requestsExistingNaverMedia, requestsAttachedMediaReuse } from '@/features/chat/naver-existing-media-reuse'
import type { SoheeContextBundle } from '@/features/chat/context-builder'
import type { ArtifactReferenceResult } from '@/features/chat/conversation-artifact-repository'
import type { ImageMessageArtifact, MessageEvidenceView, TaskTimelineMessageArtifact } from '@/features/chat/stream-events'
import { createTaskTracker } from '@/features/chat/task-timeline'
import { imageFailureForUser } from '@/features/chat/image-failure'
import type { ConversationArtifact, ConversationArtifactSlide, ConversationMessage } from '@/features/chat/types'
import { persistedImageArtifact } from '@/features/chat/persisted-image-artifact'
import type { CreditGateway } from '@/features/credits/repository'
import type { ChatProvider } from '@/lib/providers/chat-provider'
import type { ContentInterviewUsageMetadata } from '@/features/chat/content-interview-repository'
import type { UsageEventInput } from '@/features/credits/usage-event'

type RouteContext = Readonly<{
  params: Promise<{ workspaceId: string; threadId: string }>
}>

type FinalizeInput = Readonly<{
  workspaceId: string
  messageId: string
  content: string
  status: 'completed' | 'failed' | 'cancelled'
  errorCode: string | null
  artifact?: Readonly<{ type: 'media_asset'; id: string }>
  usageMetadata?: ContentInterviewUsageMetadata
}>

type AtomicAssistantResult = Readonly<{ message: ConversationMessage; created: boolean }>

export type MessagesRouteDependencies = Readonly<{
  saveTaskTimeline?: (input: { workspaceId: string; threadId: string; messageId: string; timeline: TaskTimelineMessageArtifact }) => Promise<void>
  captureUsage?: (input: Readonly<{ providerCallKey: string; event: UsageEventInput }>) => void
  credits?: Readonly<{
    createGateway?: () => Promise<CreditGateway> | CreditGateway
    reserveChatTurn(input: { workspaceId: string; clientMessageId: string; gateway?: CreditGateway }): Promise<Readonly<{ ok: true; reservationId: string }> | Readonly<{ ok: false }>>
    settleChatTurn(input: { workspaceId: string; reservationId: string; clientMessageId: string; gateway?: CreditGateway }): Promise<void>
    releaseChatTurn(input: { workspaceId: string; reservationId: string; clientMessageId: string; reason: 'PRE_PROVIDER_FAILURE'; gateway?: CreditGateway }): Promise<void>
  }>
  loadMarketingStrategy?: (input: Omit<Parameters<typeof loadConversationMarketingStrategy>[0], 'client'>) => ReturnType<typeof loadConversationMarketingStrategy>
  approveMarketingStrategy?: (input: Omit<Parameters<typeof approveConversationMarketingStrategy>[0], 'client'>) => ReturnType<typeof approveConversationMarketingStrategy>
  prepareRetry?: (input: { workspaceId: string; threadId: string; assistantMessageId: string; clientMessageId: string }) => Promise<{ attachmentIds: string[] }>
  authenticate: () => Promise<string | null>
  authorizeThread: (input: { userId: string; workspaceId: string; threadId: string }) => Promise<boolean>
  resolveWorkRef?: (input: { workspaceId: string; userId: string; workRef: string }) => Promise<import('@/features/chat/conversation-work-ref').ConversationWorkRef | null>
  resolveActorRole?: (input: { userId: string; workspaceId: string; threadId: string }) => Promise<import('@/features/auth/workspace-context').WorkspaceRole | null>
  authorizeCompatibility?: (input: { userId: string; workspaceId: string; threadId: string }) => Promise<boolean>
  createUserMessage: (input: {
    userId: string
    workspaceId: string
    threadId: string
    clientMessageId: string
    content: string
  }) => Promise<Readonly<{ message: ConversationMessage; created: boolean }>>
  findAssistantReply: (input: {
    workspaceId: string
    threadId: string
    userMessageId: string
  }) => Promise<ConversationMessage | null>
  findLatestContentInterview: (input: {
    workspaceId: string
    threadId: string
  }) => Promise<Readonly<{
    messageId: string
    userMessageId: string | null
    state: ContentInterviewState
  }> | null>
  findLatestReadyContentInterview?: (input: {
    workspaceId: string
    threadId: string
  }) => Promise<Readonly<{
    messageId: string
    userMessageId: string | null
    state: ContentInterviewState
  }> | null>
  findContentInterviewByMessage?: (input: {
    workspaceId: string
    messageId: string
  }) => Promise<Readonly<{
    messageId: string
    userMessageId: string | null
    state: ContentInterviewState
  }> | null>
  cancelContentInterview?: (input: { workspaceId: string; messageId: string }) => Promise<ContentInterviewState | null>
  completeContentInterview?: (input: { workspaceId: string; messageId: string }) => Promise<ContentInterviewState | null>
  retireContentInterview?: (input: { workspaceId: string; messageId: string }) => Promise<boolean>
  validateInterviewAttachments?: (input: { workspaceId: string; attachmentIds: readonly string[] }) => Promise<readonly string[]>
  createAssistantMessage: (input: {
    workspaceId: string
    threadId: string
    userMessageId: string
    model: string
    usageMetadata?: ContentInterviewUsageMetadata
  }) => Promise<ConversationMessage>
  createAssistantMessageAtomic: (input: {
    workspaceId: string
    threadId: string
    userMessageId: string
    assistantMessageId: string
    model: string
    usageMetadata?: ContentInterviewUsageMetadata
  }) => Promise<AtomicAssistantResult>
  buildContext: (input: { workspaceId: string; threadId: string; strict?: boolean }) => Promise<SoheeContextBundle>
  buildCompatibilityContext?: (input: { workspaceId: string; threadId: string }) => Promise<SoheeContextBundle>
  createProvider: () => Promise<Readonly<{ provider: ChatProvider; model: string }>> | Readonly<{ provider: ChatProvider; model: string }>
  createImageArtifact?: (input: {
    userId: string
    workspaceId: string
    prompt: string
    channel: ConversationImageRequest['channel']
    onUsage?(usage: UsageEventInput): void
  }) => Promise<ImageMessageArtifact>
  resolveArtifactReference?: (input: {
    workspaceId: string
    threadId: string
    replyToMessageId: string
    selectedSlideId: string
  }) => Promise<ArtifactReferenceResult>
  resolveArtifactRetryReference?: (input: {
    workspaceId: string
    threadId: string
    replyToMessageId: string
    retryFailedSlideId: string
  }) => Promise<ArtifactReferenceResult>
  createConversationArtifact?: (input: {
    userId: string
    workspaceId: string
    sourceMessageId: string
    assistantMessageId: string
    idempotencyKey: string
    prompt: string
    channel: Extract<ConversationImageRequest['channel'], 'instagram' | 'threads' | 'naver_blog'>
    count: ConversationImageRequest['count']
    generationMode?: 'api_only' | 'existing_media'
    attachmentIds?: readonly string[]
    imageSubrequest?: Readonly<{ origin: string; cookie: string }>
    onSlideProgress?(slide: ConversationArtifactSlide): void
    onTaskPhase?: ConversationArtifactWorkflowInput['onTaskPhase']
    reference?: Extract<ArtifactReferenceResult, { ok: true }>
    contentBrief?: ContentBrief
    marketingStrategy?: ConversationArtifactWorkflowInput['marketingStrategy']
    referenceMediaIds?: readonly string[]
    signal?: AbortSignal
    onUsage?(usage: UsageEventInput): void
  }) => Promise<ConversationArtifact>
  loadConversationArtifacts?: (input: {
    workspaceId: string
    messageId: string
  }) => Promise<readonly ConversationArtifact[]>
  finalizeAssistantMessage: (input: FinalizeInput) => Promise<void>
  forceFinalizeAssistantMessage: (input: FinalizeInput) => Promise<void>
  saveEvidence: (input: { workspaceId: string; messageId: string; evidence: MessageEvidenceView }) => Promise<void>
}>

const uuidSchema = z.string().uuid()
const encoder = new TextEncoder()

function candidateRequestKey(requestKey: string, position: number) {
  const hex = createHash('sha256').update(`${requestKey}:social-candidate:${position}`).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function deterministicAssistantMessageId(userMessageId: string, retryAssistantMessageId?: string) {
  const hex = createHash('sha256')
    .update(`content-interview-assistant:${userMessageId}:${retryAssistantMessageId ? `retry:${retryAssistantMessageId}` : 'initial'}`)
    .digest('hex')
    .slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

async function finalizeTerminalMessage(
  deps: MessagesRouteDependencies,
  input: FinalizeInput,
): Promise<void> {
  try {
    await deps.finalizeAssistantMessage(input)
  } catch {
    await deps.forceFinalizeAssistantMessage(input)
  }
}

function jsonError(status: number, code: string) {
  return Response.json({ error: { code } }, { status })
}

function encoded(event: object) {
  return encoder.encode(`${JSON.stringify(event)}\n`)
}

async function replay(message: ConversationMessage, deps: MessagesRouteDependencies) {
  const events: object[] = [{ type: 'message.started', messageId: message.id }]
  if (message.status === 'streaming') {
    events.push({
      type: 'message.pending',
      messageId: message.id,
      message: '응답을 준비하고 있어요. 잠시만 기다려 주세요.',
    })
  } else if (message.status === 'completed') {
    events.push({ type: 'message.delta', messageId: message.id, delta: message.content })
    if (message.clarification) {
      events.push({ type: 'message.clarification', messageId: message.id, clarification: message.clarification })
    }
    const artifact = persistedImageArtifact(message)
    if (artifact) events.push({ type: 'message.artifact', messageId: message.id, artifact })
    if (message.artifacts?.length && deps.loadConversationArtifacts) {
      const artifacts = await deps.loadConversationArtifacts({
        workspaceId: message.workspaceId,
        messageId: message.id,
      })
      for (const conversationArtifact of artifacts) {
        events.push({
          type: conversationArtifact.status === 'partial' ? 'artifact_partial' : 'artifact_ready',
          messageId: message.id,
          artifact: conversationArtifact,
        })
      }
    }
    events.push({ type: 'message.completed', messageId: message.id })
  } else {
    if (message.clarification) {
      events.push({ type: 'message.delta', messageId: message.id, delta: message.content })
      events.push({ type: 'message.clarification', messageId: message.id, clarification: message.clarification })
    }
    events.push({
      type: 'message.failed',
      messageId: message.id,
      code: message.status === 'cancelled' ? 'CHAT_CANCELLED' : 'CHAT_PROVIDER_FAILED',
      message: message.status === 'cancelled' ? '응답 생성을 중단했습니다.' : '응답을 생성하지 못했습니다.',
    })
  }

  return ndjsonResponse(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoded(event))
      controller.close()
    },
  }))
}

function ndjsonResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function statelessStream(input: {
  request: Request
  message: string
  messageId: string
  context: SoheeContextBundle
  provider: ChatProvider
}) {
  return ndjsonResponse(new ReadableStream<Uint8Array>({
    async start(controller) {
      const generationController = new AbortController()
      const abortFromRequest = () => generationController.abort()
      input.request.signal.addEventListener('abort', abortFromRequest, { once: true })
      controller.enqueue(encoded({ type: 'message.started', messageId: input.messageId }))
      let content = ''

      try {
        for await (const event of input.provider.stream({
          message: input.message,
          context: input.context,
          signal: generationController.signal,
        })) {
          if (event.type === 'text.delta') {
            content += event.delta
            controller.enqueue(encoded({
              type: 'message.delta',
              messageId: input.messageId,
              delta: event.delta,
            }))
          } else if (event.type === 'evidence') {
            controller.enqueue(encoded({ type: 'message.evidence', messageId: input.messageId, evidence: event.evidence }))
          } else if (event.type === 'artifact') {
            controller.enqueue(encoded({ type: 'message.artifact', messageId: input.messageId, artifact: event.artifact }))
          }
        }

        if (content.trim().length === 0) throw new Error('empty_chat_response')
        controller.enqueue(encoded({ type: 'message.completed', messageId: input.messageId }))
      } catch (error) {
        const cancelled = generationController.signal.aborted
          || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'OPENAI_CANCELLED')
        controller.enqueue(encoded({
          type: 'message.failed',
          messageId: input.messageId,
          code: cancelled ? 'CHAT_CANCELLED' : 'CHAT_PROVIDER_FAILED',
          message: cancelled
            ? '응답 생성을 중단했습니다.'
            : '응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        }))
      } finally {
        input.request.signal.removeEventListener('abort', abortFromRequest)
        controller.close()
      }
    },
  }))
}

function statelessImageStream(input: {
  request: Request
  messageId: string
  userId: string
  workspaceId: string
  imageRequest: ConversationImageRequest
  createImageArtifact: NonNullable<MessagesRouteDependencies['createImageArtifact']>
}) {
  return ndjsonResponse(new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoded({ type: 'message.started', messageId: input.messageId }))
      const message = '매장 이미지 기준을 적용해 초안을 만들었어요. 외부 게시 전 사장님 승인이 필요해요.'
      try {
        const artifact = await input.createImageArtifact({
          userId: input.userId,
          workspaceId: input.workspaceId,
          prompt: input.imageRequest.prompt,
          channel: input.imageRequest.channel,
        })
        controller.enqueue(encoded({ type: 'message.delta', messageId: input.messageId, delta: message }))
        controller.enqueue(encoded({ type: 'message.artifact', messageId: input.messageId, artifact }))
        controller.enqueue(encoded({ type: 'message.completed', messageId: input.messageId }))
      } catch {
        controller.enqueue(encoded({
          type: 'message.failed',
          messageId: input.messageId,
          code: 'CHAT_IMAGE_GENERATION_FAILED',
          message: '이미지 초안을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.',
        }))
      } finally {
        controller.close()
      }
    },
    cancel() {
      input.request.signal.throwIfAborted()
    },
  }))
}

function compatibilityInterviewRefusal() {
  const messageId = crypto.randomUUID()
  return ndjsonResponse(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded({ type: 'message.started', messageId }))
      controller.enqueue(encoded({
        type: 'message.failed',
        messageId,
        code: 'CHAT_PERSISTENCE_REQUIRED_FOR_INTERVIEW',
        message: '콘텐츠 방향을 안전하게 저장하려면 소희 대화 연결을 먼저 완료해 주세요.',
      }))
      controller.close()
    },
  }))
}

function interviewQuestionStream(input: {
  request: Request
  workspaceId: string
  assistant: ConversationMessage
  decision: Extract<ContentInterviewTurnDecision, { kind: 'question' }>
  finalizeAssistantMessage: MessagesRouteDependencies['finalizeAssistantMessage']
}) {
  return ndjsonResponse(new ReadableStream<Uint8Array>({
    async start(controller) {
      const generationController = new AbortController()
      const abortFromRequest = () => generationController.abort()
      const { registerActiveChatStream, unregisterActiveChatStream } = await import('@/features/chat/active-chat-streams')
      input.request.signal.addEventListener('abort', abortFromRequest, { once: true })
      if (input.request.signal.aborted) generationController.abort()
      registerActiveChatStream(input.assistant.id, generationController)
      controller.enqueue(encoded({ type: 'message.started', messageId: input.assistant.id }))
      const content = interviewResponseText(input.decision)
      controller.enqueue(encoded({ type: 'message.delta', messageId: input.assistant.id, delta: content }))
      controller.enqueue(encoded({
        type: 'message.clarification',
        messageId: input.assistant.id,
        clarification: input.decision.clarification,
      }))

      try {
        if (generationController.signal.aborted) {
          const cancelledState = terminalCancelledContentInterviewState(input.decision.state)
          await input.finalizeAssistantMessage({
            workspaceId: input.workspaceId,
            messageId: input.assistant.id,
            content: '응답 생성을 중단했습니다.',
            status: 'cancelled',
            errorCode: 'CHAT_CANCELLED',
            usageMetadata: { soheeConversationInterview: cancelledState },
          })
          controller.enqueue(encoded({
            type: 'message.failed',
            messageId: input.assistant.id,
            code: 'CHAT_CANCELLED',
            message: '응답 생성을 중단했습니다.',
          }))
          return
        }
        const cancelled = input.decision.state.status === 'cancelled'
        await input.finalizeAssistantMessage({
          workspaceId: input.workspaceId,
          messageId: input.assistant.id,
          content,
          status: cancelled ? 'cancelled' : 'completed',
          errorCode: cancelled ? 'CHAT_CANCELLED' : null,
          usageMetadata: { soheeConversationInterview: input.decision.state },
        })
        if (cancelled) {
          controller.enqueue(encoded({
            type: 'message.failed',
            messageId: input.assistant.id,
            code: 'CHAT_CANCELLED',
            message: '원하실 때 같은 대화에서 이어갈 수 있어요.',
          }))
        } else {
          controller.enqueue(encoded({ type: 'message.completed', messageId: input.assistant.id }))
        }
      } catch {
        controller.enqueue(encoded({
          type: 'message.failed',
          messageId: input.assistant.id,
          code: 'CHAT_PROVIDER_FAILED',
          message: '응답을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        }))
      } finally {
        input.request.signal.removeEventListener('abort', abortFromRequest)
        unregisterActiveChatStream(input.assistant.id, generationController)
        controller.close()
      }
    },
  }))
}

export function createMessagesPostHandler(deps: MessagesRouteDependencies) {
  return async function post(request: Request, context: RouteContext): Promise<Response> {
    const contentLength = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > 32_000) {
      return jsonError(413, 'CHAT_REQUEST_TOO_LARGE')
    }

    let rawBody: unknown
    let preparedReadyAssistant: ConversationMessage | null = null
    let preparedReadyDecision: Extract<ContentInterviewTurnDecision, { kind: 'ready_to_generate' }> | null = null
    let preparedCreditReservation: Awaited<ReturnType<NonNullable<MessagesRouteDependencies['credits']>['reserveChatTurn']>> | null = null
    let preparedCreditGateway: CreditGateway | undefined
    let preparedCreditReleased = false
    let preparedCreditSettled = false
    let releasePreparedCredit: () => Promise<void> = async () => undefined
    let settlePreparedCredit: () => Promise<void> = async () => undefined
    let preparedSourceInterviewMessageId: string | null = null
    try {
      rawBody = await request.json()
    } catch {
      return jsonError(400, 'CHAT_REQUEST_INVALID')
    }

    const body = chatRequestSchema.safeParse(rawBody)
    const rawParams = await context.params
    const workspaceId = uuidSchema.safeParse(rawParams.workspaceId)
    const threadId = uuidSchema.safeParse(rawParams.threadId)
    if (!body.success || !workspaceId.success || !threadId.success) {
      return jsonError(400, 'CHAT_REQUEST_INVALID')
    }

    const userId = await deps.authenticate()
    if (userId === null) return jsonError(401, 'AUTH_REQUIRED')

    const allowed = await deps.authorizeThread({
      userId,
      workspaceId: workspaceId.data,
      threadId: threadId.data,
    })
    const compatibilityAllowed = !allowed && deps.authorizeCompatibility
      ? await deps.authorizeCompatibility({
        userId,
        workspaceId: workspaceId.data,
        threadId: threadId.data,
      })
      : false
    if (!allowed && !compatibilityAllowed) return jsonError(403, 'CHAT_THREAD_FORBIDDEN')

    if (body.data.retryAssistantMessageId) {
      if (!allowed || !deps.prepareRetry) return jsonError(409, 'CHAT_RETRY_RECONCILIATION_REQUIRED')
      try {
        const retry = await deps.prepareRetry({ workspaceId: workspaceId.data, threadId: threadId.data,
          assistantMessageId: body.data.retryAssistantMessageId, clientMessageId: body.data.clientMessageId })
        body.data.attachmentIds = z.array(uuidSchema).max(20).parse(retry.attachmentIds)
      } catch {
        return jsonError(409, 'CHAT_RETRY_RECONCILIATION_REQUIRED')
      }
    }

    let selectedContent: import('@/features/chat/conversation-work-ref').ConversationWorkRef | null = null
    if (body.data.workRef) {
      if (!allowed || !deps.resolveWorkRef) return jsonError(409, 'CHAT_WORK_REF_UNAVAILABLE')
      selectedContent = await deps.resolveWorkRef({ workspaceId: workspaceId.data, userId, workRef: body.data.workRef })
      if (!selectedContent) return jsonError(409, 'CHAT_WORK_REF_STALE')
      const { routeConversationRequest } = await import('@/features/chat/conversation-runtime-router')
      if (routeConversationRequest(body.data.content).kind === 'existing_flow' || body.data.attachmentIds.length
        || body.data.replyToMessageId || body.data.marketingStrategy || body.data.marketingStrategyApproval
        || parseConversationImageRequest(body.data.content) || parseConversationPostRequest(body.data.content)) {
        return jsonError(409, 'CHAT_WORK_REVIEW_ONLY')
      }
    }

    let marketingStrategy: Awaited<ReturnType<typeof loadConversationMarketingStrategy>> | undefined
    if (body.data.marketingStrategyApproval || body.data.marketingStrategy) {
      if (!allowed) return jsonError(409, 'CHAT_STRATEGY_PERSISTENCE_REQUIRED')
      try {
        if (body.data.marketingStrategyApproval) {
          if (!deps.approveMarketingStrategy) return jsonError(409, 'CHAT_STRATEGY_UNAVAILABLE')
          const approved = await deps.approveMarketingStrategy({
            ...body.data.marketingStrategyApproval, userId, workspaceId: workspaceId.data, threadId: threadId.data,
          })
          return Response.json({ strategy: { briefId: approved.id, revision: approved.revision,
            missionId: approved.lineage.missionId, runId: approved.lineage.runId } })
        }
        if (!deps.loadMarketingStrategy) return jsonError(409, 'CHAT_STRATEGY_UNAVAILABLE')
        marketingStrategy = await deps.loadMarketingStrategy({ ...body.data.marketingStrategy!,
          workspaceId: workspaceId.data, threadId: threadId.data })
      } catch {
        return jsonError(409, 'CHAT_STRATEGY_UNAVAILABLE')
      }
    }

    const imageRequest = parseConversationImageRequest(body.data.content)
    const parsedPostRequest = parseConversationPostRequest(body.data.content)
    // 당근은 API·생성기가 없어 인터뷰·생성 대상에서 뺀다(당근만 요청하면 일반 대화로 처리해 헛 과금을 막는다).
    const postRequest = withoutManualOnlyChannels(parsedPostRequest)
    if (marketingStrategy && postRequest?.candidates.some((candidate) => candidate.channel !== 'naver_blog')) {
      return jsonError(422, 'CHAT_STRATEGY_CHANNEL_UNSUPPORTED')
    }
    let artifactReference: Extract<ArtifactReferenceResult, { ok: true }> | undefined
    if (body.data.replyToMessageId && body.data.selectedSlideId) {
      if (!deps.resolveArtifactReference) return jsonError(404, 'CHAT_ARTIFACT_NOT_FOUND')
      try {
        const resolved = await deps.resolveArtifactReference({
          workspaceId: workspaceId.data,
          threadId: threadId.data,
          replyToMessageId: body.data.replyToMessageId,
          selectedSlideId: body.data.selectedSlideId,
        })
        if (!resolved.ok) return jsonError(404, 'CHAT_ARTIFACT_NOT_FOUND')
        artifactReference = resolved
      } catch {
        return jsonError(404, 'CHAT_ARTIFACT_NOT_FOUND')
      }
    } else if (body.data.replyToMessageId && body.data.retryFailedSlideId) {
      if (!deps.resolveArtifactRetryReference) return jsonError(404, 'CHAT_ARTIFACT_NOT_FOUND')
      try {
        const resolved = await deps.resolveArtifactRetryReference({
          workspaceId: workspaceId.data,
          threadId: threadId.data,
          replyToMessageId: body.data.replyToMessageId,
          retryFailedSlideId: body.data.retryFailedSlideId,
        })
        if (!resolved.ok) return jsonError(404, 'CHAT_ARTIFACT_NOT_FOUND')
        artifactReference = resolved
      } catch {
        return jsonError(404, 'CHAT_ARTIFACT_NOT_FOUND')
      }
    }

    if (compatibilityAllowed && postRequest) {
      return compatibilityInterviewRefusal()
    }

    if (compatibilityAllowed && deps.buildCompatibilityContext) {
      try {
        if (imageRequest && deps.createImageArtifact) {
          return statelessImageStream({
            request,
            messageId: crypto.randomUUID(),
            userId,
            workspaceId: workspaceId.data,
            imageRequest,
            createImageArtifact: deps.createImageArtifact,
          })
        }
        const [providerConfig, groundedContext] = await Promise.all([
          deps.createProvider(),
          deps.buildCompatibilityContext({
            workspaceId: workspaceId.data,
            threadId: threadId.data,
          }),
        ])
        return statelessStream({
          request,
          message: body.data.content,
          messageId: crypto.randomUUID(),
          context: groundedContext,
          provider: providerConfig.provider,
        })
      } catch {
        return jsonError(503, 'CHAT_UNAVAILABLE')
      }
    }

    try {
      const user = await deps.createUserMessage({
        userId,
        workspaceId: workspaceId.data,
        threadId: threadId.data,
        clientMessageId: body.data.clientMessageId,
        content: body.data.displayContent ?? body.data.content,
      })
      const existing = await deps.findAssistantReply({
        workspaceId: workspaceId.data,
        threadId: threadId.data,
        userMessageId: user.message.id,
      })
      const retryingExisting = existing
        && body.data.retryAssistantMessageId === existing.id
        && (existing.status === 'failed' || existing.status === 'cancelled')
      if (existing && !retryingExisting) return await replay(existing, deps)
      if (retryingExisting && existing?.clarification && !deps.findContentInterviewByMessage) {
        return jsonError(503, 'CHAT_PERSISTENCE_REQUIRED_FOR_INTERVIEW')
      }

      // 회수 요청 처리 (Task 9: full conversation에서도 단일 durable case 및 adapter 연동)
      const { isRecoveryIntent, handleRecoveryConversation } = await import('@/features/booking-recovery/conversation-adapter')
      if (isRecoveryIntent(body.data.content)) {
        const actorScope = { workspaceId: workspaceId.data, threadId: threadId.data, userId }
        const initialRole = await deps.resolveActorRole?.(actorScope)
        if (initialRole !== 'owner' && initialRole !== 'manager') return jsonError(403, 'CHAT_RECOVERY_FORBIDDEN')
        const assistantResult = await deps.createAssistantMessageAtomic({
          workspaceId: workspaceId.data, threadId: threadId.data, userMessageId: user.message.id,
          assistantMessageId: deterministicAssistantMessageId(user.message.id), model: 'booking-recovery-v1',
        })
        if (!assistantResult.created) return await replay(assistantResult.message, deps)
        const currentRole = await deps.resolveActorRole?.(actorScope)
        if (currentRole !== 'owner' && currentRole !== 'manager') {
          await finalizeTerminalMessage(deps, { workspaceId: workspaceId.data, messageId: assistantResult.message.id,
            content: '현재 회수 업무 권한을 확인하지 못했어요.', status: 'failed', errorCode: 'CHAT_RECOVERY_FORBIDDEN' })
          return jsonError(403, 'CHAT_RECOVERY_FORBIDDEN')
        }
        const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
        const { createProductionBookingRecoveryService } = await import('@/features/booking-recovery/production')
        const adminClient = createAdminSupabaseClient()
        const recoveryService = createProductionBookingRecoveryService(adminClient)

        const recoveryActor = {
          workspaceId: workspaceId.data,
          userId,
          role: currentRole,
        }

        const recoveryResult = await handleRecoveryConversation(
          {
            actor: recoveryActor,
            message: body.data.content,
          },
          { service: recoveryService }
        )

        return ndjsonResponse(new ReadableStream({
          async start(controller) {
            controller.enqueue(encoded({ type: 'message.started', messageId: assistantResult.message.id }))

            if (recoveryResult.type === 'recovery.updated') {
              const replyText = `💌 고객님의 예약 문의 상태입니다. 아래 내용과 조건을 확인해 주세요.`
              controller.enqueue(encoded({ type: 'message.delta', messageId: assistantResult.message.id, delta: replyText }))
              controller.enqueue(encoded({
                type: 'recovery.updated',
                messageId: assistantResult.message.id,
                caseId: recoveryResult.caseId,
                missionId: recoveryResult.missionId,
                version: recoveryResult.version,
                view: recoveryResult.view,
              }))
              await finalizeTerminalMessage(deps, {
                workspaceId: workspaceId.data,
                messageId: assistantResult.message.id,
                content: replyText,
                status: 'completed',
                errorCode: null,
              })
              controller.enqueue(encoded({ type: 'message.completed', messageId: assistantResult.message.id }))
            } else if (recoveryResult.type === 'recovery.selection') {
              const replyText = `💌 대기 중인 예약 문의가 ${recoveryResult.cases.length}건 있습니다. 처리하실 문의를 선택해 주세요.`
              controller.enqueue(encoded({ type: 'message.delta', messageId: assistantResult.message.id, delta: replyText }))
              await finalizeTerminalMessage(deps, {
                workspaceId: workspaceId.data,
                messageId: assistantResult.message.id,
                content: replyText,
                status: 'completed',
                errorCode: null,
              })
              controller.enqueue(encoded({ type: 'message.completed', messageId: assistantResult.message.id }))
            } else {
              const replyText = recoveryResult.message || '현재 대기 중인 예약 문의가 없습니다.'
              controller.enqueue(encoded({ type: 'message.delta', messageId: assistantResult.message.id, delta: replyText }))
              await finalizeTerminalMessage(deps, {
                workspaceId: workspaceId.data,
                messageId: assistantResult.message.id,
                content: replyText,
                status: 'completed',
                errorCode: null,
              })
              controller.enqueue(encoded({ type: 'message.completed', messageId: assistantResult.message.id }))
            }
            controller.close()
          }
        }))
      }

      if (!deps.findLatestContentInterview && postRequest) {
        return jsonError(503, 'CHAT_PERSISTENCE_REQUIRED_FOR_INTERVIEW')
      }
      const activeInterview = deps.findLatestContentInterview
        ? await deps.findLatestContentInterview({
          workspaceId: workspaceId.data,
          threadId: threadId.data,
        })
        : null
      const readyInterview = deps.findLatestReadyContentInterview
        ? await deps.findLatestReadyContentInterview({
          workspaceId: workspaceId.data,
          threadId: threadId.data,
        })
        : null
      const retryInterview = retryingExisting && deps.findContentInterviewByMessage
        ? await deps.findContentInterviewByMessage({ workspaceId: workspaceId.data, messageId: existing.id })
        : null
      if (retryingExisting && existing?.clarification && !retryInterview) {
        return jsonError(503, 'CHAT_INTERVIEW_RETRY_UNAVAILABLE')
      }
      const interviewState = retryInterview?.state ?? readyInterview?.state ?? activeInterview?.state ?? null
      if ((postRequest || interviewState) && body.data.attachmentIds.length > 0) {
        if (!deps.validateInterviewAttachments) return jsonError(503, 'CHAT_PERSISTENCE_REQUIRED_FOR_INTERVIEW')
        try {
          await deps.validateInterviewAttachments({
            workspaceId: workspaceId.data,
            attachmentIds: body.data.attachmentIds,
          })
        } catch {
          return jsonError(422, 'CHAT_ATTACHMENT_NOT_ALLOWED')
        }
      }
      let strategyReference = body.data.marketingStrategy
      const interviewStrategy = !postRequest && !artifactReference ? interviewState?.marketingStrategy : undefined
      if (strategyReference && interviewStrategy
        && (strategyReference.missionId !== interviewStrategy.missionId
          || strategyReference.runId !== interviewStrategy.runId
          || strategyReference.briefId !== interviewStrategy.briefId
          || strategyReference.revision !== interviewStrategy.revision)) {
        return jsonError(409, 'CHAT_STRATEGY_INTERVIEW_MISMATCH')
      }
      if (!strategyReference && !postRequest && !artifactReference && interviewState?.marketingStrategy) {
        strategyReference = interviewState.marketingStrategy
        try {
          if (!deps.loadMarketingStrategy) return jsonError(409, 'CHAT_STRATEGY_UNAVAILABLE')
          marketingStrategy = await deps.loadMarketingStrategy({ ...strategyReference,
            workspaceId: workspaceId.data, threadId: threadId.data })
        } catch {
          return jsonError(409, 'CHAT_STRATEGY_UNAVAILABLE')
        }
      }
      let interviewDecision: ContentInterviewTurnDecision = retryInterview
        ? {
          kind: 'ready_to_generate',
          state: retryInterview.state,
          brief: retryInterview.state.brief as ContentBrief,
          generate: true,
        }
        : decideContentInterviewTurn({
          active: readyInterview?.state ?? activeInterview?.state ?? null,
          parsedPostRequest: postRequest,
          userContent: body.data.content,
          attachmentIds: body.data.attachmentIds,
          replyToMessageId: body.data.replyToMessageId,
          selectedSlideId: body.data.selectedSlideId,
          retryFailedSlideId: body.data.retryFailedSlideId,
          retryAssistantMessageId: body.data.retryAssistantMessageId,
        })

      if (strategyReference && interviewDecision.kind !== 'not_interview') {
        if (interviewDecision.state.channels.some((channel) => channel !== 'naver_blog')) {
          return jsonError(422, 'CHAT_STRATEGY_CHANNEL_UNSUPPORTED')
        }
        interviewDecision = { ...interviewDecision,
          state: Object.freeze({ ...interviewDecision.state, marketingStrategy: strategyReference }) }
      } else if (marketingStrategy && !postRequest?.candidates.every((candidate) => candidate.channel === 'naver_blog')) {
        return jsonError(422, 'CHAT_STRATEGY_CHANNEL_UNSUPPORTED')
      }

      if (interviewDecision.kind === 'question') {
        if (readyInterview && interviewDecision.state.status === 'collecting' && deps.retireContentInterview) {
          await deps.retireContentInterview({
            workspaceId: workspaceId.data,
            messageId: readyInterview.messageId,
          })
        }
        if (interviewDecision.state.status === 'cancelled' && activeInterview) {
          if (!deps.cancelContentInterview) return jsonError(503, 'CHAT_PERSISTENCE_REQUIRED_FOR_INTERVIEW')
          const cancelled = await deps.cancelContentInterview({
            workspaceId: workspaceId.data,
            messageId: activeInterview.messageId,
          })
          if (cancelled === null) return jsonError(503, 'CHAT_INTERVIEW_CANCEL_FAILED')
        }
        const assistantResult = await deps.createAssistantMessageAtomic({
          workspaceId: workspaceId.data,
          threadId: threadId.data,
          userMessageId: user.message.id,
          assistantMessageId: deterministicAssistantMessageId(user.message.id),
          model: 'content-interview-v1',
          usageMetadata: { soheeConversationInterview: interviewDecision.state },
        })
        if (!assistantResult.created) return await replay(assistantResult.message, deps)
        return interviewQuestionStream({
          request,
          workspaceId: workspaceId.data,
          assistant: assistantResult.message,
          decision: interviewDecision,
          finalizeAssistantMessage: (input) => finalizeTerminalMessage(deps, input),
        })
      }

      const interviewReadyDecision = interviewDecision.kind === 'ready_to_generate'
        ? interviewDecision
        : null
      const interviewReady = interviewReadyDecision !== null
      const generationAttachmentIds = interviewReady
        ? interviewReadyDecision!.state.referenceMediaIds
        : body.data.attachmentIds
      const generationPrompt = interviewReady
        ? interviewReadyDecision!.state.originalPrompt
        : body.data.content
      const originalPhotoRequested = requestsAttachedMediaReuse(generationPrompt)
      if (originalPhotoRequested && generationAttachmentIds.length === 0) return jsonError(422, 'CHAT_SOURCE_PHOTO_REQUIRED')
      const reuseAttachedOriginals = generationAttachmentIds.length > 0 && originalPhotoRequested
      const requestedChannels = interviewReadyDecision?.state.channels ?? postRequest?.candidates.map(candidate => candidate.channel) ?? (imageRequest ? [imageRequest.channel] : [])
      if (reuseAttachedOriginals && generationAttachmentIds.length > 3 && requestedChannels.some(channel => channel === 'instagram' || channel === 'threads')) {
        return jsonError(422, 'CHAT_ATTACHED_MEDIA_COUNT_UNSUPPORTED')
      }
      if (reuseAttachedOriginals && interviewReadyDecision && interviewReadyDecision.state.channels.some(channel => interviewReadyDecision.state.requestedImageCounts[channel] !== generationAttachmentIds.length)) {
        return jsonError(422, 'CHAT_PHOTO_PLAN_CHANGED')
      }
      const readyAssistantResult = interviewReadyDecision
        ? await deps.createAssistantMessageAtomic({
          workspaceId: workspaceId.data,
          threadId: threadId.data,
          userMessageId: user.message.id,
          assistantMessageId: deterministicAssistantMessageId(
            user.message.id,
            retryInterview ? body.data.retryAssistantMessageId : undefined,
          ),
          model: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-sunburst',
          usageMetadata: { soheeConversationInterview: interviewReadyDecision.state },
        })
        : null
      if (readyAssistantResult && !readyAssistantResult.created) return await replay(readyAssistantResult.message, deps)
      const readyAssistant = readyAssistantResult?.message ?? null
      preparedReadyAssistant = readyAssistant
      preparedReadyDecision = interviewReadyDecision
      preparedSourceInterviewMessageId = retryInterview?.messageId ?? readyInterview?.messageId ?? null
      if (readyAssistantResult && activeInterview && !readyInterview && !retryInterview && deps.retireContentInterview) {
        await deps.retireContentInterview({ workspaceId: workspaceId.data, messageId: activeInterview.messageId })
      }

      const creditGateway = deps.credits?.createGateway
        ? await deps.credits.createGateway()
        : undefined
      preparedCreditGateway = creditGateway
      const creditReservation = deps.credits
        ? await deps.credits.reserveChatTurn({ workspaceId: workspaceId.data, clientMessageId: body.data.clientMessageId, gateway: creditGateway })
        : null
      preparedCreditReservation = creditReservation
      releasePreparedCredit = async () => {
        if (preparedCreditReleased || preparedCreditSettled || !preparedCreditReservation?.ok || !deps.credits) return
        preparedCreditReleased = true
        await deps.credits.releaseChatTurn({
          workspaceId: workspaceId.data,
          reservationId: preparedCreditReservation.reservationId,
          clientMessageId: body.data.clientMessageId,
          reason: 'PRE_PROVIDER_FAILURE',
          gateway: preparedCreditGateway,
        }).catch(() => undefined)
      }
      settlePreparedCredit = async () => {
        if (preparedCreditReleased || preparedCreditSettled || !preparedCreditReservation?.ok || !deps.credits) return
        preparedCreditSettled = true
        await deps.credits.settleChatTurn({
          workspaceId: workspaceId.data,
          reservationId: preparedCreditReservation.reservationId,
          clientMessageId: body.data.clientMessageId,
          gateway: preparedCreditGateway,
        })
      }
      if (creditReservation && !creditReservation.ok) {
        if (readyAssistant && interviewReady) {
          await finalizeTerminalMessage(deps, {
            workspaceId: workspaceId.data,
            messageId: readyAssistant.id,
            content: '콘텐츠 방향은 보존했지만 생성을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            status: 'failed',
            errorCode: 'CHAT_CREDIT_UNAVAILABLE',
            usageMetadata: { soheeConversationInterview: interviewReadyDecision.state },
          })
        }
        return jsonError(503, 'CHAT_CREDIT_UNAVAILABLE')
      }

      const generationPostRequest = interviewReady
        ? postRequestFromInterviewState(interviewReadyDecision!.state)
        : withoutManualOnlyChannels(postRequest)
      const generationImageRequest = interviewReady ? null : imageRequest
      const structuredImageRequest = generationImageRequest
        && (generationImageRequest.channel === 'instagram' || generationImageRequest.channel === 'threads' || generationImageRequest.channel === 'naver_blog')
        ? generationImageRequest
        : null
      const isMultiChannelPost = new Set(generationPostRequest?.candidates.map((candidate) => candidate.channel) ?? []).size > 1
      const artifactCandidates = generationPostRequest?.candidates.map((candidate) => Object.freeze({
        ...candidate,
        count: reuseAttachedOriginals || (candidate.channel === 'naver_blog' && !interviewReady && generationAttachmentIds.length > 0)
          ? generationAttachmentIds.length as ConversationImageRequest['count']
          : candidate.channel === 'naver_blog'
            ? candidate.count
          : isMultiChannelPost && candidate.channel === 'threads'
            ? 1 as const
            : isMultiChannelPost && candidate.channel === 'instagram' && structuredImageRequest
              ? Math.min(structuredImageRequest.count, 3) as ConversationImageRequest['count']
          : structuredImageRequest?.channel === candidate.channel
            ? structuredImageRequest.count
          : candidate.count,
      })) ?? (structuredImageRequest ? [Object.freeze({
          channel: structuredImageRequest.channel,
          count: structuredImageRequest.count,
          direction: null,
          instruction: '',
        })] : [])
      if (interviewReady) {
        const naverCandidate = artifactCandidates.find((candidate) => candidate.channel === 'naver_blog')
        if (naverCandidate && generationAttachmentIds.length > 0 && naverCandidate.count !== generationAttachmentIds.length) {
          throw new Error('CHAT_REFERENCE_MEDIA_COUNT_MISMATCH')
        }
      }
      let providerConfig: Awaited<ReturnType<MessagesRouteDependencies['createProvider']>> | null
      try {
        providerConfig = (artifactCandidates.length > 0 && deps.createConversationArtifact)
          || (generationImageRequest && deps.createImageArtifact)
            ? null
          : await deps.createProvider()
      } catch {
        await releasePreparedCredit()
        throw new Error('chat_provider_unavailable')
      }
      const groundedContext = providerConfig
        ? { ...await deps.buildContext({ workspaceId: workspaceId.data, threadId: threadId.data }),
          ...(selectedContent ? { selectedContent } : {}) }
        : null
      const assistant = readyAssistant ?? await deps.createAssistantMessage({
        workspaceId: workspaceId.data,
        threadId: threadId.data,
        userMessageId: user.message.id,
        model: providerConfig?.model ?? process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-sunburst',
      })

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let content = ''
          let completedArtifact: FinalizeInput['artifact']
          let usagePosition = 0
          const captureUsage = (event: UsageEventInput) => {
            usagePosition += 1
            deps.captureUsage?.({
              providerCallKey: `${assistant.id}:${event.operation}:${usagePosition}`,
              event,
            })
          }
          const generationController = new AbortController()
          const { registerActiveChatStream, unregisterActiveChatStream } = await import('@/features/chat/active-chat-streams')
          const abortFromRequest = () => generationController.abort()
          request.signal.addEventListener('abort', abortFromRequest, { once: true })
          registerActiveChatStream(assistant.id, generationController)
          controller.enqueue(encoded({ type: 'message.started', messageId: assistant.id }))
          const tasks = createTaskTracker(assistant.id, async timeline => {
            await deps.saveTaskTimeline?.({ workspaceId: workspaceId.data, threadId: threadId.data, messageId: assistant.id, timeline })
              .catch(() => console.warn('[sohee:task-timeline-persistence-unavailable]'))
            controller.enqueue(encoded({ type: 'task_progress', messageId: assistant.id, timeline }))
          })

          try {
            const prepareTitle = artifactCandidates.length ? '문안·이미지 결과물 준비' : imageRequest ? '이미지 초안 준비' : '확인된 자료로 답변 작성'
            await tasks.plan([{ id: 'prepare', title: prepareTitle },
              ...artifactCandidates.flatMap((_, index) => Object.entries({ facts: '가게 정보·승인 사실 확인', draft: '문안 작성·사실 표현 검수', images: '이미지 결과 준비', save: '결과물 저장' })
                .map(([phase, title]) => ({ id: `candidate-${index}-${phase}`, title: `${index + 1}안 · ${title}` }))),
              { id: 'save', title: '대화 결과 저장·검토 준비' }])
            await tasks.start('prepare', prepareTitle)
            if (artifactCandidates.length > 0 && deps.createConversationArtifact) {
              const artifacts: ConversationArtifact[] = []
              const streamedSlideIds = new Set<string>()
              for (const [index, candidate] of artifactCandidates.entries()) {
                const useImageSubrequests = candidate.channel === 'naver_blog'
                  && !artifactReference
                  && candidate.count > 1
                  && generationAttachmentIds.length === 0
                  && !(candidate.channel === 'naver_blog' && requestsExistingNaverMedia(generationPrompt))
                const artifact = await deps.createConversationArtifact({
                  userId,
                  workspaceId: workspaceId.data,
                  sourceMessageId: user.message.id,
                  assistantMessageId: assistant.id,
                  idempotencyKey: artifactCandidates.length === 1
                    ? body.data.clientMessageId
                    : candidateRequestKey(body.data.clientMessageId, index + 1),
                  prompt: candidate.instruction
                    ? `${generationPostRequest?.prompt ?? generationPrompt}\n\n제안 방향: ${candidate.instruction}`
                    : structuredImageRequest?.prompt ?? generationPrompt,
                  channel: artifactReference
                    ? artifactReference.artifact.type === 'threads_post'
                      ? 'threads'
                      : artifactReference.artifact.type === 'naver_blog_post'
                        ? 'naver_blog'
                        : 'instagram'
                    : candidate.channel,
                  count: candidate.count,
                  ...(reuseAttachedOriginals ? { generationMode: 'existing_media' as const } : candidate.channel === 'naver_blog' ? {
                    generationMode: generationAttachmentIds.length === 0
                      && !requestsExistingNaverMedia(generationPrompt)
                      ? 'api_only' as const
                      : 'existing_media' as const,
                  } : {}),
                  ...((candidate.channel === 'naver_blog' || reuseAttachedOriginals) && generationAttachmentIds.length > 0
                    ? { attachmentIds: generationAttachmentIds }
                    : {}),
                  ...(useImageSubrequests ? {
                    imageSubrequest: {
                      origin: new URL(request.url).origin,
                      cookie: request.headers.get('cookie') ?? '',
                    },
                    onSlideProgress: (slide) => {
                      streamedSlideIds.add(slide.id)
                      controller.enqueue(encoded({
                        type: 'slide_progress',
                        messageId: assistant.id,
                        slideId: slide.id,
                        position: slide.position,
                        status: slide.status,
                      }))
                    },
                  } : {}),
                  ...(artifactReference ? { reference: artifactReference } : {}),
                  ...(marketingStrategy ? { marketingStrategy } : {}),
                  ...(interviewReady ? {
                    contentBrief: interviewReadyDecision!.brief,
                    referenceMediaIds: interviewReadyDecision!.state.referenceMediaIds,
                  } : {}),
                  onTaskPhase: async (phase, state, detail) => {
                    const id = `candidate-${index}-${phase}`
                    const titles = { facts: '가게 정보·승인 사실 확인', draft: '문안 작성·사실 표현 검수', images: '이미지 결과 준비', save: '결과물 저장' }
                    const text = [
                      ...(detail?.sampleSize !== undefined ? [`승인 사실 ${detail.sampleSize}건`] : []),
                      ...(detail?.coverage ? [`이미지 ${detail.coverage.covered}/${detail.coverage.total}`] : []),
                    ].join(' · ')
                    if (state === 'started') await tasks.start(id, `${index + 1}안 · ${titles[phase]}`)
                    else if (state === 'incomplete') await tasks.incomplete(id, text || '일부만 확인')
                    else await tasks.complete(id, text || undefined)
                  },
                  onUsage: captureUsage,
                  signal: generationController.signal,
                })
                artifacts.push(artifact)
              }
              if (artifacts.length === 0 || artifacts.some((artifact) => artifact.status === 'failed')) {
                throw Object.assign(new Error('CHAT_ARTIFACT_FAILED'), { code: 'CHAT_ARTIFACT_FAILED' })
              }
              content = artifacts.some((artifact) => artifact.status === 'partial')
                ? '일부 이미지를 만들지 못했지만 완료된 결과를 보존했어요. 각 채널의 완성 게시물 형태로 비교할 수 있어요.'
                : artifacts.length > 1
                  ? 'Instagram과 Threads에 실제로 올라갈 형태로 포스팅 방향을 준비했어요. 비교한 뒤 하나를 선택해 검토해 주세요.'
                  : '채널에 실제로 올라갈 문안과 이미지 결과물을 준비했어요. 외부 게시 전 검토와 승인이 필요해요.'
              controller.enqueue(encoded({ type: 'message.delta', messageId: assistant.id, delta: content }))
              for (const artifact of artifacts) {
                controller.enqueue(encoded({
                  type: 'artifact_created',
                  messageId: assistant.id,
                  artifactId: artifact.id,
                  requestedCount: artifact.slides.length,
                }))
                for (const slide of artifact.slides) {
                  if (streamedSlideIds.has(slide.id)) continue
                  controller.enqueue(encoded({
                    type: 'slide_progress',
                    messageId: assistant.id,
                    slideId: slide.id,
                    position: slide.position,
                    status: slide.status,
                  }))
                }
                controller.enqueue(encoded({
                  type: artifact.status === 'partial' ? 'artifact_partial' : 'artifact_ready',
                  messageId: assistant.id,
                  artifact,
                }))
              }
            } else if (imageRequest && deps.createImageArtifact) {
              const artifact = await deps.createImageArtifact({
                userId,
                workspaceId: workspaceId.data,
                prompt: imageRequest.prompt,
                channel: imageRequest.channel,
                onUsage: captureUsage,
              })
              content = '매장 이미지 기준을 적용해 초안을 만들었어요. 외부 게시 전 사장님 승인이 필요해요.'
              controller.enqueue(encoded({ type: 'message.delta', messageId: assistant.id, delta: content }))
              controller.enqueue(encoded({ type: 'message.artifact', messageId: assistant.id, artifact }))
              completedArtifact = { type: 'media_asset', id: artifact.id }
            } else if (providerConfig && groundedContext) {
              for await (const event of providerConfig.provider.stream({
                message: body.data.content,
                context: groundedContext,
                signal: generationController.signal,
              })) {
                if (event.type === 'text.delta') {
                  content += event.delta
                  controller.enqueue(encoded({
                    type: 'message.delta',
                    messageId: assistant.id,
                    delta: event.delta,
                  }))
                } else if (event.type === 'evidence') {
                  await deps.saveEvidence({
                    workspaceId: workspaceId.data,
                    messageId: assistant.id,
                    evidence: event.evidence,
                  })
                  controller.enqueue(encoded({
                    type: 'message.evidence',
                    messageId: assistant.id,
                    evidence: event.evidence,
                  }))
                } else if (event.type === 'artifact') {
                  controller.enqueue(encoded({
                    type: 'message.artifact',
                    messageId: assistant.id,
                    artifact: event.artifact,
                  }))
                } else if (event.type === 'usage') {
                  captureUsage(event.usage)
                }
              }
            }

            if (content.trim().length === 0) throw new Error('empty_chat_response')
            await tasks.complete('prepare')
            await tasks.start('save', '대화 결과 저장·검토 준비')
            if (interviewReady && preparedSourceInterviewMessageId && deps.completeContentInterview) {
              await deps.completeContentInterview({
                workspaceId: workspaceId.data,
                messageId: preparedSourceInterviewMessageId,
              }).catch(() => undefined)
            }
            const completedInterviewState = interviewReady
              ? Object.freeze({
                ...interviewReadyDecision!.state,
                status: 'completed' as const,
              })
              : undefined
            await finalizeTerminalMessage(deps, {
              workspaceId: workspaceId.data,
              messageId: assistant.id,
              content,
              status: 'completed',
              errorCode: null,
              ...(completedArtifact ? { artifact: completedArtifact } : {}),
              ...(completedInterviewState
                ? { usageMetadata: { soheeConversationInterview: completedInterviewState } }
                : {}),
            })
            try {
              await settlePreparedCredit()
            } catch {
              // The message is already terminal and must remain completed. Credit
              // settlement is idempotent and can be reconciled independently.
            }
            await tasks.complete('save')
            await tasks.stop('completed')
            controller.enqueue(encoded({ type: 'message.completed', messageId: assistant.id }))
          } catch (error) {
            const cancelled = generationController.signal.aborted
              || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'OPENAI_CANCELLED')
            // 허용된 이유만 사용자용 안내로 변환하고 예외 본문이나 원고는 노출하지 않는다.
            const reason = error instanceof Error ? error.message : null
            const factFailure = reason === 'NAVER_CLAIMS_NEED_REVIEW'
              ? { code: 'CHAT_FACT_REVIEW_REQUIRED', message: '확인되지 않은 정보가 있어 원고 생성을 멈췄어요. 나의 지식에서 가격·경력·후기 등의 출처와 유효기간을 확인하고 승인한 뒤 다시 작성해 주세요.' }
              : reason === 'FACT_SNAPSHOT_STALE'
                ? { code: 'CHAT_FACTS_CHANGED', message: '작성 중 승인된 정보가 바뀌어 원고를 저장하지 않았어요. 나의 지식에서 최신 정보를 확인한 뒤 다시 작성해 주세요.' }
                : reason === 'NAVER_FACTS_UNAVAILABLE'
                  ? { code: 'CHAT_FACTS_UNAVAILABLE', message: '승인된 정보를 불러오지 못해 원고 생성을 멈췄어요. 잠시 후 다시 시도해 주세요.' }
                  : null
            const imageFailure = imageFailureForUser(error)
            const failureMessage = cancelled
              ? '응답 생성을 중단했습니다.'
              : factFailure?.message ?? imageFailure?.message ?? '응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.'
            const errorCode = cancelled
              ? 'CHAT_CANCELLED'
              : imageFailure
                ? imageFailure.code
              : factFailure
                ? factFailure.code
              : typeof error === 'object' && error !== null && 'code' in error
                && (error.code === 'CHAT_ARTIFACT_FAILED' || error.code === 'CHAT_REFERENCE_MEDIA_COUNT_MISMATCH')
                ? error.code
                : 'CHAT_PROVIDER_FAILED'
            const interviewFailureState = interviewReady
              ? cancelled
                ? terminalCancelledContentInterviewState(interviewReadyDecision!.state)
                : interviewReadyDecision!.state
              : undefined
            await releasePreparedCredit()
            await finalizeTerminalMessage(deps, {
              workspaceId: workspaceId.data,
              messageId: assistant.id,
              content: factFailure && !cancelled ? failureMessage : content.trim() || (cancelled ? '응답 생성을 중단했습니다.' : '응답 생성에 실패했습니다.'),
              status: cancelled ? 'cancelled' : 'failed',
              errorCode,
              ...(interviewReady
                ? { usageMetadata: { soheeConversationInterview: interviewFailureState! } }
                : {}),
            })
            await tasks.stop(cancelled ? 'cancelled' : 'failed')
            controller.enqueue(encoded({
              type: 'message.failed',
              messageId: assistant.id,
              code: errorCode,
              message: failureMessage,
            }))
          } finally {
            request.signal.removeEventListener('abort', abortFromRequest)
            unregisterActiveChatStream(assistant.id, generationController)
            controller.close()
          }
        },
      })

      return ndjsonResponse(stream)
    } catch (error) {
      if (preparedReadyAssistant && preparedReadyDecision) {
        await releasePreparedCredit()
        await finalizeTerminalMessage(deps, {
          workspaceId: workspaceId.data,
          messageId: preparedReadyAssistant.id,
          content: '콘텐츠 방향은 보존했지만 생성을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.',
          status: 'failed',
          errorCode: 'CHAT_PREPARATION_FAILED',
          usageMetadata: { soheeConversationInterview: preparedReadyDecision.state },
        })
      }
      const safeCode = error instanceof Error && error.message === 'CHAT_REFERENCE_MEDIA_COUNT_MISMATCH'
        ? 'CHAT_REFERENCE_MEDIA_COUNT_MISMATCH'
        : 'CHAT_UNAVAILABLE'
      return jsonError(safeCode === 'CHAT_REFERENCE_MEDIA_COUNT_MISMATCH' ? 422 : 503, safeCode)
    }
  }
}

export const productionMessagesDependencies: MessagesRouteDependencies = {
  async saveTaskTimeline(input) {
    const { saveTaskTimeline } = await import('@/features/chat/task-timeline-repository')
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    await saveTaskTimeline({ ...input, client: createAdminSupabaseClient() })
  },
  credits: {
    async createGateway() {
      const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
      return createAdminSupabaseClient() as unknown as CreditGateway
    },
    async reserveChatTurn({ workspaceId, clientMessageId, gateway }) {
      const credits = Number(process.env.SOHEE_CHAT_TURN_CREDITS)
      if (!Number.isSafeInteger(credits) || credits <= 0 || !gateway) return { ok: false }
      const { reserveCredits } = await import('@/features/credits/repository')
      const result = await reserveCredits({ workspaceId, action: 'chat_turn', credits, idempotencyKey: clientMessageId, reservationId: clientMessageId }, gateway)
      return 'data' in result && result.data ? { ok: true, reservationId: result.data.id } : { ok: false }
    },
    async settleChatTurn({ workspaceId, reservationId, clientMessageId, gateway }) {
      const credits = Number(process.env.SOHEE_CHAT_TURN_CREDITS)
      if (!Number.isSafeInteger(credits) || credits <= 0 || !gateway) throw new Error('credit_gateway_unavailable')
      const { settleCredits } = await import('@/features/credits/repository')
      const result = await settleCredits({ workspaceId, reservationId, actualCredits: credits, idempotencyKey: clientMessageId }, gateway)
      if ('error' in result) throw new Error('credit_settle_failed')
    },
    async releaseChatTurn({ workspaceId, reservationId, clientMessageId, gateway }) {
      const credits = Number(process.env.SOHEE_CHAT_TURN_CREDITS)
      if (!Number.isSafeInteger(credits) || credits <= 0 || !gateway) throw new Error('credit_gateway_unavailable')
      const { releaseCredits } = await import('@/features/credits/repository')
      const result = await releaseCredits({ workspaceId, reservationId, credits, idempotencyKey: clientMessageId }, gateway)
      if ('error' in result) throw new Error('credit_release_failed')
    },
  },
  async loadMarketingStrategy(input) {
    const [{ createAdminSupabaseClient }, { loadConversationMarketingStrategy }] = await Promise.all([
      import('@/lib/supabase/admin'), import('@/features/chat/conversation-marketing-strategy'),
    ])
    return loadConversationMarketingStrategy({ client: createAdminSupabaseClient(), ...input })
  },
  async approveMarketingStrategy(input) {
    const [{ createAdminSupabaseClient }, { approveConversationMarketingStrategy }] = await Promise.all([
      import('@/lib/supabase/admin'), import('@/features/chat/conversation-marketing-strategy'),
    ])
    return approveConversationMarketingStrategy({ client: createAdminSupabaseClient(), ...input })
  },
  async prepareRetry(input) {
    const [{ createAdminSupabaseClient }, { prepareConversationRetry }] = await Promise.all([
      import('@/lib/supabase/admin'), import('@/features/chat/retry-safety.server'),
    ])
    return prepareConversationRetry({ client: createAdminSupabaseClient(), ...input })
  },
  async authenticate() {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const client = await createServerSupabaseClient()
    const result = await client.auth.getUser()
    return result.error ? null : result.data.user?.id ?? null
  },
  async authorizeThread(scope) {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const { loadConversationActor } = await import('@/features/chat/conversation-authority')
    const actor = await loadConversationActor(await createServerSupabaseClient() as unknown as import('@/features/chat/conversation-authority').ConversationAuthorityDatabase, scope)
    return Boolean(actor && actor.role !== 'viewer')
  },
  async resolveWorkRef(input) {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const { resolveConversationWorkRef } = await import('@/features/chat/conversation-work-ref')
    const { isConversationWorkbenchEnabled } = await import('@/features/chat/conversation-rollout')
    if (!isConversationWorkbenchEnabled(input.workspaceId)) return null
    return resolveConversationWorkRef(await createServerSupabaseClient() as unknown as import('@/features/chat/conversation-authority').ConversationAuthorityDatabase, input)
  },
  async resolveActorRole(scope) {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const { loadConversationActor } = await import('@/features/chat/conversation-authority')
    return (await loadConversationActor(await createServerSupabaseClient() as unknown as import('@/features/chat/conversation-authority').ConversationAuthorityDatabase, scope))?.role ?? null
  },
  async authorizeCompatibility({ userId, workspaceId }) {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const client = await createServerSupabaseClient()
    const [user, membership, schemaProbe] = await Promise.all([
      client.auth.getUser(),
      client.from('workspace_members').select('workspace_id')
        .eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').maybeSingle(),
      client.from('conversation_threads').select('id').limit(1),
    ])
    return user.data.user?.email?.trim().toLowerCase() === 'test@example.com'
      && !membership.error
      && Boolean(membership.data)
      && schemaProbe.error?.code === 'PGRST205'
  },
  async createUserMessage(input) {
    const [{ createServerSupabaseClient }, { upsertConversationUserMessage }] = await Promise.all([
      import('@/lib/supabase/server'),
      import('@/features/chat/repository'),
    ])
    return upsertConversationUserMessage({
      client: await createServerSupabaseClient(),
      ...input,
    })
  },
  async findAssistantReply(input) {
    const [{ createAdminSupabaseClient }, repository] = await Promise.all([
      import('@/lib/supabase/admin'),
      import('@/features/chat/message-lifecycle-repository'),
    ])
    return repository.findAssistantReply({ client: createAdminSupabaseClient(), ...input })
  },
  async findLatestContentInterview(input) {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    return findLatestContentInterview({ client: createAdminSupabaseClient(), ...input })
  },
  async findLatestReadyContentInterview(input) {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    return findLatestReadyContentInterview({ client: createAdminSupabaseClient(), ...input })
  },
  async findContentInterviewByMessage(input) {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    return findContentInterviewByMessage({ client: createAdminSupabaseClient(), ...input })
  },
  async cancelContentInterview(input) {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    return cancelContentInterview({ client: createAdminSupabaseClient(), ...input })
  },
  async completeContentInterview(input) {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    return completeContentInterview({ client: createAdminSupabaseClient(), ...input })
  },
  async retireContentInterview(input) {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    return retireContentInterview({ client: createAdminSupabaseClient(), ...input })
  },
  async validateInterviewAttachments(input) {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    return validateContentInterviewAttachments({ client: createAdminSupabaseClient(), ...input })
  },
  async createAssistantMessage(input) {
    const [{ createAdminSupabaseClient }, repository] = await Promise.all([
      import('@/lib/supabase/admin'),
      import('@/features/chat/message-lifecycle-repository'),
    ])
    return repository.createAssistantMessage({ client: createAdminSupabaseClient(), ...input })
  },
  async createAssistantMessageAtomic(input) {
    const [{ createAdminSupabaseClient }, repository] = await Promise.all([
      import('@/lib/supabase/admin'),
      import('@/features/chat/message-lifecycle-repository'),
    ])
    return repository.createOrGetAssistantMessage({ client: createAdminSupabaseClient(), ...input })
  },
  async buildContext(input) {
    const [{ createAdminSupabaseClient }, { loadSoheeContext }] = await Promise.all([
      import('@/lib/supabase/admin'),
      import('@/features/chat/context-repository'),
    ])
    return loadSoheeContext({ client: createAdminSupabaseClient(), ...input })
  },
  async buildCompatibilityContext(input) {
    const { buildByreumCompatibilityContext } = await import('@/features/chat/byreum-compatibility-context')
    return buildByreumCompatibilityContext(input)
  },
  async createProvider() {
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!geminiKey) {
      throw new Error('GEMINI_API_KEY 서버 비밀값이 설정되지 않았습니다.')
    }
    const { createGeminiChatProvider } = await import('@/features/chat/gemini-chat-provider')
    const model = process.env.GEMINI_CONVERSATION_MODEL || 'gemini-3.5-flash-lite'
    return {
      model,
      provider: createGeminiChatProvider({
        apiKey: geminiKey,
        model,
      }),
    }
  },
  async createImageArtifact(input) {
    const { createProductionConversationImageArtifact } = await import(
      '@/features/chat/conversation-image-generation.server'
    )
    return createProductionConversationImageArtifact(input)
  },
  async resolveArtifactReference(input) {
    const [{ createAdminSupabaseClient }, repository] = await Promise.all([
      import('@/lib/supabase/admin'),
      import('@/features/chat/conversation-artifact-repository'),
    ])
    return repository.resolveConversationArtifactReference(
      input,
      repository.createSupabaseConversationArtifactGateway(createAdminSupabaseClient()),
    )
  },
  async resolveArtifactRetryReference(input) {
    const [{ createAdminSupabaseClient }, repository] = await Promise.all([
      import('@/lib/supabase/admin'),
      import('@/features/chat/conversation-artifact-repository'),
    ])
    return repository.resolveConversationArtifactRetryReference(
      input,
      repository.createSupabaseConversationArtifactGateway(createAdminSupabaseClient()),
    )
  },
  async createConversationArtifact(input) {
    const { createProductionConversationArtifact } = await import(
      '@/features/chat/conversation-artifact-generation.server'
    )
    return createProductionConversationArtifact(input)
  },
  async loadConversationArtifacts(input) {
    const [{ createAdminSupabaseClient }, repository] = await Promise.all([
      import('@/lib/supabase/admin'),
      import('@/features/chat/conversation-artifact-repository'),
    ])
    return repository.listConversationArtifactsForMessage(
      input,
      repository.createSupabaseConversationArtifactGateway(createAdminSupabaseClient()),
    )
  },
  async finalizeAssistantMessage(input) {
    const [{ createAdminSupabaseClient }, repository] = await Promise.all([
      import('@/lib/supabase/admin'),
      import('@/features/chat/message-lifecycle-repository'),
    ])
    await repository.finalizeAssistantMessage({ client: createAdminSupabaseClient(), ...input })
  },
  async forceFinalizeAssistantMessage(input) {
    const [{ createAdminSupabaseClient }, repository] = await Promise.all([
      import('@/lib/supabase/admin'),
      import('@/features/chat/message-lifecycle-repository'),
    ])
    await repository.forceFinalizeAssistantMessage({ client: createAdminSupabaseClient(), ...input })
  },
  async saveEvidence(input) {
    const [{ createAdminSupabaseClient }, repository] = await Promise.all([
      import('@/lib/supabase/admin'),
      import('@/features/chat/message-lifecycle-repository'),
    ])
    await repository.saveMessageEvidence({ client: createAdminSupabaseClient(), ...input })
  },
}

export const POST = createMessagesPostHandler(productionMessagesDependencies)

export async function GET(
  _request: Request,
  context: RouteContext
) {
  const { workspaceId, threadId } = await context.params
  const authUserId = await productionMessagesDependencies.authenticate()
  if (!authUserId) {
    return Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 })
  }
  const isAuthorized = await productionMessagesDependencies.authorizeThread({
    userId: authUserId,
    workspaceId,
    threadId,
  })
  if (!isAuthorized) {
    return Response.json({ error: { code: 'WORKSPACE_FORBIDDEN' } }, { status: 403 })
  }

  if (new URL(_request.url).searchParams.get('view') === 'tasks') {
    try {
      const { listConversationMessages } = await import('@/features/chat/repository')
      const { createServerSupabaseClient } = await import('@/lib/supabase/server')
      const messages = await listConversationMessages({ client: await createServerSupabaseClient(), workspaceId, threadId, limit: 50 })
      return Response.json({ data: messages.filter(message => message.role === 'sohee').map(message => ({
        messageId: message.id, status: message.status, timeline: message.taskTimeline ?? null,
      })) }, { headers: { 'cache-control': 'no-store' } })
    } catch {
      return Response.json({ error: { code: 'TASK_TIMELINE_UNAVAILABLE' } }, { status: 503, headers: { 'cache-control': 'no-store' } })
    }
  }
  const { ConversationRepository } = await import('@/lib/conversation/conversation-repository')
  const result = await ConversationRepository.getThreadMessagesResult(workspaceId, threadId, 50)
  if (result.state === 'ERROR') {
    return Response.json({ error: { code: result.errorCode, message: result.message } }, { status: 500 })
  }

  return Response.json({ data: result.data || [] }, { headers: { 'cache-control': 'no-store' } })
}
