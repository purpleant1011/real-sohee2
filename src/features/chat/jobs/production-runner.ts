import 'server-only'

import { z } from 'zod'
import {
  createMessagesPostHandler,
  productionMessagesDependencies,
  type MessagesRouteDependencies,
} from '@/app/api/workspaces/[workspaceId]/conversations/[threadId]/messages/route'
import { getCreditBalance, settleCredits, type CreditGateway } from '@/features/credits/repository'
import type { UsageEventInput } from '@/features/credits/usage-event'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { listConversationMessages } from '../repository'
import { createPreparedMessageExecutor, type PersistedRequest } from './prepared-message-executor'
import { createConversationJobRepository } from './repository'
import { runConversationJob } from './runner'
import type { ConversationJob, RecordedJobUsage } from './types'
import { decidePreparedJobBillingDisposition } from './job-billing-disposition'
import { createPersistingUsageCollector } from './persisting-usage-collector'
import { loadConversationActor, isPreparedConversationOwned, type ConversationAuthorityDatabase } from '../conversation-authority'
import { routeConversationRequest, conversationReadRuntimeEnabled } from '../conversation-runtime-router'
import { executePreparedConversationRead } from '../conversation-runtime-adapter'
import { shouldUsePreparedConversationAgent, isConversationAgentRuntimeEnabled } from '../prepared-conversation-routing'

const persistedMetadata = z.object({
  executionContent: z.string().trim().min(1).max(8_000),
  attachmentIds: z.array(z.string().uuid()).max(20).optional(),
  retryAssistantMessageId: z.string().uuid().optional(),
  replyToMessageId: z.string().uuid().optional(),
  selectedSlideId: z.string().uuid().optional(),
  retryFailedSlideId: z.string().uuid().optional(),
}).passthrough()

function safeResponseErrorCode(responseBody: string): string | null {
  try {
    const parsed = z.object({
      error: z.object({ code: z.string().regex(/^[A-Z0-9_]{1,80}$/u) }).strict(),
    }).strict().safeParse(JSON.parse(responseBody || '{}'))
    return parsed.success ? parsed.data.error.code : null
  } catch {
    return null
  }
}

const streamFailureSchema = z.object({
  type: z.literal('message.failed'),
  messageId: z.string().uuid(),
  code: z.enum([
    'CHAT_CANCELLED',
    'CHAT_PROVIDER_FAILED',
    'CHAT_IMAGE_GENERATION_FAILED',
    'CHAT_PERSISTENCE_REQUIRED_FOR_INTERVIEW',
    'CHAT_ARTIFACT_FAILED',
    'CHAT_REFERENCE_MEDIA_COUNT_MISMATCH',
    'CHAT_FACT_REVIEW_REQUIRED',
    'CHAT_FACTS_CHANGED',
    'CHAT_FACTS_UNAVAILABLE',
  ]),
})

function safeStreamFailureCode(responseBody: string, messageId: string): string | null {
  for (const line of responseBody.split('\n')) {
    try {
      const event = streamFailureSchema.safeParse(JSON.parse(line))
      if (event.success && event.data.messageId === messageId) return event.data.code
    } catch {
      // Ignore malformed lines without retaining private stream contents.
    }
  }
  return null
}

async function preparationPhase<T>(phase: string, action: () => Promise<T> | T): Promise<T> {
  try {
    return await action()
  } catch {
    console.error('[sohee:conversation-job-preparation-failed]', { phase })
    throw new Error(`CONVERSATION_JOB_PREPARATION_${phase}`)
  }
}

