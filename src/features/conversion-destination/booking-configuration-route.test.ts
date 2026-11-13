import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.auth, isResponse: (value: unknown) => value instanceof Response }))
import { handleBookingDestination } from './booking-configuration-route'

const workspaceId = 'a7000000-0000-4000-8000-000000000001'
const actorId = 'b7000000-0000-4000-8000-000000000001'
const commandId = 'c7000000-0000-4000-8000-000000000001'
const body = { bookingUrl: 'https://booking.example.com/shop-a', confirmed: true, commandId, expectedRevision: 0 }
function database() {
  const rows: Record<string, any>[] = []
  const reads: Array<Array<[string, unknown]>> = []
  const writes: Record<string, unknown>[] = []
  let failed = false
  return { rows, reads, writes, fail: () => { failed = true }, from: (table: string) => {
    if (table !== 'workspace_conversion_versions') throw new Error('Unexpected ledger')
    const filters: Array<[string, unknown]> = []
    let insert: any
    const result = () => {
      if (failed) return { data: null, error: { code: 'XX000' } }
      if (insert) {
        const duplicate = rows.some(row => row.workspace_id === insert.workspace_id && row.dataset_mode === insert.dataset_mode && (row.revision === insert.revision || row.command_id === insert.command_id))
        if (duplicate) return { data: null, error: { code: '23505' } }
        rows.push(structuredClone(insert))
        return { data: null, error: null }
      }
      reads.push([...filters])
      const matches = rows.filter(row => filters.every(([key, value]) => row[key] === value)).sort((a, b) => b.revision - a.revision)
      return { data: matches[0] ?? null, error: null }
    }
    const query: any = {
      select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
      order: () => query, limit: () => query, maybeSingle: async () => result(),
      insert: (value: Record<string, unknown>) => { writes.push(value); insert = value; return query },
      then: (resolve: (value: unknown) => void) => Promise.resolve(resolve(result())),
    }
    return query
  } }
}
function request(method: 'GET' | 'POST', value = body) {
  return new Request('http://localhost/api/first-value/destination', { method, ...(method === 'POST' ? { body: JSON.stringify(value) } : {}) })
}
beforeEach(() => vi.clearAllMocks())

describe('authenticated booking destination configuration', () => {
  it('stores once through the server command and reads the same workspace ACTUAL destination', async () => {
    const db = database()
    mocks.auth.mockResolvedValue({ workspaceId, userId: actorId, admin: db })
    const saved = await handleBookingDestination(request('POST'))
    expect(saved.status).toBe(200)
    expect((await saved.json()).configuration.revision).toBe(1)
    expect((await handleBookingDestination(request('POST'))).status).toBe(200)
    expect(db.rows).toHaveLength(1)
    const read = await handleBookingDestination(request('GET'))
    expect(read.status).toBe(200)
    expect((await read.json()).destination).toMatchObject({ kind: 'BOOKING_URL', networkVerified: false, evidenceSource: 'OWNER_CONFIRMATION' })
    expect(db.reads.every(filters => filters.some(([key, value]) => key === 'workspace_id' && value === workspaceId) && filters.some(([key, value]) => key === 'dataset_mode' && value === 'ACTUAL'))).toBe(true)
    expect(mocks.auth).toHaveBeenCalledWith(null, { requireRole: 'manager' })
  })

  it('validates campaign metadata before any configuration write', async () => {
    const db = database()
    mocks.auth.mockResolvedValue({ workspaceId, userId: actorId, admin: db })
    const result = await handleBookingDestination(new Request('http://localhost/api/first-value/destination?campaignTag=owner%40example.com', { method: 'POST', body: JSON.stringify(body) }))
    expect(result.status).toBe(422)
    expect(db.writes).toEqual([])
  })

  it('rejects client actor/workspace/mode overrides without writing', async () => {
    const db = database()
    mocks.auth.mockResolvedValue({ workspaceId, userId: actorId, admin: db })
    const result = await handleBookingDestination(request('POST', { ...body, workspaceId: 'other', actorId: 'other', datasetMode: 'TEST' } as any))
    expect(result.status).toBe(422)
    expect(db.writes).toEqual([])
  })

  it('does not return another workspace or TEST row and distinguishes query failures from missing configuration', async () => {
    const db = database()
    mocks.auth.mockResolvedValue({ workspaceId, userId: actorId, admin: db })
    await handleBookingDestination(request('POST'))
    db.rows[0].dataset_mode = 'TEST'
    expect((await (await handleBookingDestination(request('GET'))).json()).destination.kind).toBe('NOT_CONFIGURED')
    db.rows[0].dataset_mode = 'ACTUAL'
    db.rows[0].workspace_id = 'other'
    expect((await (await handleBookingDestination(request('GET'))).json()).destination.kind).toBe('NOT_CONFIGURED')
    db.fail()
    const failed = await handleBookingDestination(request('GET'))
    expect(failed.status).toBe(503)
    expect((await failed.json()).destination).toBeUndefined()
  })

  it('returns authorization failure before opening any configuration ledger', async () => {
    mocks.auth.mockResolvedValue(Response.json({ error: 'forbidden' }, { status: 403 }))
    expect((await handleBookingDestination(request('POST'))).status).toBe(403)
  })
})
