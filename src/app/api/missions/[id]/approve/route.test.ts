import { describe, expect, it, vi, beforeEach } from 'vitest'
import { computeContractApprovalHash } from '@/lib/mission-os/mission-plan-diff'

const mocks = vi.hoisted(() => ({ server: vi.fn(), admin: vi.fn(), resolve: vi.fn(), preferred: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.server }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.admin }))
vi.mock('@/features/auth/active-workspace.server', () => ({ readPreferredWorkspaceIdFromCookies: mocks.preferred }))
vi.mock('@/features/auth/current-workspace', () => ({ resolveCurrentWorkspaceContext: mocks.resolve }))
import { POST } from './route'

const contract = {
  contract_version: 2, goal: '신규 예약 10건',
  success_criterion: { metric: 'verified_reservations', target_value: 10 },
  observation_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2099-11-03T00:00:00Z' },
  service_scope: ['instagram'], allowed_actions: ['PUBLISH_POST'], forbidden_actions: [],
  budget_caps: { max_cost_minor_units: 50000, currency: 'CREDIT' },
  attention_policy: { max_escalations: 2, notify_on_breach: true }, fact_version_refs: {}, policy_version: 'v1',
  approval_fingerprint: null, owner_actor: { actor_type: 'user' as const, actor_id: 'owner' },
  effective_at: '2026-10-27T00:00:00Z', expires_at: '2099-11-05T00:00:00Z',
}
const params = { params: Promise.resolve({ id: 'mission' }) }
const validBody = () => ({ expectedSnapshotVersion: 2, idempotencyKey: 'approve-request-1', contractPayloadHash: computeContractApprovalHash(contract) })
const request = (body: unknown = validBody()) => new Request('http://localhost/api/missions/mission/approve', { method: 'POST', body: JSON.stringify(body) })

function database() {
  const row: any = { id: 'mission', workspace_id: 'workspace', trace_id: 'trace', status: 'AWAITING_APPROVAL', metadata: {
    snapshot_version: 2, execution_state: 'NEEDS_DECISION', contract: structuredClone(contract),
    approvedMission: { approvalId: 'actual-content-approval' }, multi_receipts: [{ receiptId: 'submitted' }],
  } }
  const from = () => {
    const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: structuredClone(row), error: null }) }
    return q
  }
  const rpc = vi.fn(async (_name, payload) => {
    if (row.metadata.snapshot_version !== payload.p_expected_snapshot_version) return { data: null, error: { code: 'P0004', message: 'STALE_SNAPSHOT_VERSION' } }
    row.metadata = { ...row.metadata, ...payload.p_new_metadata, snapshot_version: row.metadata.snapshot_version + 1 }
    row.status = payload.p_new_status
    return { data: structuredClone(row), error: null }
  })
  mocks.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'server-user' } } }) }, from })
  mocks.admin.mockReturnValue({ rpc })
  return { row, rpc }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.preferred.mockResolvedValue('workspace')
  mocks.resolve.mockResolvedValue({ status: 'ready', context: { workspaceId: 'workspace', userId: 'server-user', role: 'owner' } })
})