function estimatedUsage(job: ConversationJob): RecordedJobUsage {
  const imageOutputTokens = job.kind === 'image_generation' || job.kind === 'content_generation' ? 4160 : 0
  const event: UsageEventInput = Object.freeze({
    provider: imageOutputTokens > 0 ? 'openai' : 'gemini',
    providerRequestId: null,
    model: imageOutputTokens > 0 ? 'gpt-image-2' : 'gemini-3.5-flash-lite',
    operation: imageOutputTokens > 0 ? 'image_generation' : 'text_response',
    usageSource: 'estimated_missing_usage',
    usage: Object.freeze({
      textInputTokens: 1000,
      cachedTextInputTokens: 0,
      textOutputTokens: imageOutputTokens > 0 ? 0 : 500,
      imageInputTokens: 0,
      imageOutputTokens,
      providerTotalTokens: imageOutputTokens > 0 ? 5160 : 1500,
    }),
  })
  return Object.freeze({ providerCallKey: `${job.id}:estimated:1`, event })
}

async function loadPreparedRequest(job: ConversationJob) {
  const admin = createAdminSupabaseClient()
  const result = await admin.from('messages')
    .select('id, client_message_id, content, usage_metadata, created_by_user_id')
    .eq('workspace_id', job.workspaceId)
    .eq('thread_id', job.threadId)
    .eq('id', job.userMessageId)
    .eq('role', 'user')
    .maybeSingle()
  const row = z.object({
    id: z.string().uuid(),
    client_message_id: z.string().uuid(),
    content: z.string().trim().min(1).max(8_000),
    usage_metadata: persistedMetadata,
    created_by_user_id: z.string().uuid(),
  }).strict().safeParse(result.data)
  if (result.error || !row.success) throw new Error('CONVERSATION_JOB_REQUEST_UNAVAILABLE')
  return Object.freeze({
    userId: row.data.created_by_user_id,
    clientMessageId: row.data.client_message_id,
    displayContent: row.data.content,
    executionContent: row.data.usage_metadata.executionContent,
    attachmentIds: [...(row.data.usage_metadata.attachmentIds ?? [])],
    retryAssistantMessageId: row.data.usage_metadata.retryAssistantMessageId,
    replyToMessageId: row.data.usage_metadata.replyToMessageId,
    selectedSlideId: row.data.usage_metadata.selectedSlideId,
    retryFailedSlideId: row.data.usage_metadata.retryFailedSlideId,
  })
}

