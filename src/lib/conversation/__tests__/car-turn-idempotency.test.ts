import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationRepository } from '../conversation-repository'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({ from }) }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ from, auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) } }) }))
const key = '00000000-0000-4000-8000-000000000001'
const row = { id: key, thread_id: 'thread', role: 'user', content: '검색해줘' }
function query(result: any) {
  const q: any = { select: vi.fn(() => q), eq: vi.fn(() => q), maybeSingle: vi.fn(async () => result), single: vi.fn(async () => result), insert: vi.fn(() => q), update: vi.fn(() => q) }
  q.then = (resolve: any) => Promise.resolve(result).then(resolve)
  return q
}
beforeEach(() => { vi.clearAllMocks(); from.mockReset() })

describe('CAR-04/05 canonical execution boundaries', () => {
  it('inserts a step intent without overwriting a prior completed or ambiguous step', async () => {
    const q = query({ data: null, error: { code: '23505', message: 'already recorded' } })
    from.mockReturnValue(q)
    await expect(ConversationRepository.beginAgentRunStep({ workspaceId: 'ws', runId: 'run', stepIndex: 1, capabilityId: 'publish.create', inputPayload: {} })).rejects.toThrow()
    expect(q.insert).toHaveBeenCalledWith(expect.objectContaining({ job_id: 'run', workspace_id: 'ws', state: 'running', provider_call_key: 'run:1' }))
  })
  it.each(['cancel_requested', 'cancelled', 'needs_attention', 'succeeded'])('blocks durable state %s', async status => {
    const q = query({ data: { status }, error: null }); from.mockReturnValue(q)
    expect(await ConversationRepository.isAgentRunExecutable('ws', 'run')).toBe(false)
    expect(q.eq).toHaveBeenCalledWith('workspace_id', 'ws')
  })
  it('fails closed on a missing run or database error', async () => {
    from.mockReturnValueOnce(query({ data: null, error: null }))
    expect(await ConversationRepository.isAgentRunExecutable('ws', 'run')).toBe(false)
    from.mockReturnValueOnce(query({ data: null, error: { code: '08006', message: 'offline' } }))
    await expect(ConversationRepository.isAgentRunExecutable('ws', 'run')).rejects.toThrow()
  })
})

