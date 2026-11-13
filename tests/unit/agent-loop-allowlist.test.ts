import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolExecutionContext } from '@/features/tool-runtime/types'
const mocks = vi.hoisted(() => ({ plan: vi.fn(), dispatch: vi.fn(), discover: vi.fn(), begin: vi.fn(), record: vi.fn(), save: vi.fn() }))
vi.mock('@/features/tool-runtime/action-worker', () => ({ ActionWorker: { planAndCallTools: mocks.plan }, ActionWorkerModelError: class extends Error {} }))
vi.mock('@/features/tool-runtime/tool-dispatcher', () => ({ ToolDispatcher: { dispatch: mocks.dispatch } }))
vi.mock('@/lib/mcp-gateway/dynamic-capability-discovery', () => ({ DynamicCapabilityDiscovery: { getRelevantOperationalCapabilities: mocks.discover } }))
vi.mock('@/lib/conversation/conversation-repository', () => ({ ConversationRepository: { beginAgentRunStep: mocks.begin, recordAgentRunStep: mocks.record, updateAgentRunPlanData: mocks.save } }))
vi.mock('@/features/agent-session/agent-approval-service', () => ({ AgentApprovalService: {} }))
import { AgentLoopEngine } from '@/features/tool-runtime/agent-loop-engine'
const input = { workspaceId: 'workspace', actionRunId: 'run', correlationId: 'turn', userPrompt: '잔여 크레딧 알려줘' }
const discovery = (tools: unknown[]) => ({ surface: 'CHAT', openAiTools: tools, operationalCapabilities: [], exclusionReasons: [] })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.save.mockResolvedValue(undefined)
  mocks.plan.mockResolvedValue({ toolCalls: [], totalTokens: 1, rawContent: '사용 가능한 도구가 없어요.' })
  mocks.dispatch.mockResolvedValue({ success: true, toolId: 'image.generate', status: 'COMPLETED', data: {} })
})
describe('agent loop server allowlist', () => {
  it('replans an unsupported completion claim until the mandatory read actually completes', async () => {
    mocks.discover.mockResolvedValue(discovery([{ type: 'function', function: { name: 'reservation.list' } }]))
    mocks.plan.mockResolvedValueOnce({ toolCalls: [], totalTokens: 1, rawContent: '예약 0건입니다.' })
      .mockResolvedValueOnce({ toolCalls: [{ id: 'read-ledger', toolName: 'reservation.list', arguments: {} }], totalTokens: 1 })
      .mockResolvedValueOnce({ toolCalls: [], totalTokens: 1, rawContent: '조회한 예약 1건입니다.' })
    mocks.dispatch.mockResolvedValue({ success: true, toolId: 'reservation.list', status: 'COMPLETED', data: { count: 1, reservations: [{}] } })
    const result = await AgentLoopEngine.run({ ...input, options: { maxSteps: 3 }, completionContract: {
      requiredOutcomes: [{ capabilityId: 'reservation.list', requiredStatus: 'COMPLETED' }], replanOnFailure: true,
    } })
    expect(result.status).toBe('COMPLETED')
    expect(mocks.plan).toHaveBeenCalledTimes(3)
    expect(mocks.dispatch).toHaveBeenCalledOnce()
    expect(result.rawAssistantFinalMessage).toBe('조회한 예약 1건입니다.')
  })

  it('replans a missing stored inbox read under the same bounded read-only contract', async () => {
    mocks.discover.mockResolvedValue(discovery([{ type: 'function', function: { name: 'interaction.list' } }]))
    mocks.plan.mockResolvedValueOnce({ toolCalls: [], totalTokens: 1, rawContent: '수신 메시지가 없어요.' })
      .mockResolvedValueOnce({ toolCalls: [{ id: 'inbox', toolName: 'interaction.list', arguments: {} }], totalTokens: 1 })
      .mockResolvedValueOnce({ toolCalls: [], totalTokens: 1, rawContent: '저장된 수신 기록을 확인했어요.' })
    mocks.dispatch.mockResolvedValue({ success: true, toolId: 'interaction.list', status: 'COMPLETED', data: { count: 1 } })
    const result = await AgentLoopEngine.run({ ...input, options: { maxSteps: 3 }, completionContract: {
      requiredOutcomes: [{ capabilityId: 'interaction.list' }], replanOnFailure: true,
    } })
    expect(result.status).toBe('COMPLETED')
    expect(mocks.plan).toHaveBeenCalledTimes(3)
    expect(mocks.dispatch).toHaveBeenCalledOnce()
  })

  it('stops unsupported completion claims at the configured iteration budget', async () => {
    mocks.discover.mockResolvedValue(discovery([{ type: 'function', function: { name: 'reservation.list' } }]))
    const result = await AgentLoopEngine.run({ ...input, options: { maxSteps: 2 }, completionContract: {
      requiredOutcomes: [{ capabilityId: 'reservation.list' }], replanOnFailure: true,
    } })
    expect(result.status).not.toBe('COMPLETED')
    expect(mocks.plan).toHaveBeenCalledTimes(2)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('persists a model intent before planning and delegates checkpoint ownership to the prepared caller', async () => {
    mocks.discover.mockResolvedValue(discovery([{ type: 'function', function: { name: 'credit.status' } }]))
    const order: string[] = []
    mocks.plan.mockImplementationOnce(async () => { order.push('model'); return { toolCalls: [], totalTokens: 0, rawContent: '확인 필요' } })
    const persistPlanData = vi.fn(async () => { order.push('checkpoint') })
    await AgentLoopEngine.run({ ...input, options: { maxSteps: 1,
      onModelStarting: async () => { order.push('intent') }, persistPlanData } })
    expect(order).toEqual(['intent', 'model', 'checkpoint'])
    expect(persistPlanData).toHaveBeenCalledOnce()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('keeps validated worker data access and canonical credits in the server dispatch context', async () => {
    mocks.discover.mockResolvedValue(discovery([{ type: 'function', function: { name: 'credit.status' } }]))
    mocks.plan.mockResolvedValueOnce({ toolCalls: [{ id: 'call-1', toolName: 'credit.status', arguments: {} }], totalTokens: 1 })
      .mockResolvedValueOnce({ toolCalls: [], totalTokens: 1, rawContent: '조회했어요.' })
    mocks.dispatch.mockResolvedValue({ success: true, toolId: 'credit.status', status: 'COMPLETED', data: { balance: 1234 } })
    const readClient = { from: vi.fn() } as unknown as NonNullable<ToolExecutionContext['readClient']>
    await AgentLoopEngine.run({ ...input, options: { maxSteps: 2, readClient, creditBalance: 1234 } })
    expect(mocks.dispatch).toHaveBeenCalledWith('credit.status', {}, expect.objectContaining({ readClient, creditBalance: 1234 }))
  })

  it('forwards an internal draft port without creating a legacy send-approval proposal', async () => {
    mocks.discover.mockResolvedValue(discovery([{ type: 'function', function: { name: 'comment.reply_draft' } }]))
    mocks.plan.mockResolvedValueOnce({ toolCalls: [{ id: 'draft', toolName: 'comment.reply_draft', arguments: { targetId: 'target', draftText: '안내', sourceRef: 'source' } }], totalTokens: 1 })
      .mockResolvedValueOnce({ toolCalls: [], totalTokens: 1, rawContent: '검토할 초안을 저장했어요. 아직 발송하지 않았어요.' })
    const prepareInteractionDraft = vi.fn().mockResolvedValue({ success: true, toolId: 'comment.reply_draft', status: 'COMPLETED', data: { requiresUserApproval: true } })
    mocks.dispatch.mockImplementationOnce(async (_name: string, args: unknown, context: ToolExecutionContext) => {
      if (!context.prepareInteractionDraft) throw new Error('MISSING_DRAFT_PORT')
      return context.prepareInteractionDraft(args as Parameters<NonNullable<ToolExecutionContext['prepareInteractionDraft']>>[0])
    })
    const result = await AgentLoopEngine.run({ ...input, options: { maxSteps: 2, prepareInteractionDraft } })
    expect(result.status).toBe('COMPLETED')
    expect(prepareInteractionDraft).toHaveBeenCalledOnce()
    expect(result.executedSteps[0].proposal).toBeUndefined()
  })

  it('passes the durable usage observer through to each model invocation', async () => {
    mocks.discover.mockResolvedValue(discovery([{ type: 'function', function: { name: 'credit.status' } }]))
    const onUsage = vi.fn()
    mocks.plan.mockImplementationOnce(async (args: { onUsage?: (usage: null) => void }) => {
      await args.onUsage?.(null)
      return { toolCalls: [], totalTokens: 0, rawContent: '자료가 필요해요.' }
    })
    await AgentLoopEngine.run({ ...input, options: { maxSteps: 1, onUsage } })
    expect(onUsage).toHaveBeenCalledWith(null)
  })

  it('does not restore the registry or call the model when discovery returns no tools', async () => {
    mocks.discover.mockResolvedValue(discovery([]))
    const result = await AgentLoopEngine.run(input)
    expect(result.status).toBe('BLOCKED')
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
  it('treats an explicit empty server allowlist as no permission', async () => {
    mocks.discover.mockResolvedValue(discovery([{ type: 'function', function: { name: 'mcp_check_credits' } }]))
    const result = await AgentLoopEngine.run({ ...input, options: { allowedCapabilityIds: [] } })
    expect(result.status).toBe('BLOCKED')
    expect(mocks.plan).not.toHaveBeenCalled()
  })
  it('rejects a model-selected tool outside the presented allowlist before recording execution intent', async () => {
    mocks.discover.mockResolvedValue(discovery([{ type: 'function', function: { name: 'mcp_check_credits' } }]))
    mocks.plan.mockResolvedValue({ toolCalls: [{ id: 'call-1', toolName: 'image.generate', arguments: { prompt: '이미지 생성' } }], totalTokens: 1 })
    const result = await AgentLoopEngine.run({ ...input, options: { maxSteps: 1 } })
    expect(result.status).toBe('BLOCKED')
    expect(mocks.begin).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})
