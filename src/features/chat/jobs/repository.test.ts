import { describe, expect, it, vi } from 'vitest'
import { createConversationJobRepository } from './repository'

const row = {
  id: '10000000-0000-4000-8000-000000000001',
  workspace_id: '20000000-0000-4000-8000-000000000001',
  thread_id: '30000000-0000-4000-8000-000000000001',
  user_message_id: '40000000-0000-4000-8000-000000000001',
  assistant_message_id: '50000000-0000-4000-8000-000000000001',
  reservation_id: '60000000-0000-4000-8000-000000000001',
  status: 'running',
  kind: 'chat',
  sequence_number: 1,
  worker_id: '70000000-0000-4000-8000-000000000001',
}

describe('conversation job repository', () => {
  it('retries zero-effect reconciliation on terminal queue redelivery with the original worker fence', async () => {
    const terminal = { ...row, status: 'needs_attention', safe_error_code: 'CONVERSATION_CONTEXT_UNAVAILABLE' }
    const rpc = vi.fn().mockResolvedValueOnce({ data: { state: 'terminal', job: terminal }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'transport' } })
    const repository = createConversationJobRepository({ rpc })
    const newWorker = '71000000-0000-4000-8000-000000000001'
    await expect(repository.claim(row.id, newWorker)).rejects.toThrow('CONVERSATION_JOB_ATTENTION_RECONCILIATION_FAILED')
    rpc.mockResolvedValueOnce({ data: { state: 'terminal', job: terminal }, error: null }).mockResolvedValueOnce({ data: true, error: null })
    expect((await repository.claim(row.id, newWorker)).state).toBe('terminal')
    expect(rpc).toHaveBeenLastCalledWith('resolve_unstarted_conversation_job_attention', {
      p_workspace_id: row.workspace_id, p_job_id: row.id, p_worker_id: row.worker_id,
    })
  })
  it('never reconciles ambiguous terminal outcomes on redelivery', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { state: 'terminal', job: { ...row, status: 'needs_attention', safe_error_code: 'PROVIDER_RESULT_UNKNOWN' } }, error: null })
    expect((await createConversationJobRepository({ rpc }).claim(row.id, row.worker_id)).state).toBe('terminal')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('reconciles only known pre-provider failures after fenced terminal persistence', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { state: 'claimed', job: row }, error: null })
    const repository = createConversationJobRepository({ rpc })
    const claimed = await repository.claim(row.id, row.worker_id)
    if (claimed.state !== 'claimed') throw new Error('fixture claim missing')
    rpc.mockResolvedValueOnce({ data: { job: { ...row, status: 'needs_attention' } }, error: null }).mockResolvedValueOnce({ data: true, error: null })
    await repository.complete(claimed.job, 'needs_attention', 'CONVERSATION_CONTEXT_UNAVAILABLE')
    expect(rpc).toHaveBeenLastCalledWith('resolve_unstarted_conversation_job_attention', {
      p_workspace_id: row.workspace_id, p_job_id: row.id, p_worker_id: row.worker_id,
    })
    rpc.mockResolvedValueOnce({ data: { job: { ...row, status: 'needs_attention' } }, error: null })
    await repository.complete(claimed.job, 'needs_attention', 'PROVIDER_RESULT_UNKNOWN')
    expect(rpc).toHaveBeenLastCalledWith('complete_conversation_job_v2', expect.any(Object))
  })
  it('uses the fenced terminal RPC and verifies the completed worker and job scope', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { state: 'claimed', job: row }, error: null })
    const repository = createConversationJobRepository({ rpc })
    const claimed = await repository.claim(row.id, row.worker_id)
    if (claimed.state !== 'claimed') throw new Error('fixture claim missing')
    rpc.mockResolvedValue({ data: { job: { ...row, status: 'succeeded' } }, error: null })
    await repository.complete(claimed.job, 'succeeded', null)
    expect(rpc).toHaveBeenLastCalledWith('complete_conversation_job_v2', expect.objectContaining({ p_job_id: row.id, p_worker_id: row.worker_id }))
    rpc.mockResolvedValue({ data: { job: { ...row, worker_id: '71000000-0000-4000-8000-000000000001', status: 'succeeded' } }, error: null })
    await expect(repository.complete(claimed.job, 'succeeded', null)).rejects.toThrow('CONVERSATION_JOB_COMPLETE_FAILED')
  })

  it('preserves the actual provider through the canonical usage RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { state: 'claimed', job: row }, error: null })
    const repository = createConversationJobRepository({ rpc })
    const claimed = await repository.claim(row.id, row.worker_id)
    if (claimed.state !== 'claimed') throw new Error('fixture claim missing')
    rpc.mockResolvedValue({ data: true, error: null })
    await repository.recordUsage(claimed.job, {
      providerCallKey: 'job:gemini:1', event: {
        provider: 'gemini', providerRequestId: 'actual-gemini-response', model: 'gemini-3.8-flash',
        operation: 'text_response', usageSource: 'actual',
        usage: { textInputTokens: 10, cachedTextInputTokens: 2, textOutputTokens: 5,
          imageInputTokens: 0, imageOutputTokens: 0, providerTotalTokens: 15 },
      },
    }, 1)
    expect(rpc).toHaveBeenLastCalledWith('record_ai_usage_event_v2', expect.objectContaining({ p_provider: 'gemini', p_job_id: row.id }))
  })

  it('strictly maps a claimed service row', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { state: 'claimed', job: row }, error: null })
    const repository = createConversationJobRepository({ rpc })
    await expect(repository.claim(row.id, '70000000-0000-4000-8000-000000000001')).resolves.toEqual({
      state: 'claimed',
      job: expect.objectContaining({ id: row.id, sequenceNumber: 1, status: 'running' }),
    })
  })

  it('rejects malformed or cross-workspace usage before an RPC write', async () => {
    const rpc = vi.fn()
    const repository = createConversationJobRepository({ rpc })
    await expect(repository.recordUsage({
      id: row.id,
      workspaceId: row.workspace_id,
      threadId: row.thread_id,
      userMessageId: row.user_message_id,
      assistantMessageId: row.assistant_message_id,
      reservationId: row.reservation_id,
      status: 'running',
      kind: 'chat',
      sequenceNumber: 1,
      workerId: '70000000-0000-4000-8000-000000000001',
    }, {
      providerCallKey: 'job:text:1',
      event: {
        provider: 'openai', providerRequestId: 'resp_1', model: 'gpt-5.6-luna', operation: 'text_response', usageSource: 'actual',
        usage: { textInputTokens: -1, cachedTextInputTokens: 0, textOutputTokens: 1, imageInputTokens: 0, imageOutputTokens: 0, providerTotalTokens: 0 },
      },
    }, 1)).rejects.toThrow('CONVERSATION_JOB_USAGE_INVALID')
    expect(rpc).not.toHaveBeenCalled()
  })
})
