import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { prepareConversationRetry } from './retry-safety.server'
const workspaceId = '20000000-0000-4000-8000-000000000001'
const threadId = '30000000-0000-4000-8000-000000000001'
const assistantMessageId = '40000000-0000-4000-8000-000000000001'
const userMessageId = '50000000-0000-4000-8000-000000000001'
const clientMessageId = '60000000-0000-4000-8000-000000000001'
const attachmentId = '70000000-0000-4000-8000-000000000001'
const job = { id: '80000000-0000-4000-8000-000000000001', workspace_id: workspaceId, thread_id: threadId, assistant_message_id: assistantMessageId, user_message_id: userMessageId, status: 'needs_attention', safe_error_code: 'CONVERSATION_CONTEXT_UNAVAILABLE', worker_id: '90000000-0000-4000-8000-000000000001' }
function database(origin: unknown = job, reconciled: unknown = true, blocked: unknown[] = []) {
  const rpc = vi.fn().mockResolvedValue({ data: reconciled, error: null })
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    for (const name of ['select', 'in', 'is', 'limit']) chain[name] = () => chain
    chain.eq = (key: string, value: unknown) => { filters[key] = value; return chain }
    chain.maybeSingle = async () => ({ data: table === 'conversation_jobs' ? origin : filters.role === 'sohee'
      ? { id: assistantMessageId, workspace_id: workspaceId, thread_id: threadId, role: 'sohee', status: 'failed', reply_to_message_id: userMessageId, error_code: null }
      : { id: userMessageId, workspace_id: workspaceId, thread_id: threadId, role: 'user', client_message_id: clientMessageId, usage_metadata: { attachmentIds: [attachmentId] } }, error: null })
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: blocked, error: null }).then(resolve)
    return chain
  })
  return { client: { from, rpc } as unknown as ServerSupabaseClient, rpc }
}
const scope = { workspaceId, threadId, assistantMessageId, clientMessageId }
describe('server-owned retry safety', () => {
  it('restores original attachment IDs only after the native zero-effect proof succeeds', async () => {
    const db = database()
    expect(await prepareConversationRetry({ ...scope, client: db.client })).toEqual({ attachmentIds: [attachmentId] })
    expect(db.rpc).toHaveBeenCalledWith('resolve_unstarted_conversation_job_attention', { p_workspace_id: workspaceId, p_job_id: job.id, p_worker_id: job.worker_id })
  })
  it('blocks ambiguous, running, and proof-negative background retries', async () => {
    for (const db of [database({ ...job, safe_error_code: 'PROVIDER_RESULT_UNKNOWN' }), database({ ...job, status: 'running' }), database(job, false)]) {
      await expect(prepareConversationRetry({ ...scope, client: db.client })).rejects.toThrow('CHAT_RETRY_RECONCILIATION_REQUIRED')
    }
  })
  it('does not bypass another unresolved job or a foreign origin', async () => {
    for (const db of [database(job, true, [{ id: job.id }]), database({ ...job, workspace_id: clientMessageId })]) {
      await expect(prepareConversationRetry({ ...scope, client: db.client })).rejects.toThrow('CHAT_RETRY_RECONCILIATION_REQUIRED')
    }
  })
  it('keeps ordinary foreground retries compatible but rejects mismatched original message IDs', async () => {
    expect(await prepareConversationRetry({ ...scope, client: database(null).client })).toEqual({ attachmentIds: [attachmentId] })
    await expect(prepareConversationRetry({ ...scope, clientMessageId: attachmentId, client: database(null).client })).rejects.toThrow('CHAT_RETRY_RECONCILIATION_REQUIRED')
  })
})
