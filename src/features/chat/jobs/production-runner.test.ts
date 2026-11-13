import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationJob } from './types'
import type { executePreparedConversationAgent } from '../prepared-conversation-agent'

const mocks = vi.hoisted(() => ({
  handler: vi.fn(),
  listMessages: vi.fn(),
  maybeSingle: vi.fn(),
  recordUsage: vi.fn(),
  actor: vi.fn(), owned: vi.fn(), handlerFactory: vi.fn(), balance: vi.fn(), agent: vi.fn(),
  begin: vi.fn(), record: vi.fn(), dispatch: vi.fn(), finalize: vi.fn(), evidence: vi.fn(), timeline: vi.fn(),
  prepareModel: vi.fn(), completeModel: vi.fn(), stageResponse: vi.fn(), persistPlan: vi.fn(), draftFactory: vi.fn(), draftPort: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/app/api/workspaces/[workspaceId]/conversations/[threadId]/messages/route', () => ({
  createMessagesPostHandler: (deps: unknown) => { mocks.handlerFactory(deps); return mocks.handler },
  productionMessagesDependencies: { finalizeAssistantMessage: mocks.finalize, forceFinalizeAssistantMessage: mocks.finalize, saveEvidence: mocks.evidence, saveTaskTimeline: mocks.timeline },
}))
vi.mock('@/features/credits/repository', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/credits/repository')>(), getCreditBalance: mocks.balance,
}))
vi.mock('../repository', () => ({ listConversationMessages: mocks.listMessages }))
vi.mock('../prepared-conversation-agent', () => ({ executePreparedConversationAgent: mocks.agent,
  PREPARED_CONVERSATION_READ_CAPABILITIES: ['knowledge.search', 'customer.search', 'interaction.list', 'reservation.list'],
  PREPARED_CONVERSATION_KNOWLEDGE_CAPABILITIES: ['knowledge.propose'],
  PREPARED_CONVERSATION_DRAFT_CAPABILITIES: ['comment.reply_draft', 'dm.reply_draft'] }))
vi.mock('@/features/engagement/conversation-draft-preparer', () => ({ createConversationDraftPreparer: (input: unknown) => {
  mocks.draftFactory(input); return mocks.draftPort
} }))
vi.mock('../prepared-agent-persistence', () => ({ createPreparedAgentPersistence: () => ({
  prepareModelCall: mocks.prepareModel, completeModelCall: mocks.completeModel,
  stageResponse: mocks.stageResponse, persistPlan: mocks.persistPlan,
}) }))
vi.mock('../conversation-authority', () => ({ loadConversationActor: mocks.actor, isPreparedConversationOwned: mocks.owned }))
vi.mock('@/lib/conversation/conversation-repository', () => ({ ConversationRepository: { beginAgentRunStep: mocks.begin, recordAgentRunStep: mocks.record } }))
vi.mock('@/features/tool-runtime/tool-dispatcher', () => ({ ToolDispatcher: { dispatch: mocks.dispatch } }))
vi.mock('./repository', () => ({
  createConversationJobRepository: () => ({ recordUsage: mocks.recordUsage }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: mocks.maybeSingle,
    }
    return { from: () => query, rpc: vi.fn() }
  },
}))

import { createProductionConversationJobDependencies } from './production-runner'
import { runConversationJob } from './runner'

const job: ConversationJob = {
  id: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  threadId: '30000000-0000-4000-8000-000000000001',
  userMessageId: '40000000-0000-4000-8000-000000000001',
  assistantMessageId: '50000000-0000-4000-8000-000000000001',
  reservationId: '60000000-0000-4000-8000-000000000001',
  status: 'running',
  kind: 'chat',
  sequenceNumber: 1,
  workerId: '70000000-0000-4000-8000-000000000001',
}

function failure(code: string, messageId = job.assistantMessageId) {
  return JSON.stringify({ type: 'message.failed', messageId, code, message: 'private draft must not escape' })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  mocks.actor.mockResolvedValue({ workspaceId: job.workspaceId, userId: '90000000-0000-4000-8000-000000000001', role: 'manager' })
  mocks.owned.mockResolvedValue(true)
  mocks.finalize.mockResolvedValue(undefined)
  mocks.recordUsage.mockResolvedValue(undefined)
  mocks.prepareModel.mockResolvedValue(undefined)
  mocks.completeModel.mockResolvedValue(undefined)
  mocks.stageResponse.mockResolvedValue(undefined)
  mocks.persistPlan.mockResolvedValue(undefined)
  mocks.balance.mockResolvedValue({ data: { available: 12 } })
  mocks.dispatch.mockResolvedValue({ success: true, toolId: 'credit.status', status: 'COMPLETED', data: { balance: 12 } })
  mocks.maybeSingle.mockResolvedValue({
    data: {
      id: job.userMessageId,
      client_message_id: '80000000-0000-4000-8000-000000000001',
      content: '원고 준비',
      usage_metadata: { executionContent: '원고 준비' },
      created_by_user_id: '90000000-0000-4000-8000-000000000001',
    },
    error: null,
  })
  mocks.listMessages
    .mockResolvedValueOnce([{ id: job.userMessageId }, { id: job.assistantMessageId }])
    .mockResolvedValue([{ id: job.assistantMessageId, status: 'failed' }])
})

