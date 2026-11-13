import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ server: vi.fn(), admin: vi.fn(), resolve: vi.fn(), executeDual: vi.fn(), readiness: vi.fn(), killSwitch: vi.fn(), funnel: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.server }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.admin }))
vi.mock('@/features/auth/workspace-context', () => ({ resolveDeterministicWorkspace: mocks.resolve }))
vi.mock('@/features/publishing/dual-provider-publish-service', () => ({ executeDualProviderPublish: mocks.executeDual }))
vi.mock('@/features/quick-start/first-post-readiness', () => ({ requireFirstPostReady: mocks.readiness }))
vi.mock('@/lib/safety/kill-switch-guard', () => ({ checkKillSwitchPreflight: mocks.killSwitch }))
vi.mock('@/features/quick-start/funnel-events', () => ({ recordFunnelEvent: mocks.funnel }))

import { POST } from '../publish/route'

const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const missionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function setup(row: { status: string; metadata: any }) {
  const query: any = {
    select: () => query, eq: () => query, is: () => query,
    maybeSingle: async () => ({ data: { id: missionId, workspace_id: workspaceId, ...row }, error: null }),
  }
  mocks.admin.mockReturnValue({ from: () => query })
}
const req = (key?: string) => new Request('http://localhost/api/missions/first-post/publish', {
  method: 'POST', body: JSON.stringify({ missionId }), headers: key === undefined ? {} : { 'Idempotency-Key': key },
})

describe('G4 publish Idempotency-Key', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) } })
    mocks.resolve.mockResolvedValue({ success: true, workspaceId, role: 'owner' })
    mocks.readiness.mockResolvedValue(undefined)
    mocks.killSwitch.mockResolvedValue({ blocked: false })
  })

  it('same key on an EXECUTING mission returns consumed conflict (409) and never dispatches a provider', async () => {
    setup({ status: 'EXECUTING', metadata: { publishIdempotencyKey: 'k-1' } })
    const res = await POST(req('k-1'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ idempotentReplay: true, missionStatus: 'EXECUTING', success: false })
    expect(mocks.executeDual).not.toHaveBeenCalled()
  })

  it('same key on a FAILED mission returns consumed conflict (409, success false) — no second publish', async () => {
    setup({ status: 'FAILED', metadata: { publishIdempotencyKey: 'k-1', executionResult: { overallStatus: 'FAILED' } } })
    const res = await POST(req('k-1'))
    expect(res.status).toBe(409)
    expect((await res.json()).success).toBe(false)
    expect(mocks.executeDual).not.toHaveBeenCalled()
  })

  it('a different key does not replay (falls through to the normal state guard)', async () => {
    setup({ status: 'EXECUTING', metadata: { publishIdempotencyKey: 'k-1' } })
    const res = await POST(req('k-2'))
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('MISSION_NOT_IN_APPROVED_STATE')
  })

  it('empty or oversized key → 422 INVALID_IDEMPOTENCY_KEY', async () => {
    setup({ status: 'APPROVED', metadata: {} })
    expect((await POST(req('   '))).status).toBe(422)
    const res = await POST(req('x'.repeat(129)))
    expect((await res.json()).code).toBe('INVALID_IDEMPOTENCY_KEY')
  })
})
