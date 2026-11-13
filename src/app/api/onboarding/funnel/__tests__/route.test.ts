import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const { authorize, from, upsert, missionResult, eventResult } = vi.hoisted(() => ({
  authorize: vi.fn(), from: vi.fn(), upsert: vi.fn(), missionResult: vi.fn(), eventResult: vi.fn(),
}))
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof NextResponse,
}))
import { GET, POST, clientFunnelEventSchema } from '../route'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const missionId = '22222222-2222-4222-8222-222222222222'
const request = (body: unknown, header?: string) => new Request('http://localhost/api/onboarding/funnel', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(header ? { 'x-workspace-id': header } : {}) },
  body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  authorize.mockResolvedValue({ workspaceId, userId: 'owner', admin: { from } })
  upsert.mockResolvedValue({ error: null })
  missionResult.mockResolvedValue({ data: { id: missionId, status: 'AWAITING_APPROVAL', metadata: { lane: 'QUICK_POST', quick: { revision: 2 } } }, error: null })
  eventResult.mockResolvedValue({ data: [
    { event: 'signup_completed', user_id: 'owner', occurred_at: '2026-10-06T00:00:00Z' },
    { event: 'publish_verified', user_id: 'owner', occurred_at: '2026-10-06T00:09:00Z' },
  ], error: null })
  from.mockImplementation((table: string) => {
    if (table === 'marketing_missions') {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: missionResult }
      return chain
    }
    if (table === 'funnel_events') {
      const chain = { select: () => chain, eq: () => chain, order: () => chain, range: eventResult, upsert }
      return chain
    }
    throw new Error('unexpected table')
  })
})

describe('POST /api/onboarding/funnel', () => {
  it('only accepts strictly validated client-observable events', () => {
    for (const event of ['signup_completed', 'channel_connected', 'draft_ready', 'publish_confirmed', 'publish_verified', 'publish_failed']) {
      expect(clientFunnelEventSchema.safeParse({ event, missionId }).success).toBe(false)
    }
    expect(clientFunnelEventSchema.safeParse({ event: 'preview_viewed', missionId, extra: 'x' }).success).toBe(false)
    expect(clientFunnelEventSchema.safeParse({ event: 'revise_requested', missionId: 'garbage' }).success).toBe(false)
  })
  it('returns 401 before attempting a write if the user is anonymous', async () => {
    authorize.mockResolvedValueOnce(NextResponse.json({ error: 'login required' }, { status: 401 }))
    expect((await POST(request({ event: 'preview_viewed', missionId }))).status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })
  it('rejects forged outcomes and cross-workspace identifiers without writing', async () => {
    expect((await POST(request({ event: 'publish_verified', missionId }))).status).toBe(422)
    expect((await POST(request({ event: 'preview_viewed', missionId, workspaceId: '33333333-3333-4333-8333-333333333333' }))).status).toBe(403)
    expect(upsert).not.toHaveBeenCalled()
  })
  it('checks mission ownership and uses the resolved workspace rather than client data', async () => {
    missionResult.mockResolvedValueOnce({ data: null, error: null })
    expect((await POST(request({ event: 'preview_viewed', missionId }, workspaceId))).status).toBe(404)
    expect(upsert).not.toHaveBeenCalled()
    const res = await POST(request({ event: 'preview_viewed', missionId, revision: 2 }, workspaceId))
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: workspaceId, user_id: 'owner', dedupe_key: `preview_viewed:owner:${missionId}:2` }), expect.objectContaining({ ignoreDuplicates: true }))
    expect(authorize).toHaveBeenCalledWith(workspaceId)
  })
  it('rejects a stale revision and a mission outside the first-post lane', async () => {
    expect((await POST(request({ event: 'preview_viewed', missionId, revision: 1 }))).status).toBe(409)
    missionResult.mockResolvedValueOnce({ data: { id: missionId, status: 'AWAITING_APPROVAL', metadata: { lane: 'OTHER' } }, error: null })
    expect((await POST(request({ event: 'preview_viewed', missionId }))).status).toBe(404)
    expect(upsert).not.toHaveBeenCalled()
  })
  it('does not break the request on telemetry storage failure', async () => {
    upsert.mockRejectedValueOnce(new Error('database unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await POST(request({ event: 'revise_requested', missionId }))).status).toBe(200)
    warn.mockRestore()
  })
})

describe('GET /api/onboarding/funnel', () => {
  it('returns a workspace-scoped summary and the signed-in user duration', async () => {
    const res = await GET(new Request(`http://localhost/api/onboarding/funnel?workspaceId=${workspaceId}`))
    expect(res.status).toBe(200)
    const result = await res.json()
    expect(result.timeToFirstPostMs).toBe(540_000)
    expect(result.summary.cohortSize).toBe(1)
    expect(authorize).toHaveBeenCalledWith(workspaceId)
    expect(eventResult).toHaveBeenCalledWith(0, 999)
  })
  it('returns an error rather than a misleading empty funnel on read failures', async () => {
    eventResult.mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await GET(new Request('http://localhost/api/onboarding/funnel'))).status).toBe(503)
    warn.mockRestore()
  })
})
