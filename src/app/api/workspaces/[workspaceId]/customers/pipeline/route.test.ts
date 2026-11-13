import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
const { authorize, dataset } = vi.hoisted(() => ({ authorize: vi.fn(), dataset: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: authorize, isResponse: (value: unknown) => value instanceof Response }))
vi.mock('@/features/reporting/dataset', () => ({ readWorkspaceDataset: dataset }))
const context = { params: Promise.resolve({ workspaceId: 'workspace-a' }) }
const request = () => new Request('https://example.test/customers/pipeline')
function admin(results: Record<string, unknown>) {
  return { from: vi.fn((table: string) => {
    const query = { select: () => query, eq: () => query, in: () => query,
      order: async () => results[table] ?? { data: [], error: null } }
    return query
  }) }
}
beforeEach(() => { authorize.mockReset(); dataset.mockReset().mockResolvedValue({ mode: 'ACTUAL', state: 'OBSERVED' }) })
describe('customer pipeline truth', () => {
  it('requires an authorized workspace session before reading data', async () => {
    authorize.mockResolvedValue(new Response('{}', { status: 401 }))
    expect((await GET(request(), context)).status).toBe(401)
    expect(dataset).not.toHaveBeenCalled()
  })
  it('preserves actual DM history and booking intent without sample customers', async () => {
    authorize.mockResolvedValue({ workspaceId: 'workspace-a', admin: admin({
      instagram_dm_threads: { data: [{ id: 'thread-1', customer_handle: 'fixture_customer', last_message_text: '예약 가능할까요?', last_message_at: '2026-10-20T10:00:00Z', status: 'NEEDS_REPLY' }], error: null },
      instagram_dm_messages: { data: [{ thread_id: 'thread-1', sender_type: 'customer', text: '예약 가능할까요?', sent_at: '2026-10-20T10:00:00Z' }], error: null },
    }) })
    const response = await GET(request(), context)
    const body = await response.json()
    expect(body.kpis.inquiryCount).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: 'thread-1', handle: '@fixture_customer', channel: 'instagram', bookingIntent: true })
    expect(body.items[0].dialogueHistory[0].text).toBe('예약 가능할까요?')
  })
  it('does not hide a message history query failure', async () => {
    authorize.mockResolvedValue({ workspaceId: 'workspace-a', admin: admin({
      instagram_dm_threads: { data: [{ id: 'thread-1' }], error: null },
      instagram_dm_messages: { data: null, error: { message: 'private' } },
    }) })
    expect((await GET(request(), context)).status).toBe(503)
  })
  it.each(['instagram_dm_threads', 'reservations'])('does not present a failed %s query as an empty pipeline', async (table) => {
    authorize.mockResolvedValue({ workspaceId: 'workspace-a', admin: admin({ [table]: { data: null, error: { message: 'private details' } } }) })
    const response = await GET(request(), context)
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('private details')
  })
  it('counts current confirmed reservations once and never invents a conversion rate', async () => {
    authorize.mockResolvedValue({ workspaceId: 'workspace-a', admin: admin({ reservations: { data: [
      { id: 'confirmed', status: 'CONFIRMED' }, { id: 'confirmed', status: 'CONFIRMED' },
      { id: 'canceled', status: 'CANCELLED' }, { id: 'proposed', status: 'PROPOSED' },
    ], error: null } }) })
    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    expect((await response.json()).kpis).toMatchObject({ bookedCount: 1, canceledCount: 1, conversionRate: null })
  })
  it('does not query customer data for excluded datasets', async () => {
    const db = admin({})
    authorize.mockResolvedValue({ workspaceId: 'workspace-a', admin: db })
    dataset.mockResolvedValue({ mode: 'EXCLUDED', state: 'NOT_OBSERVED' })
    const response = await GET(request(), context)
    expect(await response.json()).toMatchObject({ items: [], reservations: [], datasetMode: 'EXCLUDED' })
    expect(db.from).not.toHaveBeenCalled()
  })
  it('never reads a fallback workspace different from the requested one', async () => {
    const db = admin({})
    authorize.mockResolvedValue({ workspaceId: 'workspace-b', admin: db })
    expect((await GET(request(), context)).status).toBe(404)
    expect(db.from).not.toHaveBeenCalled()
  })
})