async function execute(body: string, status = 200) {
  mocks.handler.mockResolvedValue(new Response(body, {
    status,
    headers: { 'content-type': status === 200 ? 'application/x-ndjson' : 'application/json' },
  }))
  return createProductionConversationJobDependencies().executor.execute(job)
}

describe('production conversation job failure readback', () => {
  it('routes business-data work through the existing claimed job rather than another intake', async () => {
    vi.stubEnv('CONVERSATION_AGENT_RUNTIME_ENABLED', '1')
    vi.stubEnv('CONVERSATION_AGENT_RUNTIME_WORKSPACE_ALLOWLIST', job.workspaceId)
    mocks.maybeSingle.mockResolvedValue({ data: { id: job.userMessageId,
      client_message_id: '80000000-0000-4000-8000-000000000001', content: '오늘 고객 문의와 예약을 확인해줘',
      usage_metadata: { executionContent: '오늘 고객 문의와 예약을 확인해줘' },
      created_by_user_id: '90000000-0000-4000-8000-000000000001' }, error: null })
    mocks.agent.mockResolvedValue({ status: 'completed', safeErrorCode: null, billingDisposition: 'release' })
    const result = await execute('')
    expect(result.status).toBe('succeeded')
    expect(mocks.agent).toHaveBeenCalledWith(expect.objectContaining({ jobId: job.id, assistantMessageId: job.assistantMessageId,
      userMessageId: job.userMessageId, workspaceId: job.workspaceId, userId: '90000000-0000-4000-8000-000000000001' }),
      expect.objectContaining({ readClient: expect.any(Object), allowedCapabilityIds: expect.arrayContaining(['knowledge.search', 'customer.search']) }))
    expect(mocks.handler).not.toHaveBeenCalled()
    expect(mocks.agent.mock.calls[0][1].proposeKnowledge).toEqual(expect.any(Function))
    expect(mocks.agent.mock.calls[0][1].allowedCapabilityIds).toContain('knowledge.propose')
    expect(mocks.agent.mock.calls[0][1].prepareInteractionDraft).toBe(mocks.draftPort)
    const draftScope = mocks.draftFactory.mock.calls[0][0] as { workspaceId: string; userId: string; authorize(): Promise<string | null> }
    expect(draftScope).toMatchObject({ workspaceId: job.workspaceId, userId: '90000000-0000-4000-8000-000000000001' })
    expect(await draftScope.authorize()).toBe('manager')
    mocks.actor.mockResolvedValue({ role: 'reviewer' })
    expect(await draftScope.authorize()).toBeNull()
    mocks.actor.mockResolvedValue({ role: 'owner' })
    mocks.owned.mockResolvedValue(false)
    expect(await draftScope.authorize()).toBeNull()
  })

  it('routes an explicit follow-up using a prior user request from the same claimed conversation', async () => {
    vi.stubEnv('CONVERSATION_AGENT_RUNTIME_ENABLED', '1')
    vi.stubEnv('CONVERSATION_AGENT_RUNTIME_WORKSPACE_ALLOWLIST', job.workspaceId)
    mocks.maybeSingle.mockResolvedValue({ data: { id: job.userMessageId, client_message_id: '80000000-0000-4000-8000-000000000001',
      content: '그 자료를 다시 확인해줘', usage_metadata: { executionContent: '그 자료를 다시 확인해줘' },
      created_by_user_id: '90000000-0000-4000-8000-000000000001' }, error: null })
    mocks.listMessages.mockReset().mockResolvedValue([{ id: job.userMessageId }, { id: job.assistantMessageId },
      { id: '40000000-0000-4000-8000-000000000002', workspaceId: job.workspaceId, threadId: job.threadId,
        role: 'user', status: 'completed', content: '예약 장부를 확인해줘' }])
    mocks.agent.mockResolvedValueOnce({ status: 'completed', safeErrorCode: null, billingDisposition: 'release' })
    expect(await execute('')).toMatchObject({ status: 'succeeded' })
    expect(mocks.agent).toHaveBeenCalledOnce()
    expect(mocks.handler).not.toHaveBeenCalled()
  })

  it('durably records model usage and stages the answer without premature message completion', async () => {
    vi.stubEnv('CONVERSATION_AGENT_RUNTIME_ENABLED', '1')
    vi.stubEnv('CONVERSATION_AGENT_RUNTIME_WORKSPACE_ALLOWLIST', job.workspaceId)
    mocks.maybeSingle.mockResolvedValue({ data: { id: job.userMessageId,
      client_message_id: '80000000-0000-4000-8000-000000000001', content: '고객 문의 확인',
      usage_metadata: { executionContent: '고객 문의 확인' },
      created_by_user_id: '90000000-0000-4000-8000-000000000001' }, error: null })
    mocks.agent.mockImplementationOnce(async (_scope: unknown, deps: Parameters<typeof executePreparedConversationAgent>[1]) => {
      await deps.prepareModelCall(1)
      await deps.recordUsage({ provider: 'gemini', providerRequestId: 'native-response-1', model: 'gemini-3.8-flash',
        operation: 'text_response', usageSource: 'actual', usage: { textInputTokens: 10, cachedTextInputTokens: 0,
          textOutputTokens: 5, imageInputTokens: 0, imageOutputTokens: 0, providerTotalTokens: 15 } })
      await deps.finalize('저장된 문의를 확인했어요.', true)
      return { status: 'completed', safeErrorCode: null, billingDisposition: 'settle_usage' }
    })
    const result = await execute('')
    expect(result).toMatchObject({ status: 'succeeded', billingDisposition: 'settle_usage', usage: [expect.objectContaining({ event: expect.objectContaining({ provider: 'gemini' }) })] })
    expect(mocks.recordUsage).toHaveBeenCalledWith(job, expect.objectContaining({ providerCallKey: expect.stringMatching(/^model:[a-f0-9]{64}$/) }), expect.any(Number))
    expect(mocks.completeModel).toHaveBeenCalledOnce()
    expect(mocks.stageResponse).toHaveBeenCalledWith('90000000-0000-4000-8000-000000000001', '저장된 문의를 확인했어요.', true)
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it('does not enter any existing flow after the worker loses the lease', async () => {
    mocks.owned.mockResolvedValue(false)
    await expect(execute('')).rejects.toThrow('CONVERSATION_AUTHORITY_LOST')
    expect(mocks.handler).not.toHaveBeenCalled()
  })
  it('does not enter an existing flow after membership is revoked', async () => {
    mocks.actor.mockResolvedValue(null)
    expect(await execute('')).toMatchObject({ status: 'needs_attention', safeErrorCode: 'CONVERSATION_AUTHORITY_LOST', billingDisposition: 'release', usage: [] })
    expect(mocks.handler).not.toHaveBeenCalled()
    expect(mocks.recordUsage).not.toHaveBeenCalled()
  })
  it('rechecks worker authority in the delegated route and never enables compatibility bypass', async () => {
    await execute('')
    const deps = mocks.handlerFactory.mock.calls[0][0]
    mocks.owned.mockResolvedValue(false)
    expect(await deps.authorizeThread({ workspaceId: job.workspaceId, threadId: job.threadId, userId: '90000000-0000-4000-8000-000000000001' })).toBe(false)
    expect(await deps.authorizeCompatibility()).toBe(false)
  })
  it('does not let terminal persistence fallback bypass revoked worker authority', async () => {
    await execute('')
    const deps = mocks.handlerFactory.mock.calls[0][0]
    mocks.owned.mockResolvedValue(false)
    await expect(deps.forceFinalizeAssistantMessage({})).rejects.toThrow('CONVERSATION_AUTHORITY_LOST')
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it('uses the existing claimed turn for a gated credit read without another model call or estimated billing', async () => {
    vi.stubEnv('CONVERSATION_READ_RUNTIME_ENABLED', '1')
    vi.stubEnv('CONVERSATION_READ_RUNTIME_WORKSPACE_ALLOWLIST', job.workspaceId)
    mocks.maybeSingle.mockResolvedValue({ data: { id: job.userMessageId, client_message_id: '80000000-0000-4000-8000-000000000001', content: '남은 크레딧 얼마야?', usage_metadata: { executionContent: '남은 크레딧 얼마야?' }, created_by_user_id: '90000000-0000-4000-8000-000000000001' }, error: null })
    const result = await execute('')
    expect(result).toMatchObject({ status: 'succeeded', billingDisposition: 'release', usage: [] })
    expect(mocks.handler).not.toHaveBeenCalled()
    expect(mocks.balance).toHaveBeenCalledWith(job.workspaceId, expect.anything())
    expect(mocks.dispatch).toHaveBeenCalledWith('credit.status', {}, expect.objectContaining({ creditBalance: 12 }))
    expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({ runId: job.id }))
    expect(mocks.evidence).toHaveBeenCalledWith(expect.objectContaining({ evidence: expect.objectContaining({ id: job.workspaceId, kind: 'policy' }) }))
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ messageId: job.assistantMessageId, content: '조회 시점에 사용 가능한 크레딧은 12크레딧이에요. 처리 중인 예약분에 따라 잔액이 달라질 수 있어요.' }))
    expect(mocks.recordUsage).not.toHaveBeenCalled()
  })
  it.each(['CHAT_FACT_REVIEW_REQUIRED', 'CHAT_FACTS_CHANGED', 'CHAT_FACTS_UNAVAILABLE']) (
    'preserves %s from the matching HTTP 200 failure event', async (code) => {
      const result = await execute(`${JSON.stringify({ type: 'message.started', messageId: job.assistantMessageId })}\n${failure(code)}\n`)
      expect(result).toMatchObject({
        status: 'needs_attention', safeErrorCode: code, billingDisposition: 'settle_usage',
        usage: [expect.objectContaining({ event: expect.objectContaining({ usageSource: 'estimated_missing_usage' }) })],
      })
      expect(mocks.recordUsage).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toContain('private draft')
    },
  )

  it.each([
    failure('CHAT_FACTS_CHANGED', job.userMessageId),
    failure('PRIVATE_TOKEN_SECRET'),
    failure('secret with spaces'),
    JSON.stringify({ type: 'message.delta', messageId: job.assistantMessageId, delta: failure('CHAT_FACTS_CHANGED') }),
    '{broken json',
    '',
  ])('uses a generic failure when the stream has no trusted matching code: %s', async (body) => {
    expect(await execute(body)).toMatchObject({ status: 'needs_attention', safeErrorCode: 'JOB_EXECUTION_FAILED' })
  })

  it('uses the persisted cancellation even if a failure event preceded it', async () => {
    mocks.listMessages.mockResolvedValueOnce([{ id: job.assistantMessageId, status: 'cancelled' }])
    expect(await execute(failure('CHAT_FACTS_CHANGED'))).toMatchObject({
      status: 'cancelled', safeErrorCode: 'CHAT_CANCELLED',
    })
  })

  it('does not override a completed database result with a stream failure', async () => {
    mocks.listMessages.mockResolvedValueOnce([{ id: job.assistantMessageId, status: 'completed', clarification: { status: 'awaiting_input' } }])
    expect(await execute(failure('CHAT_FACTS_CHANGED'))).toMatchObject({ status: 'succeeded', safeErrorCode: null })
  })

  it('passes the QA failure through the executor and runner to terminal persistence', async () => {
    mocks.handler.mockResolvedValue(new Response(failure('CHAT_FACTS_CHANGED')))
    const complete = vi.fn()
    const settle = vi.fn()
    const release = vi.fn()
    const result = await runConversationJob(job.id, 'worker', {
      executor: createProductionConversationJobDependencies().executor,
      repository: {
        claim: async () => ({ state: 'claimed', job }),
        recordUsage: mocks.recordUsage,
        complete,
      },
      credits: { settle, release },
    })
    expect(result).toEqual({ state: 'needs_attention' })
    expect(complete).toHaveBeenCalledExactlyOnceWith(job, 'needs_attention', 'CHAT_FACTS_CHANGED')
    expect(settle).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()
    expect(mocks.recordUsage).toHaveBeenCalledWith(job,
      expect.objectContaining({ event: expect.objectContaining({ usageSource: 'estimated_missing_usage' }) }),
      expect.any(Number))
  })

  it('preserves safe HTTP errors for pre-stream failures', async () => {
    expect(await execute(JSON.stringify({ error: { code: 'CHAT_UNAVAILABLE' } }), 503)).toMatchObject({
      status: 'needs_attention', safeErrorCode: 'CHAT_UNAVAILABLE',
    })
  })

  it('does not persist a malformed HTTP error body', async () => {
    expect(await execute(JSON.stringify({ error: { code: 'secret value' } }), 503)).toMatchObject({
      status: 'needs_attention', safeErrorCode: 'JOB_EXECUTION_HTTP_503',
    })
  })
})