describe('mission contract approval (not content publish approval)', () => {
  it.each([{}, { expectedSnapshotVersion: 2 }, { ...validBody(), expectedSnapshotVersion: 0 }, { ...validBody(), expectedSnapshotVersion: 2.5 }, { ...validBody(), expectedSnapshotVersion: '2' }, { ...validBody(), idempotencyKey: '' }, { ...validBody(), contractPayloadHash: 'bad' }, { ...validBody(), actorId: 'forged' }])('requires a strict version, idempotency key and payload hash: %j', async (body) => {
    const { rpc } = database()
    expect((await POST(request(body), params)).status).toBe(422)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns 401 for null authenticated user even with cached workspace resolution', async () => {
    database()
    mocks.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } })
    expect((await POST(request(), params)).status).toBe(401)
  })

  it.each(['expired', 'forbidden'])('does not replay after permissions become %s', async (status) => {
    const { rpc } = database()
    expect((await POST(request(), params)).status).toBe(200)
    mocks.resolve.mockResolvedValue({ status })
    expect((await POST(request(), params)).status).toBe(status === 'expired' ? 401 : 403)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('rejects viewers', async () => {
    const { rpc } = database()
    mocks.resolve.mockResolvedValue({ status: 'ready', context: { workspaceId: 'workspace', role: 'viewer' } })
    expect((await POST(request(), params)).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('atomically records actor, contract approval and event without fabricating a content ledger ID', async () => {
    const { row, rpc } = database()
    const response = await POST(request(), params)
    expect(response.status).toBe(200)
    expect(await response.json()).not.toHaveProperty('approval_fingerprint')
    expect(row.metadata.execution_state).toBe('READY')
    expect(row.metadata.contract.approval_fingerprint).toMatch(/^appr_[a-f0-9]{64}$/)
    expect(row.metadata).not.toHaveProperty('approval_id')
    expect(row.metadata.approvedMission.approvalId).toBe('actual-content-approval')
    expect(row.metadata.multi_receipts).toEqual([{ receiptId: 'submitted' }])
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_actor_id: 'server-user', p_event_name: 'MISSION_CONTRACT_EXPLICITLY_APPROVED', p_event_payload: { approval_kind: 'MISSION_CONTRACT', idempotency_key: 'approve-request-1' } })
  })

  it('replays before stale check, including simultaneous requests, without a second approval event', async () => {
    const { rpc, row } = database()
    const responses = await Promise.all([POST(request(), params), POST(request(), params)])
    expect(responses.map((r) => r.status)).toEqual([200, 200])
    expect(row.metadata.snapshot_version).toBe(3)
    expect((await POST(request(), params)).status).toBe(200)
    // Only one successful RPC transaction; the racing request may attempt a stale CAS once.
    expect(rpc.mock.calls.filter(([, p]) => p.p_expected_snapshot_version === 3)).toHaveLength(0)
  })

  it('same key with a different hash conflicts even before stale check', async () => {
    database()
    await POST(request(), params)
    const response = await POST(request({ ...validBody(), contractPayloadHash: 'a'.repeat(64) }), params)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('rejects a hash for a contract different from authoritative stored terms', async () => {
    const { row, rpc } = database()
    row.metadata.contract.budget_caps.max_cost_minor_units++
    expect((await POST(request(), params)).status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects concurrent contract changes and never approves the replacement', async () => {
    const { row, rpc } = database()
    rpc.mockImplementationOnce(async () => {
      row.metadata.snapshot_version++
      row.metadata.contract.goal = 'concurrently changed'
      return { data: null, error: { code: 'P0004', message: 'STALE_SNAPSHOT_VERSION' } }
    })
    expect((await POST(request(), params)).status).toBe(409)
    expect(row.metadata.execution_state).toBe('NEEDS_DECISION')
  })

  it('does not undo a pause that wins immediately before the approval transaction', async () => {
    const { row, rpc } = database()
    rpc.mockImplementationOnce(async () => {
      row.metadata.snapshot_version++
      row.metadata.execution_state = 'PAUSED'
      row.metadata.control_epoch = 4
      row.status = 'PAUSED'
      return { data: null, error: { code: 'P0004', message: 'STALE_SNAPSHOT_VERSION' } }
    })
    expect((await POST(request(), params)).status).toBe(409)
    expect(row).toMatchObject({ status: 'PAUSED', metadata: { execution_state: 'PAUSED', snapshot_version: 3, control_epoch: 4 } })
    expect(row.metadata).not.toHaveProperty('contract_approvals')
    expect(row.metadata.contract.approval_fingerprint).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it.each(['PAUSED', 'PAUSING', 'STOPPED', 'CLOSED', 'CANCELLED', 'FAILED'])('cannot resume %s through approval', async (state) => {
    const { row, rpc } = database()
    row.metadata.execution_state = state
    expect((await POST(request(), params)).status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a replay after pause reports current state and does not resume it', async () => {
    const { row, rpc } = database()
    await POST(request(), params)
    row.status = 'PAUSED'
    row.metadata.execution_state = 'PAUSED'
    row.metadata.snapshot_version++
    const response = await POST(request(), params)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ replayed: true, execution_state: 'PAUSED' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
