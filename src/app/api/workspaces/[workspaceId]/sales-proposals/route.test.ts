import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const workspaceId = 'A'
const NOW = '2026-10-21T10:00:00Z'
const mocks = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', async () => {
  const actual = await vi.importActual<typeof import('@/features/quick-start/route-auth')>('@/features/quick-start/route-auth')
  return { ...actual, authorizeQuickRequest: mocks.auth }
})
import { POST } from './route'

const visit = (id: string) => ({ workspaceId, customerId: id, bookingId: `b-${id}`, eventId: `v-${id}`, completedAt: '2026-07-01T00:00:00Z', evidenceRef: `visit-${id}`, actorRef: 'owner', source: 'OWNER_CONFIRMED' })
const consent = (id: string) => ({ id: `c-${id}`, workspaceId, customerId: id, channel: 'KAKAO', purpose: 'MARKETING', action: 'GRANTED', occurredAt: '2026-06-01T00:00:00Z', evidenceRef: `consent-${id}`, actorRef: 'owner', source: 'CUSTOMER_FORM' })
const slot = { state: 'SUCCESS', workspaceId, datasetMode: 'ACTUAL', freshness: 'CURRENT', coverage: 'COMPLETE',
  queryRange: { startsAt: '2026-10-21T23:00:00.000+09:00', endsAt: '2026-10-22T02:00:00.000+09:00' }, timezone: 'Asia/Seoul',
  source: { workspaceId, kind: 'OWNER_CONFIRMED', sourceId: 's', evidenceId: 'ev', checkedAt: '2026-10-21T09:55:00.000Z', validUntil: '2026-10-22T00:00:00.000Z', ledgerVersion: 'lv', confirmedByRef: 'owner' },
  ledgerVersion: 'lv',
  candidate: { slotId: 'slot-1', slotVersion: 'sv', catalogVersion: 'cat', workspaceId, serviceId: 'service-1', range: { startsAt: '2026-10-21T23:00:00.000+09:00', endsAt: '2026-10-22T00:00:00.000+09:00' }, timezone: 'Asia/Seoul', status: 'AVAILABLE',
    resource: { workspaceId, ledgerVersion: 'lv', resourceId: 'res', evidenceId: 'ev-res', version: 'rv', checkedAt: '2026-10-21T09:50:00.000Z', validUntil: '2026-10-22T00:00:00.000Z', capacity: 1, availableCapacity: 1 },
    service: { workspaceId, serviceId: 'service-1', catalogVersion: 'cat', evidenceId: 'ev-srv', checkedAt: '2026-10-21T09:50:00.000Z', validUntil: '2026-10-22T00:00:00.000Z', durationMinutes: 45, requiredCapacity: 1, priceKrw: 50000 } } }
const body = (over: Record<string, unknown> = {}) => ({ now: NOW, slotRequest: { queryRange: slot.queryRange, timezone: 'Asia/Seoul' }, slotSnapshot: slot, evidence: {
  workPhotos: { count: 2, rightsCleared: true, evidenceRef: 'photos' }, serviceFact: null, existingPost: null, recentKinds: [], discountGateInput: null, cta: null,
  revisit: { channel: 'KAKAO', policy: { version: 'rp', dueAfterDays: 30, confirmedBy: 'owner', evidenceRef: 'rp-proof' },
    customers: { status: 'OK', records: ['c1', 'c2'].map(customerId => ({ workspaceId, customerId, sourceRef: `crm-${customerId}` })) },
    visits: { status: 'OK', events: ['c1', 'c2'].map(visit) }, consents: { status: 'OK', events: [consent('c1')] } }, ...over } })
const call = (payload: unknown) => POST(new Request(`http://localhost/api/workspaces/${workspaceId}/sales-proposals`, { method: 'POST', body: JSON.stringify(payload) }), { params: Promise.resolve({ workspaceId }) })

beforeEach(() => mocks.auth.mockResolvedValue({ admin: {}, workspaceId, role: 'owner' }))

describe('ANI-1629/1626 sales proposal screen API', () => {
  it('excludes a customer without marketing consent from the real candidate call path', async () => {
    const res = await call(body())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.revisitAudience.recipientRefs).toEqual(['c1'])
    expect(data.revisitAudience.recipientRefs).not.toContain('c2')
    expect(data.proposals.find((p: any) => p.kind === 'OWNER_REVIEWED_FOLLOWUP')).toMatchObject({ audienceCount: 1 })
    expect(data.executionAllowed).toBe(false)
  })
  it('never returns an outbound recipient or a send permission', async () => {
    const data = await (await call(body())).json()
    expect(JSON.stringify(data)).not.toMatch(/outboundRecipient/)
    expect(data.executionAllowed).toBe(false)
  })
  it('requires owner review before returning proposals data', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: '권한이 없어요.' }, { status: 403 }))
    expect((await call(body())).status).toBe(403)
  })
  it('rejects a malformed evidence payload honestly', async () => {
    const res = await call({ now: NOW })
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('INVALID_INPUT')
  })
})
