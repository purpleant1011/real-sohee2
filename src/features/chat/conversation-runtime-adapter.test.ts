import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executePreparedConversationRead } from './conversation-runtime-adapter'
const scope = { workspaceId: 'ws', userId: 'user', threadId: 'thread', jobId: 'job', assistantMessageId: 'assistant' }
const deps = {
  authorized: vi.fn(),
  begin: vi.fn(),
  dispatch: vi.fn(),
  record: vi.fn(),
  finalize: vi.fn(),
  evidence: vi.fn(),
  updateTimeline: vi.fn(),
}
beforeEach(() => {
  vi.clearAllMocks()
  deps.authorized.mockResolvedValue(true)
  deps.begin.mockResolvedValue(undefined)
  deps.dispatch.mockResolvedValue({ success: true, status: 'COMPLETED', toolId: 'credit.status', data: { balance: 37, secret: 'must-not-escape' } })
  deps.record.mockResolvedValue(undefined)
  deps.finalize.mockResolvedValue(undefined)
  deps.evidence.mockResolvedValue(undefined)
  deps.updateTimeline.mockResolvedValue(undefined)
})
describe('prepared read runtime adapter', () => {
  it('uses the claimed job and assistant, projects only public data, and never creates another turn', async () => {
    const result = await executePreparedConversationRead(scope, deps)
    expect(result.billingDisposition).toBe('release')
    expect(deps.begin).toHaveBeenCalledWith(scope)
    expect(deps.dispatch).toHaveBeenCalledWith(expect.objectContaining({ actionRunId: 'job', actorId: 'user', allowedCapabilityIds: ['credit.status'], intentMode: 'DRAFT' }))
    expect(deps.finalize).toHaveBeenCalledWith('조회 시점에 사용 가능한 크레딧은 37크레딧이에요. 처리 중인 예약분에 따라 잔액이 달라질 수 있어요.', true)
    expect(JSON.stringify(deps.finalize.mock.calls)).not.toContain('must-not-escape')
  })
  it('rejects a lost worker or revoked actor before any tool call', async () => {
    deps.authorized.mockResolvedValue(false)
    await expect(executePreparedConversationRead(scope, deps)).rejects.toThrow('CONVERSATION_AUTHORITY_LOST')
    expect(deps.dispatch).not.toHaveBeenCalled()
    expect(deps.begin).not.toHaveBeenCalled()
  })
  it('does not publish a late result after losing authority', async () => {
    deps.authorized.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(executePreparedConversationRead(scope, deps)).rejects.toThrow('CONVERSATION_AUTHORITY_LOST')
    expect(deps.finalize).not.toHaveBeenCalled()
  })
  it('does not turn a blocked tool or a missing balance into a successful zero', async () => {
    deps.dispatch.mockResolvedValue({ success: false, status: 'BLOCKED', toolId: 'credit.status' })
    const result = await executePreparedConversationRead(scope, deps)
    expect(result.safeErrorCode).toBe('CONVERSATION_READ_UNAVAILABLE')
    expect(deps.finalize).toHaveBeenCalledWith('크레딧을 확인하지 못했어요. 설정에서 잔액과 연결 상태를 확인해 주세요.', false)
    expect(deps.updateTimeline).toHaveBeenCalledWith('credit-read', 'failed')
  })

  it('handles interaction.list capability and summarizes received comments/DMs', async () => {
    deps.dispatch.mockResolvedValue({
      success: true,
      status: 'COMPLETED',
      toolId: 'interaction.list',
      data: { reviews: [{ id: 'c1' }, { id: 'c2' }], dmThreads: [{ id: 'dm1' }] },
    })

    const result = await executePreparedConversationRead(scope, deps, 'interaction.list')
    expect(result.status).toBe('completed')
    expect(result.safeErrorCode).toBeNull()
    expect(deps.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      allowedCapabilityIds: ['interaction.list', 'comment.reply_draft', 'dm.reply_draft'],
    }))
    expect(deps.updateTimeline).toHaveBeenCalledWith('interaction-read', 'in_progress')
    expect(deps.updateTimeline).toHaveBeenCalledWith('interaction-read', 'completed')
    expect(deps.finalize).toHaveBeenCalledWith(expect.stringContaining('댓글 2건'), true)
    expect(deps.finalize).toHaveBeenCalledWith(expect.stringContaining('DM 1건'), true)
  })

  it('handles reservation.list capability and summarizes reservation schedule', async () => {
    deps.dispatch.mockResolvedValue({
      success: true,
      status: 'COMPLETED',
      toolId: 'reservation.list',
      data: { count: 3, reservations: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] },
    })

    const result = await executePreparedConversationRead(scope, deps, 'reservation.list')
    expect(result.status).toBe('completed')
    expect(result.safeErrorCode).toBeNull()
    expect(deps.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      allowedCapabilityIds: ['reservation.list', 'customer.search'],
    }))
    expect(deps.updateTimeline).toHaveBeenCalledWith('reservation-read', 'in_progress')
    expect(deps.updateTimeline).toHaveBeenCalledWith('reservation-read', 'completed')
    expect(deps.finalize).toHaveBeenCalledWith(expect.stringContaining('3건'), true)
  })

  it('handles knowledge.search capability and summarizes knowledge facts', async () => {
    deps.dispatch.mockResolvedValue({
      success: true,
      status: 'COMPLETED',
      toolId: 'knowledge.search',
      data: { totalFound: 4, facts: [{ id: 'f1' }] },
    })

    const result = await executePreparedConversationRead(scope, deps, 'knowledge.search')
    expect(result.status).toBe('completed')
    expect(result.safeErrorCode).toBeNull()
    expect(deps.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      allowedCapabilityIds: ['knowledge.search'],
    }))
    expect(deps.updateTimeline).toHaveBeenCalledWith('knowledge-read', 'in_progress')
    expect(deps.updateTimeline).toHaveBeenCalledWith('knowledge-read', 'completed')
    expect(deps.finalize).toHaveBeenCalledWith(expect.stringContaining('4건'), true)
  })

  it('returns CONVERSATION_READ_UNAVAILABLE and friendly Korean message on failure for knowledge.search', async () => {
    deps.dispatch.mockResolvedValue({
      success: false,
      status: 'FAILED',
      toolId: 'knowledge.search',
    })

    const result = await executePreparedConversationRead(scope, deps, 'knowledge.search')
    expect(result.status).toBe('failed')
    expect(result.safeErrorCode).toBe('CONVERSATION_READ_UNAVAILABLE')
    expect(deps.updateTimeline).toHaveBeenCalledWith('knowledge-read', 'failed')
    expect(deps.finalize).toHaveBeenCalledWith('가게 지식을 확인하지 못했어요. 매장 정보 상태를 확인해 주세요.', false)
  })
})
