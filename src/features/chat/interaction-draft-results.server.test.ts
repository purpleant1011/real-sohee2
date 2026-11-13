import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { loadConversationInteractionDrafts } from './interaction-draft-results.server'
vi.mock('server-only', () => ({}))
const workspaceId = '20000000-0000-4000-8000-000000000001'
const threadId = '30000000-0000-4000-8000-000000000001'
const messageId = '40000000-0000-4000-8000-000000000001'
const jobId = '50000000-0000-4000-8000-000000000001'
const stepId = '60000000-0000-4000-8000-000000000001'
const snapshot = { kind: 'interaction_draft', workspaceId, targetKind: 'comment',
  targetId: '70000000-0000-4000-8000-000000000001', draftId: '80000000-0000-4000-8000-000000000001',
  draftText: '상담 후 안내드릴게요.', fingerprint: 'a'.repeat(64), sourceRef: 'b'.repeat(64),
  channel: 'threads', customerLabel: '문의 고객', preparedAt: '2026-10-29T12:00:00Z', reused: false, requiresUserApproval: true }
function database(jobs: unknown, steps: unknown, error: unknown = null) {
  const filters: unknown[][] = []
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'order', 'limit']) chain[method] = () => chain
    for (const method of ['eq', 'in']) chain[method] = (...args: unknown[]) => { filters.push([table, method, ...args]); return chain }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'conversation_jobs' ? jobs : steps, error }).then(resolve)
    return chain
  })
  return { client: { from } as unknown as ServerSupabaseClient, from, filters }
}
const job = { id: jobId, workspace_id: workspaceId, thread_id: threadId, assistant_message_id: messageId, status: 'succeeded' }
const step = { id: stepId, workspace_id: workspaceId, job_id: jobId, capability_id: 'comment.reply_draft', status: 'completed', output_payload: snapshot }

describe('canonical conversation reply draft result hydration', () => {
  it('restores only actual job-step snapshots linked to this thread and assistant message', async () => {
    const db = database([job], [step])
    const result = await loadConversationInteractionDrafts({ client: db.client, workspaceId, threadId, messageIds: [messageId] })
    expect(result.get(messageId)).toEqual([{ id: stepId, ...snapshot }])
    expect(db.filters).toContainEqual(['conversation_jobs', 'eq', 'workspace_id', workspaceId])
    expect(db.filters).toContainEqual(['conversation_jobs', 'eq', 'thread_id', threadId])
    expect(db.filters).toContainEqual(['conversation_job_steps', 'in', 'job_id', [jobId]])
  })
  it('performs no database reads for messages without an actual draft result marker', async () => {
    const db = database([], [])
    expect((await loadConversationInteractionDrafts({ client: db.client, workspaceId, threadId, messageIds: [] })).size).toBe(0)
    expect(db.from).not.toHaveBeenCalled()
  })
  it('rejects a foreign snapshot rather than exposing privileged job output', async () => {
    const db = database([job], [{ ...step, output_payload: { ...snapshot, workspaceId: '21000000-0000-4000-8000-000000000001' } }])
    await expect(loadConversationInteractionDrafts({ client: db.client, workspaceId, threadId, messageIds: [messageId] })).rejects.toThrow('INTERACTION_DRAFT_SCOPE_MISMATCH')
  })
  it.each([
    { jobs: [{ ...job, thread_id: '31000000-0000-4000-8000-000000000001' }], steps: [step] },
    { jobs: [job], steps: [{ ...step, job_id: '51000000-0000-4000-8000-000000000001' }] },
    { jobs: [job], steps: [{ ...step, capability_id: 'dm.reply_draft' }] },
  ])('rejects inconsistent thread, job or draft-kind ownership', async ({ jobs, steps }) => {
    const db = database(jobs, steps)
    await expect(loadConversationInteractionDrafts({ client: db.client, workspaceId, threadId, messageIds: [messageId] }))
      .rejects.toThrow('CONVERSATION_DRAFT_RESULTS_SCOPE_MISMATCH')
  })
  it('does not turn a failed lookup into a confirmed empty result', async () => {
    const db = database(null, null, { code: 'NETWORK_ERROR' })
    await expect(loadConversationInteractionDrafts({ client: db.client, workspaceId, threadId, messageIds: [messageId] })).rejects.toThrow('CONVERSATION_DRAFT_RESULTS_UNAVAILABLE')
  })
})