describe('CAR-06 durable turn idempotency', () => {
  it('recovers a lost response by scoped client key without projecting private run fields', async () => {
    const message = query({ data: { id: key, thread_id: 'thread' }, error: null })
    const run = query({ data: { id: 'run', thread_id: 'thread', status: 'running', assistant_message_id: null, plan_data: { secret: 'PRIVATE' } }, error: null })
    from.mockReturnValueOnce(message).mockReturnValueOnce(run)
    const result = await ConversationRepository.getTurnRecoveryResult('ws', 'thread', key)
    expect(result).toMatchObject({ state: 'DATA', data: { runId: 'run', threadId: 'thread', status: 'running', assistantMessageId: null } })
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    for (const q of [message, run]) {
      expect(q.eq).toHaveBeenCalledWith('workspace_id', 'ws')
      expect(q.eq).toHaveBeenCalledWith('thread_id', 'thread')
      expect(q.insert).not.toHaveBeenCalled()
      expect(q.update).not.toHaveBeenCalled()
    }
    expect(message.eq).toHaveBeenCalledWith('client_message_id', key)
    expect(message.eq).toHaveBeenCalledWith('role', 'user')
    expect(run.eq).toHaveBeenCalledWith('user_message_id', key)
  })
  it('recovers the first turn when the response containing its thread ID was also lost', async () => {
    const message = query({ data: { id: key, thread_id: 'persisted-thread' }, error: null })
    const run = query({ data: { id: 'run', thread_id: 'persisted-thread', status: 'running', assistant_message_id: null }, error: null })
    from.mockReturnValueOnce(message).mockReturnValueOnce(run)
    const result = await ConversationRepository.getTurnRecoveryResult('ws', null, key)
    expect(result).toMatchObject({ state: 'DATA', data: { runId: 'run', threadId: 'persisted-thread' } })
    expect(message.eq).toHaveBeenCalledWith('workspace_id', 'ws')
    expect(message.eq).toHaveBeenCalledWith('client_message_id', key)
    expect(message.eq).not.toHaveBeenCalledWith('thread_id', null)
    expect(run.eq).toHaveBeenCalledWith('thread_id', 'persisted-thread')
    for (const q of [message, run]) {
      expect(q.insert).not.toHaveBeenCalled()
      expect(q.update).not.toHaveBeenCalled()
    }
  })
  it('fails closed instead of choosing a thread if the client key lookup is ambiguous', async () => {
    from.mockReturnValueOnce(query({ data: null, error: { code: 'PGRST116', message: 'multiple messages' } }))
    expect(await ConversationRepository.getTurnRecoveryResult('ws', null, key)).toMatchObject({ state: 'ERROR', errorCode: 'TURN_RECOVERY_UNAVAILABLE' })
    expect(from).toHaveBeenCalledTimes(1)
  })
  it.each([null, { id: key, thread_id: 'thread' }])('keeps absent messages and not-yet-created runs empty, not failed or retried: %j', async message => {
    from.mockReturnValueOnce(query({ data: message, error: null }))
      .mockReturnValueOnce(query({ data: null, error: null }))
    expect(await ConversationRepository.getTurnRecoveryResult('ws', 'thread', key)).toMatchObject({ state: 'EMPTY', data: null })
    expect(from).toHaveBeenCalledTimes(message ? 2 : 1)
  })
  it.each([0, 1])('keeps a database failure distinct from an unaccepted turn at read %i', async failureIndex => {
    if (failureIndex) from.mockReturnValueOnce(query({ data: { id: key, thread_id: 'thread' }, error: null }))
    from.mockReturnValueOnce(query({ data: null, error: { code: '08006', message: 'PRIVATE database detail' } }))
    const result = await ConversationRepository.getTurnRecoveryResult('ws', 'thread', key)
    expect(result.state).toBe('ERROR')
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
  it('rejects a client key belonging to another thread instead of returning its message', async () => {
    from.mockReturnValue(query({ data: { ...row, thread_id: 'other-thread' }, error: null }))
    await expect(ConversationRepository.saveMessage('ws', 'thread', 'user', row.content, { clientMessageId: key })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })
  it('rejects a key reused with different content', async () => {
    from.mockReturnValue(query({ data: row, error: null }))
    await expect(ConversationRepository.saveMessage('ws', 'thread', 'user', '수정해줘', { clientMessageId: key })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })
  it('returns the same message on an identical retry without inserting', async () => {
    const q = query({ data: row, error: null }); from.mockReturnValue(q)
    expect(await ConversationRepository.saveMessage('ws', 'thread', 'user', row.content, { clientMessageId: key })).toBe(key)
    expect(q.insert).not.toHaveBeenCalled()
  })
  it('recovers a concurrent unique insert loser by comparing the committed message', async () => {
    const lookup = query({ data: null, error: null })
    const insert = query({ data: null, error: { code: '23505', message: 'duplicate' } })
    const winner = query({ data: row, error: null })
    from.mockReturnValueOnce(lookup).mockReturnValueOnce(insert).mockReturnValueOnce(winner)
    expect(await ConversationRepository.saveMessage('ws', 'thread', 'user', row.content, { clientMessageId: key })).toBe(key)
  })
  it('reports the existing canonical run on unique conflict without creating another executor', async () => {
    from.mockReturnValueOnce(query({ data: null, error: { code: '23505', message: 'duplicate' } }))
      .mockReturnValueOnce(query({ data: { id: 'existing-run', thread_id: 'thread', goal: row.content }, error: null }))
    await expect(ConversationRepository.createAgentRun('ws', 'thread', row.content, {}, 'trace', key)).rejects.toMatchObject({ code: 'TURN_ALREADY_EXISTS', runId: 'existing-run', threadId: 'thread' })
  })
  it('does not recover a run from another thread', async () => {
    from.mockReturnValueOnce(query({ data: null, error: { code: '23505', message: 'duplicate' } }))
      .mockReturnValueOnce(query({ data: { id: 'other-run', thread_id: 'other', goal: row.content }, error: null }))
    await expect(ConversationRepository.createAgentRun('ws', 'thread', row.content, {}, 'trace', key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })
})
