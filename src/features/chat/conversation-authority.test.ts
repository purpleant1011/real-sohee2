import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConversationActor, isPreparedConversationOwned } from './conversation-authority'
const ws = '10000000-0000-4000-8000-000000000001'
const user = '20000000-0000-4000-8000-000000000001'
const thread = '30000000-0000-4000-8000-000000000001'
const job = { id: '40000000-0000-4000-8000-000000000001', workspaceId: ws, threadId: thread,
  userMessageId: '50000000-0000-4000-8000-000000000001', assistantMessageId: '60000000-0000-4000-8000-000000000001', workerId: '70000000-0000-4000-8000-000000000001', reservationId: '80000000-0000-4000-8000-000000000001', kind: 'chat' as const, status: 'running' as const, sequenceNumber: 1 }
let rows: Record<string, unknown>
const eq = vi.fn()
function database() {
  return { from: (table: string) => {
    const query = { select: () => query, eq: (...args: unknown[]) => { eq(table, ...args); return query }, maybeSingle: async () => ({ data: rows[table] ?? null, error: null }) }
    return query
  } }
}
beforeEach(() => {
  eq.mockClear()
  rows = { workspace_members: { role: 'manager', status: 'active' }, conversation_threads: { id: thread, workspace_id: ws, status: 'active' },
    conversation_jobs: { id: job.id, workspace_id: ws, thread_id: thread, user_message_id: job.userMessageId, assistant_message_id: job.assistantMessageId, worker_id: job.workerId, status: 'running' } }
})
describe('current conversation authority', () => {
  it('loads the current role without promoting it to owner', async () => {
    expect(await loadConversationActor(database(), { workspaceId: ws, userId: user, threadId: thread })).toEqual({ workspaceId: ws, userId: user, role: 'manager' })
    expect(eq).toHaveBeenCalledWith('workspace_members', 'user_id', user)
    expect(eq).toHaveBeenCalledWith('conversation_threads', 'workspace_id', ws)
  })
  it.each([{ role: 'owner', status: 'inactive' }, { role: 'forged', status: 'active' }, null])('denies invalid or revoked membership %j', async membership => {
    rows.workspace_members = membership
    expect(await loadConversationActor(database(), { workspaceId: ws, userId: user, threadId: thread })).toBeNull()
  })
  it('denies an archived or foreign thread', async () => {
    rows.conversation_threads = { id: thread, workspace_id: 'other', status: 'active' }
    expect(await loadConversationActor(database(), { workspaceId: ws, userId: user, threadId: thread })).toBeNull()
  })
  it('accepts only the current worker and exact prepared messages', async () => {
    expect(await isPreparedConversationOwned(database(), job)).toBe(true)
    rows.conversation_jobs = { ...(rows.conversation_jobs as object), worker_id: 'different-worker' }
    expect(await isPreparedConversationOwned(database(), job)).toBe(false)
  })
  it('denies cancelled jobs and a missing worker', async () => {
    rows.conversation_jobs = { ...(rows.conversation_jobs as object), status: 'cancel_requested' }
    expect(await isPreparedConversationOwned(database(), job)).toBe(false)
    expect(await isPreparedConversationOwned(database(), { ...job, workerId: null })).toBe(false)
  })
})
