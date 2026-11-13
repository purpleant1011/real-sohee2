import { describe, expect, it, vi } from 'vitest'
import { SupabaseInstagramDmRepository } from './repository'
function database(data: unknown, error: unknown = null) {
  const query: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'order', 'limit', 'lt']) query[name] = () => query
  const update = vi.fn(() => query)
  query.update = update
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve)
  return { client: { from: vi.fn(() => query) } as unknown as ConstructorParameters<typeof SupabaseInstagramDmRepository>[0], update }
}

describe('read-only agent DM access', () => {
  it('does not hide database failures as an empty verified inbox in strict mode', async () => {
    const db = database(null, { code: 'NETWORK_ERROR' })
    await expect(new SupabaseInstagramDmRepository(db.client).listThreads('workspace', { strict: true, readOnly: true })).rejects.toThrow('DM_THREADS_READ_UNAVAILABLE')
  })
  it('does not change thread status while only inspecting received messages', async () => {
    const db = database([{ id: 'thread', workspace_id: 'workspace', status: 'NEEDS_REPLY',
      expires_at: '2026-01-01T00:00:00Z', last_message_at: '2025-12-31T00:00:00Z' }])
    const result = await new SupabaseInstagramDmRepository(db.client).listThreads('workspace', { strict: true, readOnly: true })
    expect(result.threads[0].status).toBe('NEEDS_REPLY')
    expect(db.update).not.toHaveBeenCalled()
  })
})
