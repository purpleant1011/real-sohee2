import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InteractionExecutor } from '@/lib/agent-os/executors/interaction-executor'
import { sendApprovedMetaResponse } from '@/features/channels/meta-response-provider'
import { customerDispatcher } from '@/features/tool-runtime/dispatchers/customer-dispatcher'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn(async () => ({})) }))
vi.mock('@/lib/safety/kill-switch-guard', () => ({ checkKillSwitchPreflight: vi.fn(async () => ({ blocked: false })) }))
vi.mock('@/features/channels/meta-response-provider', () => ({ sendApprovedMetaResponse: vi.fn() }))

const params = {
  workspaceId: '10000000-0000-4000-8000-000000000001', channel: 'INSTAGRAM' as const,
  connectionId: '20000000-0000-4000-8000-000000000001', externalAccountId: 'account',
  targetId: 'target', replyText: '승인 문안', intentMode: 'EXECUTE' as const,
}

beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('CAR ambiguous interaction delivery', () => {
  it.each(['replyToComment', 'sendDirectMessage'] as const)('%s does not claim no delivery when provider acknowledgement is lost', async method => {
    vi.mocked(sendApprovedMetaResponse).mockRejectedValue(new Error('connection closed after POST'))
    const result = await InteractionExecutor[method](params)
    expect(result).toMatchObject({ success: false, externalMessageSent: null, verified: false, errorCode: 'RESULT_UNKNOWN' })
    expect(result.providerReference).toBeUndefined()
    expect(result.statusMessage).not.toContain('connection closed')
    expect(sendApprovedMetaResponse).toHaveBeenCalledTimes(1)
  })

  it.each(['replyToComment', 'sendDirectMessage'] as const)('%s blocks cancellation before provider dispatch', async method => {
    const controller = new AbortController()
    controller.abort()
    await expect(InteractionExecutor[method]({ ...params, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(sendApprovedMetaResponse).not.toHaveBeenCalled()
  })

  it.each(['replyToComment', 'sendDirectMessage'] as const)('%s forwards caller cancellation to the provider boundary', async method => {
    const controller = new AbortController()
    vi.mocked(sendApprovedMetaResponse).mockRejectedValue(new Error('connection closed after POST'))
    await InteractionExecutor[method]({ ...params, signal: controller.signal })
    expect(sendApprovedMetaResponse).toHaveBeenCalledWith(expect.anything(), undefined, controller.signal)
  })

  it.each([
    ['comment.reply', 'replyToComment'], ['dm.send', 'sendDirectMessage'], ['review.respond', 'replyToComment'],
  ] as const)('%s forwards the run cancellation to the executor', async (tool, method) => {
    const controller = new AbortController()
    const executor = vi.spyOn(InteractionExecutor, method).mockResolvedValueOnce({
      success: false, intentMode: 'EXECUTE', requiresApproval: false,
      externalMessageSent: null, errorCode: 'RESULT_UNKNOWN', statusMessage: '전송 결과 확인 필요', verified: false,
    })
    await customerDispatcher.execute({ _toolName: tool, channel: 'INSTAGRAM', intentMode: 'EXECUTE', targetId: 'target', replyText: '승인 답변' }, {
      workspaceId: params.workspaceId, correlationId: 'trace', intentMode: 'EXECUTE', signal: controller.signal,
    })
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
  })

  it.each([
    ['comment.reply', 'replyToComment'], ['dm.send', 'sendDirectMessage'], ['review.respond', 'replyToComment'],
  ] as const)('%s preserves the non-retryable unknown state through the domain adapter', async (tool, method) => {
    vi.spyOn(InteractionExecutor, method).mockResolvedValueOnce({
      success: false, intentMode: 'EXECUTE', requiresApproval: false,
      externalMessageSent: null, errorCode: 'RESULT_UNKNOWN', statusMessage: '전송 결과 확인 필요', verified: false,
    })
    const result = await customerDispatcher.execute({ _toolName: tool, channel: 'INSTAGRAM', intentMode: 'EXECUTE', targetId: 'target', replyText: '승인 답변' }, {
      workspaceId: params.workspaceId, correlationId: 'trace', intentMode: 'EXECUTE',
    })
    expect(result).toMatchObject({ success: false, status: 'RESULT_UNKNOWN', error: { code: 'RESULT_UNKNOWN' } })
  })
})