async function executePrepared(input: Readonly<{
  job: ConversationJob
  request: PersistedRequest
  onUsage(usage: RecordedJobUsage): void
  persistUsage(usage: RecordedJobUsage): Promise<void>
}>) {
  let providerUsageCount = 0
  const admin = createAdminSupabaseClient()
  const authorityDb = admin as unknown as ConversationAuthorityDatabase
  const actorScope = { workspaceId: input.job.workspaceId, threadId: input.job.threadId, userId: input.request.userId }
  const authorized = async () => {
    const actor = await loadConversationActor(authorityDb, actorScope)
    return Boolean(actor && actor.role !== 'viewer' && await isPreparedConversationOwned(authorityDb, input.job))
  }
  if (!await authorized()) {
    if (!await isPreparedConversationOwned(authorityDb, input.job)) throw new Error('CONVERSATION_AUTHORITY_LOST')
    await productionMessagesDependencies.finalizeAssistantMessage({ workspaceId: input.job.workspaceId,
      messageId: input.job.assistantMessageId, content: '현재 대화 실행 권한을 확인하지 못해 작업을 시작하지 않았어요.',
      status: 'failed', errorCode: 'CONVERSATION_AUTHORITY_LOST' })
    return { status: 'failed' as const, safeErrorCode: 'CONVERSATION_AUTHORITY_LOST', billingDisposition: 'release' as const }
  }
  const messages = await listConversationMessages({
    client: admin,
    workspaceId: input.job.workspaceId,
    threadId: input.job.threadId,
    limit: 100,
  })
  const userMessage = messages.find((message) => message.id === input.job.userMessageId)
  const assistantMessage = messages.find((message) => message.id === input.job.assistantMessageId)
  if (!userMessage || !assistantMessage) throw new Error('CONVERSATION_JOB_MESSAGES_UNAVAILABLE')

  if (input.job.kind === 'chat' && input.request.attachmentIds.length === 0 && !input.request.retryAssistantMessageId
    && conversationReadRuntimeEnabled(process.env.CONVERSATION_READ_RUNTIME_ENABLED,
      process.env.CONVERSATION_READ_RUNTIME_WORKSPACE_ALLOWLIST, input.job.workspaceId)
    && routeConversationRequest(input.request.executionContent).kind === 'capability') {
    const [{ ToolDispatcher }, { ConversationRepository }] = await Promise.all([
      import('@/features/tool-runtime/tool-dispatcher'), import('@/lib/conversation/conversation-repository'),
    ])
    const timeline = async (status: 'in_progress' | 'completed' | 'failed') => {
      if (!productionMessagesDependencies.saveTaskTimeline) throw new Error('CONVERSATION_RUNTIME_PERSISTENCE_UNAVAILABLE')
      await productionMessagesDependencies.saveTaskTimeline({ workspaceId: input.job.workspaceId, threadId: input.job.threadId,
        messageId: input.job.assistantMessageId, timeline: { id: `runtime-${input.job.id}`, kind: 'task_timeline', title: '크레딧 조회',
          totalSteps: 1, completedSteps: status === 'completed' ? 1 : 0, isLive: status === 'in_progress',
          steps: [{ id: 'credit-read', title: '현재 가게의 크레딧 확인', status }] } })
    }
    return executePreparedConversationRead({ ...actorScope, jobId: input.job.id, assistantMessageId: input.job.assistantMessageId }, {
      authorized,
      begin: async () => {
        await ConversationRepository.beginAgentRunStep({ workspaceId: input.job.workspaceId, runId: input.job.id,
          stepIndex: 1, capabilityId: 'credit.status', inputPayload: {} })
        await timeline('in_progress')
      },
      dispatch: async context => {
        try {
          const balance = await getCreditBalance(input.job.workspaceId, { rpc: (name, args) =>
            admin.rpc(name as never, args as never) as unknown as Promise<{ data: unknown; error: unknown }> })
          if (balance.error || !Number.isSafeInteger(balance.data.available) || balance.data.available < 0) {
            return { success: false, toolId: 'credit.status', status: 'BLOCKED', error: { code: 'CREDIT_STATE_UNAVAILABLE', message: '정본 크레딧 잔액을 확인하지 못했어요.' } }
          }
          return ToolDispatcher.dispatch('credit.status', {}, { ...context, creditBalance: balance.data.available })
        } catch {
          return { success: false, toolId: 'credit.status', status: 'BLOCKED', error: { code: 'CREDIT_STATE_UNAVAILABLE', message: '정본 크레딧 잔액을 확인하지 못했어요.' } }
        }
      },
      record: async fact => {
        await ConversationRepository.recordAgentRunStep({ workspaceId: input.job.workspaceId, runId: input.job.id,
          stepIndex: 1, capabilityId: 'credit.status', status: fact.status === 'COMPLETED' ? 'completed' : 'failed',
          inputPayload: {}, outputPayload: { balance: fact.balance }, completed: true })
        await timeline(fact.status === 'COMPLETED' ? 'completed' : 'failed')
      },
      evidence: () => productionMessagesDependencies.saveEvidence({ workspaceId: input.job.workspaceId,
        messageId: input.job.assistantMessageId, evidence: { id: input.job.workspaceId, kind: 'policy', title: '가게 크레딧 정책·원장', href: '/app/system?section=credits' } }),
      finalize: (content, successful) => productionMessagesDependencies.finalizeAssistantMessage({ workspaceId: input.job.workspaceId,
        messageId: input.job.assistantMessageId, content, status: successful ? 'completed' : 'failed',
        errorCode: successful ? null : 'CONVERSATION_READ_UNAVAILABLE' }),
    })
  }

  const previousBusinessRequest = messages.find(message => message.id !== input.job.userMessageId
    && message.workspaceId === input.job.workspaceId && message.threadId === input.job.threadId
    && message.role === 'user' && message.status === 'completed' && shouldUsePreparedConversationAgent(message.content))
  const agentCandidate = isConversationAgentRuntimeEnabled(input.job.workspaceId)
    && input.job.kind === 'chat' && input.request.attachmentIds.length === 0
    && !input.request.retryAssistantMessageId && !input.request.replyToMessageId
    && shouldUsePreparedConversationAgent(input.request.executionContent, previousBusinessRequest?.content, { recentMessages: messages })
  const interview = agentCandidate ? await productionMessagesDependencies.findLatestContentInterview?.(actorScope) : null
  const interviewActive = interview?.state.status === 'collecting' || interview?.state.status === 'ready_to_generate'
  if (agentCandidate && !interviewActive) {
    const [{ executePreparedConversationAgent, PREPARED_CONVERSATION_READ_CAPABILITIES, PREPARED_CONVERSATION_DRAFT_CAPABILITIES, PREPARED_CONVERSATION_KNOWLEDGE_CAPABILITIES },
      { createPreparedAgentPersistence }, { AgentLoopEngine }, { createConversationDraftPreparer }, { createConversationKnowledgeProposer }] = await Promise.all([
      import('../prepared-conversation-agent'), import('../prepared-agent-persistence'),
      import('@/features/tool-runtime/agent-loop-engine'), import('@/features/engagement/conversation-draft-preparer'),
      import('@/features/sohee-studio/conversation-knowledge-proposer'),
    ])
    const balance = await getCreditBalance(input.job.workspaceId, { rpc: (name, args) =>
      admin.rpc(name as never, args as never) as unknown as Promise<{ data: unknown; error: unknown }> })
    if (balance.error || !Number.isSafeInteger(balance.data.available) || balance.data.available < 0) {
      if (!await authorized()) throw new Error('CONVERSATION_AUTHORITY_LOST')
      await productionMessagesDependencies.finalizeAssistantMessage({ workspaceId: input.job.workspaceId,
        messageId: input.job.assistantMessageId, content: '현재 사용 가능한 크레딧을 확인하지 못해 작업을 시작하지 않았어요.',
        status: 'failed', errorCode: 'CREDIT_STATE_UNAVAILABLE' })
      return { status: 'failed' as const, safeErrorCode: 'CREDIT_STATE_UNAVAILABLE', billingDisposition: 'release' as const }
    }
    const persistence = createPreparedAgentPersistence({ client: admin, job: input.job, authorized })
    let usageIndex = 0
    return executePreparedConversationAgent({ ...actorScope, jobId: input.job.id,
      assistantMessageId: input.job.assistantMessageId, userMessageId: input.job.userMessageId,
      message: input.request.executionContent }, {
      authorized, readClient: admin, creditBalance: balance.data.available,
      allowedCapabilityIds: [...PREPARED_CONVERSATION_READ_CAPABILITIES, ...PREPARED_CONVERSATION_DRAFT_CAPABILITIES, ...PREPARED_CONVERSATION_KNOWLEDGE_CAPABILITIES],
      prepareInteractionDraft: createConversationDraftPreparer({ client: admin, workspaceId: input.job.workspaceId,
        userId: input.request.userId, jobId: input.job.id, authorize: async () => {
          if (!await isPreparedConversationOwned(authorityDb, input.job)) return null
          const actor = await loadConversationActor(authorityDb, actorScope)
          return actor?.role === 'owner' || actor?.role === 'manager' ? actor.role : null
        } }),
      proposeKnowledge: createConversationKnowledgeProposer({ client: admin, ...actorScope, userMessageId: input.job.userMessageId, jobId: input.job.id, authorize: async () => {
        if (!await isPreparedConversationOwned(authorityDb, input.job)) return null
        const actor = await loadConversationActor(authorityDb, actorScope)
        return actor?.role === 'owner' || actor?.role === 'manager' ? actor.role : null
      } }),
      loadContext: () => productionMessagesDependencies.buildContext({ ...actorScope, strict: true }),
      run: value => AgentLoopEngine.run(value),
      prepareModelCall: async attempt => {
        await persistence.prepareModelCall(attempt)
        if (!productionMessagesDependencies.saveTaskTimeline) throw new Error('CONVERSATION_RUNTIME_PERSISTENCE_UNAVAILABLE')
        await productionMessagesDependencies.saveTaskTimeline({ workspaceId: input.job.workspaceId,
          threadId: input.job.threadId, messageId: input.job.assistantMessageId,
          timeline: { id: `runtime-${input.job.id}`, kind: 'task_timeline', title: '가게 자료 확인·업무 검토',
            totalSteps: 1, completedSteps: 0, isLive: true,
            steps: [{ id: 'planning', title: '확인한 자료로 업무 검토', status: 'in_progress' }] } })
      },
      recordUsage: async event => {
        const identity = `${event.provider}:${event.providerRequestId ?? `${input.job.id}:${input.job.workerId}:${++usageIndex}`}`
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
        const key = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
        await input.persistUsage({ providerCallKey: `model:${key}`, event })
        await persistence.completeModelCall(event)
      },
      persistPlan: persistence.persistPlan,
      saveTimeline: async timeline => {
        if (!productionMessagesDependencies.saveTaskTimeline) throw new Error('CONVERSATION_RUNTIME_PERSISTENCE_UNAVAILABLE')
        await productionMessagesDependencies.saveTaskTimeline({ workspaceId: input.job.workspaceId,
          threadId: input.job.threadId, messageId: input.job.assistantMessageId, timeline })
      },
      finalize: (content, successful) => persistence.stageResponse(input.request.userId, content, successful),
    })
  }

  const dependencies: MessagesRouteDependencies = {
    ...productionMessagesDependencies,
    credits: undefined,
    authenticate: async () => input.request.userId,
    authorizeThread: async scope => scope.userId === actorScope.userId && scope.workspaceId === actorScope.workspaceId
      && scope.threadId === actorScope.threadId && await authorized(),
    authorizeCompatibility: async () => false,
    resolveActorRole: async scope => {
      if (scope.userId !== actorScope.userId || scope.workspaceId !== actorScope.workspaceId || scope.threadId !== actorScope.threadId
        || !await isPreparedConversationOwned(authorityDb, input.job)) return null
      return (await loadConversationActor(authorityDb, actorScope))?.role ?? null
    },
    createUserMessage: async () => ({ message: userMessage, created: false }),
    findAssistantReply: async () => null,
    createAssistantMessage: async () => assistantMessage,
    createAssistantMessageAtomic: async () => ({ message: assistantMessage, created: true }),
    captureUsage: (usage) => {
      providerUsageCount += 1
      input.onUsage(usage)
    },
    findLatestContentInterview: (value) => preparationPhase(
      'INTERVIEW_ACTIVE',
      () => productionMessagesDependencies.findLatestContentInterview(value),
    ),
    findLatestReadyContentInterview: (value) => preparationPhase(
      'INTERVIEW_READY',
      () => productionMessagesDependencies.findLatestReadyContentInterview!(value),
    ),
    createProvider: () => preparationPhase(
      'PROVIDER_CONFIG',
      async () => {
        if (!await authorized()) throw new Error('CONVERSATION_AUTHORITY_LOST')
        return productionMessagesDependencies.createProvider()
      },
    ),
    finalizeAssistantMessage: async value => {
      if (!await authorized()) throw new Error('CONVERSATION_AUTHORITY_LOST')
      return productionMessagesDependencies.finalizeAssistantMessage(value)
    },
    forceFinalizeAssistantMessage: async value => {
      if (!await authorized()) throw new Error('CONVERSATION_AUTHORITY_LOST')
      return productionMessagesDependencies.forceFinalizeAssistantMessage(value)
    },
    buildContext: (value) => preparationPhase(
      'CONTEXT',
      () => productionMessagesDependencies.buildContext(value),
    ),
  }
  const handler = createMessagesPostHandler(dependencies)
  const response = await handler(new Request(
    `https://internal.sohee.invalid/api/workspaces/${input.job.workspaceId}/conversations/${input.job.threadId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: input.request.executionContent,
        displayContent: input.request.displayContent,
        clientMessageId: input.request.clientMessageId,
        attachmentIds: input.request.attachmentIds,
        ...(input.request.retryAssistantMessageId ? { retryAssistantMessageId: input.request.retryAssistantMessageId } : {}),
        ...(input.request.replyToMessageId ? { replyToMessageId: input.request.replyToMessageId } : {}),
        ...(input.request.selectedSlideId ? { selectedSlideId: input.request.selectedSlideId } : {}),
        ...(input.request.retryFailedSlideId ? { retryFailedSlideId: input.request.retryFailedSlideId } : {}),
      }),
    },
  ), { params: Promise.resolve({ workspaceId: input.job.workspaceId, threadId: input.job.threadId }) })
  const responseBody = await response.text()
  const responseErrorCode = response.ok ? null : safeResponseErrorCode(responseBody)

  const refreshed = await listConversationMessages({
    client: admin,
    workspaceId: input.job.workspaceId,
    threadId: input.job.threadId,
    limit: 100,
  })
  const final = refreshed.find((message) => message.id === input.job.assistantMessageId)
  if (!final) throw new Error('CONVERSATION_JOB_RESULT_UNAVAILABLE')
  return Object.freeze({
    status: final.status === 'completed' ? 'completed' as const
      : final.status === 'cancelled' ? 'cancelled' as const
        : 'failed' as const,
    safeErrorCode: final.status === 'completed'
      ? null
      : final.status === 'cancelled'
        ? 'CHAT_CANCELLED'
        : response.ok
          ? safeStreamFailureCode(responseBody, input.job.assistantMessageId) ?? 'JOB_EXECUTION_FAILED'
          : responseErrorCode ?? `JOB_EXECUTION_HTTP_${response.status}`,
    billingDisposition: decidePreparedJobBillingDisposition({
      responseOk: response.ok,
      providerUsageCount,
      clarificationStatus: final.clarification?.status ?? null,
    }),
  })
}

export function createProductionConversationJobDependencies() {
  const admin = createAdminSupabaseClient()
  const gateway = { rpc: (name: string, args: Record<string, unknown>) =>
    admin.rpc(name as never, args as never) as unknown as Promise<{ data: unknown; error: unknown }> }
  const repository = createConversationJobRepository(gateway)
  const prepared = createPreparedMessageExecutor({
    load: loadPreparedRequest,
    async execute(input) {
      const usage = createPersistingUsageCollector({
        job: input.job,
        record: (job, value, credits) => repository.recordUsage(job, value, credits),
      })
      const result = await executePrepared({ ...input, onUsage: usage.capture,
        persistUsage: async value => { usage.capture(value); await usage.flush() } })
      await usage.flush()
      for (const value of usage.snapshot()) input.onUsage(value)
      if (usage.snapshot().length === 0 && result.billingDisposition === 'settle_usage') {
        input.onUsage(estimatedUsage(input.job))
      }
      return result
    },
  })
  return Object.freeze({
    repository,
    executor: prepared,
    credits: Object.freeze({
      async settle(job: ConversationJob, actualCredits: number) {
        const result = await settleCredits({
          workspaceId: job.workspaceId,
          reservationId: job.reservationId,
          actualCredits,
          idempotencyKey: job.id,
        }, gateway as CreditGateway)
        if ('error' in result) throw new Error('CONVERSATION_JOB_CREDIT_SETTLE_FAILED')
      },
      async release(job: ConversationJob, reason: string) {
        const result = await gateway.rpc('release_unstarted_conversation_job_credit', {
          p_job_id: job.id,
          p_worker_id: job.workerId,
          p_reason: reason,
        })
        if (result.error || result.data !== true) throw new Error('CONVERSATION_JOB_CREDIT_RELEASE_FAILED')
      },
    }),
  })
}

export function runProductionConversationJob(jobId: string, workerId: string) {
  return runConversationJob(jobId, workerId, createProductionConversationJobDependencies())
}
