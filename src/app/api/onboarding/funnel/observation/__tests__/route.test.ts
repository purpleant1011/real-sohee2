import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const { authorize, range, eq } = vi.hoisted(() => ({ authorize: vi.fn(), range: vi.fn(), eq: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (value: unknown) => value instanceof NextResponse,
}))
import { GET } from '../route'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const get = () => GET(new Request(`http://localhost/api/onboarding/funnel/observation?workspaceId=${workspaceId}`))

beforeEach(() => {
  vi.clearAllMocks()
  const chain: Record<string, unknown> = {}
  Object.assign(chain, { select: () => chain, eq: (...args: unknown[]) => { eq(...args); return chain }, order: () => chain, range })
  authorize.mockResolvedValue({ workspaceId, userId: 'owner', admin: { from: () => chain } })
  range.mockResolvedValue({ data: [], error: null })
})

describe('GET /api/onboarding/funnel/observation', () => {
  it('returns NOT_OBSERVED (not 0) for an empty workspace and scopes the query to the authorized workspace', async () => {
    const body = await (await get()).json()
    expect(eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(body.observation.steps.every((s: { state: string; reached: unknown }) => s.state === 'NOT_OBSERVED' && s.reached === null)).toBe(true)
    expect(body.observation.generationCost).toMatchObject({ state: 'NOT_OBSERVED', totalCredits: null })
  })
  it('summarizes persisted events and drops rows of another workspace', async () => {
    range.mockResolvedValue({ data: [
      { event: 'signup_completed', workspace_id: workspaceId, user_id: 'owner', occurred_at: '2026-10-22T00:00:00Z', properties: {} },
      { event: 'photo_uploaded', workspace_id: workspaceId, user_id: 'owner', occurred_at: '2026-10-22T00:01:00Z', properties: {} },
      { event: 'signup_completed', workspace_id: 'other', user_id: 'x', occurred_at: '2026-10-22T00:00:00Z', properties: {} },
    ], error: null })
    const { observation } = await (await get()).json()
    expect(observation.steps[0]).toMatchObject({ state: 'OBSERVED', reached: 1 })
    expect(observation.steps[1]).toMatchObject({ state: 'OBSERVED', reached: 1 })
    expect(observation.excludedEvents).toBe(1)
  })
  it('reports a read error as 503, never as an empty funnel', async () => {
    range.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect((await get()).status).toBe(503)
  })
  it('passes an unauthorized response straight through', async () => {
    authorize.mockResolvedValueOnce(NextResponse.json({ error: 'login' }, { status: 401 }))
    expect((await get()).status).toBe(401)
  })
})
