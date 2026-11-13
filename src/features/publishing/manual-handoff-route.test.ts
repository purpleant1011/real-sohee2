import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.auth, isResponse: (value: unknown) => value instanceof Response }))
import { handleManualHandoff } from './manual-handoff-route'

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const contentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const versionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const item = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', workspace_id: workspaceId, content_id: contentId, version_id: versionId, channel: 'threads', approval_state: 'APPROVED', approved_fingerprint: 'approved-v1', deleted_at: null }
function database() {
  const rows: Record<string, any[]> = { vault_items: [structuredClone(item)], vault_events: [] }
  const writes: string[] = []
  let readError = false
  return { rows, writes, failReads: () => { readError = true }, from: (table: string) => {
    const filters: Array<[string, unknown]> = []
    let value: any
    const result = () => {
      if (readError) return { data: null, error: { message: 'unavailable' } }
      if (value) { if (!rows[table].some((r) => r.id === value.id)) rows[table].push({ ...value, occurred_at: '2026-10-21T00:00:00Z' }); return { data: null, error: null } }
      return { data: rows[table].find((row) => filters.every(([key, expected]) => row[key] === expected)) ?? null, error: null }
    }
    const chain: any = {
      select: () => chain, eq: (key: string, expected: unknown) => { filters.push([key, expected]); return chain },
      is: (key: string, expected: unknown) => { filters.push([key, expected]); return chain },
      order: () => chain, limit: () => chain,
      maybeSingle: async () => result(),
      upsert: (row: unknown) => { writes.push(table); value = row; return chain },
      then: (resolve: (v: unknown) => void) => Promise.resolve(resolve(result())),
    }
    return chain
  } }
}
function request(method: 'GET' | 'POST' = 'POST') {
  const params = new URLSearchParams({ contentId, versionId, channel: 'threads' })
  return new Request(`http://localhost/api/first-value/handoff?${params}`, { method, ...(method === 'POST' ? { body: JSON.stringify({ contentId, versionId, channel: 'threads', confirmed: true }) } : {}) })
}
beforeEach(() => vi.clearAllMocks())

describe('manual handoff authenticated durable route', () => {
  it('persists only a vault event and restores the same owner report after reload/retry', async () => {
    const db = database()
    mocks.auth.mockResolvedValue({ workspaceId, userId: 'owner', admin: db })
    const saved = await handleManualHandoff(request())
    expect(saved.status).toBe(200)
    const body = await saved.json()
    expect(body.state).toBe('MANUAL_DELIVERED')
    expect(body.providerVerified).toBe(false)
    expect(await (await handleManualHandoff(request('GET'))).json()).toEqual(body)
    expect((await handleManualHandoff(request())).status).toBe(200)
    expect(db.rows.vault_events).toHaveLength(1)
    expect(new Set(db.writes)).toEqual(new Set(['vault_events']))
    expect(db.rows.vault_items[0]).toEqual(item)
    expect(mocks.auth).toHaveBeenCalledWith(null, { requireRole: 'manager' })
  })

  it('rejects another workspace and never writes', async () => {
    const db = database()
    db.rows.vault_items[0].workspace_id = 'other-workspace'
    mocks.auth.mockResolvedValue({ workspaceId, userId: 'owner', admin: db })
    const response = await handleManualHandoff(request())
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('VAULT_ITEM_REQUIRED')
    expect(db.writes).toEqual([])
  })

  it('distinguishes a missing event from a failed read', async () => {
    const db = database()
    mocks.auth.mockResolvedValue({ workspaceId, userId: 'owner', admin: db })
    expect(await (await handleManualHandoff(request('GET'))).json()).toMatchObject({ state: 'NOT_RECORDED' })
    db.failReads()
    expect((await handleManualHandoff(request('GET'))).status).toBe(503)
  })

  it('returns authorization failures without querying the ledger', async () => {
    mocks.auth.mockResolvedValue(Response.json({ error: 'forbidden' }, { status: 403 }))
    expect((await handleManualHandoff(request())).status).toBe(403)
  })
})
