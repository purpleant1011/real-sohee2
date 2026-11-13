import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { loadAgentInbox } from './agent-inbox'
const ws = '20000000-0000-4000-8000-000000000001'
const dmId = '30000000-0000-4000-8000-000000000001'
function database(rows: Record<string, unknown>, errors: Record<string, unknown> = {}) {
  const filters: unknown[][] = []
  const update = vi.fn()
  const from = vi.fn((table: string) => {
    const data = rows[table] ?? []
    const result = { data, error: errors[table] ?? null }
    const chain: Record<string, unknown> = { update }
    for (const method of ['select', 'order', 'limit', 'in']) chain[method] = () => chain
    chain.eq = (...args: unknown[]) => { filters.push([table, ...args]); return chain }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
    chain.maybeSingle = async () => ({ ...result, data: Array.isArray(data) ? data[0] ?? null : data })
    return chain
  })
  return { client: { from } as unknown as ServerSupabaseClient, from, update, filters }
}
const thread = { id: dmId, workspace_id: ws, channel: 'instagram', status: 'NEEDS_REPLY',
  customer_handle: 'visitor', customer_name: null, last_message_text: '주말 예약이 가능한가요?',
  last_message_at: '2026-10-29T10:00:00Z', expires_at: '2026-10-30T10:00:00Z' }

describe('existing inbox data for conversation work', () => {
  it('reads actual comment and DM sources with current source-message references and no writes', async () => {
    const db = database({ social_comments: [{ id: '40000000-0000-4000-8000-000000000001', workspace_id: ws,
      channel: 'threads', comment_text: '가격 안내 부탁드려요.', author_handle: 'reader', status: 'DRAFTED', comment_created_at: '2026-10-29T10:00:00Z' }],
      instagram_dm_threads: [thread], instagram_dm_messages: [{ id: '50000000-0000-4000-8000-000000000001', workspace_id: ws,
        thread_id: dmId, text: thread.last_message_text, sent_at: thread.last_message_at }], instagram_dm_drafts: [] })
    const result = await loadAgentInbox({ client: db.client, workspaceId: ws })
    expect(result.reviews).toEqual([expect.objectContaining({ channel: 'threads', commentText: '가격 안내 부탁드려요.' })])
    expect(result.dmThreads).toEqual([expect.objectContaining({ id: dmId, latestCustomerMessageId: '50000000-0000-4000-8000-000000000001', lastMessageText: thread.last_message_text })])
    expect(result.source).toBe('stored_inbound_records')
    expect(db.filters).toContainEqual(['instagram_dm_threads', 'workspace_id', ws])
    expect(db.filters).toContainEqual(['instagram_dm_messages', 'workspace_id', ws])
    expect(db.update).not.toHaveBeenCalled()
  })
  it('honors an aggregate limit of one without implying that the unqueried DM inbox is empty', async () => {
    const db = database({ social_comments: [{ id: '40000000-0000-4000-8000-000000000001', workspace_id: ws,
      channel: 'threads', comment_text: '문의', status: 'NEW', comment_created_at: '2026-10-29T10:00:00Z' }],
      instagram_dm_threads: [thread] })
    const result = await loadAgentInbox({ client: db.client, workspaceId: ws, limit: 1 })
    expect(result.count).toBe(1)
    expect(result.partial).toBe(true)
    expect(result.scopes).toMatchObject({ dmRead: false })
    expect(db.from).not.toHaveBeenCalledWith('instagram_dm_threads')
  })
  it.each([{ kind: 'dm' as const, channel: 'threads' }, { kind: 'comments' as const, channel: 'instagram_dm' }])('rejects unsupported source/channel combinations: %j', async scope => {
    const db = database({})
    await expect(loadAgentInbox({ client: db.client, workspaceId: ws, ...scope })).rejects.toThrow('INBOX_CHANNEL_UNSUPPORTED')
    expect(db.from).not.toHaveBeenCalled()
  })
  it('never converts a failed DM query into a successful zero-DM result', async () => {
    const db = database({ social_comments: [], instagram_dm_threads: null }, { instagram_dm_threads: { code: 'NETWORK_ERROR' } })
    await expect(loadAgentInbox({ client: db.client, workspaceId: ws })).rejects.toThrow()
  })
  it('rejects foreign customer-message rows even behind a privileged read client', async () => {
    const db = database({ social_comments: [], instagram_dm_threads: [thread], instagram_dm_messages: [
      { id: '50000000-0000-4000-8000-000000000001', workspace_id: '21000000-0000-4000-8000-000000000001', thread_id: dmId, text: 'foreign', sent_at: thread.last_message_at },
    ] })
    await expect(loadAgentInbox({ client: db.client, workspaceId: ws })).rejects.toThrow('INBOX_SCOPE_MISMATCH')
  })
})
