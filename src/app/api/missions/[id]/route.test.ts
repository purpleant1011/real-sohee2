import { describe, expect, it, vi, beforeEach } from 'vitest'
import { computeContractApprovalHash } from '@/lib/mission-os/mission-plan-diff'

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  resolveCurrentWorkspaceContext: vi.fn(),
  readPreferredWorkspaceIdFromCookies: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}))

vi.mock('@/features/auth/active-workspace.server', () => ({
  readPreferredWorkspaceIdFromCookies: mocks.readPreferredWorkspaceIdFromCookies,
}))

vi.mock('@/features/auth/current-workspace', () => ({
  resolveCurrentWorkspaceContext: mocks.resolveCurrentWorkspaceContext,
}))

import { GET } from './route'

describe('GET /api/missions/[id]', () => {
  const workspaceId = 'ws-test-1111'
  const missionId = 'm-test-2222'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readPreferredWorkspaceIdFromCookies.mockResolvedValue('ws-test-1111')
  })

  it('returns 401 when auth session is expired', async () => {
    mocks.resolveCurrentWorkspaceContext.mockResolvedValueOnce({ status: 'expired' })

    const response = await GET(new Request('http://localhost/api/missions/m-1'), {
      params: Promise.resolve({ id: 'm-1' }),
    })

    expect(response.status).toBe(401)
    const json = await response.json()
    expect(json.error).toContain('인증 세션이 필요합니다')
  })

  it('returns 403 when access is forbidden for the workspace', async () => {
    mocks.resolveCurrentWorkspaceContext.mockResolvedValueOnce({ status: 'forbidden' })

    const response = await GET(new Request('http://localhost/api/missions/m-1'), {
      params: Promise.resolve({ id: 'm-1' }),
    })

    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.error).toContain('접근 권한이 없습니다')
  })

  it('returns 404 when active workspace is missing', async () => {
    mocks.resolveCurrentWorkspaceContext.mockResolvedValueOnce({ status: 'missing' })

    const response = await GET(new Request('http://localhost/api/missions/m-1'), {
      params: Promise.resolve({ id: 'm-1' }),
    })

    expect(response.status).toBe(404)
    const json = await response.json()
    expect(json.error).toContain('워크스페이스를 찾을 수 없습니다')
  })

  it('returns 404 when mission is not found in the workspace (tenant isolation)', async () => {
    mocks.resolveCurrentWorkspaceContext.mockResolvedValueOnce({
      status: 'ready',
      context: { workspaceId, role: 'owner', status: 'ACTIVE' },
    })
    mocks.createServerSupabaseClient.mockResolvedValueOnce({
      from: vi.fn().mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            eq: vi.fn().mockReturnValueOnce({
              maybeSingle: vi.fn().mockResolvedValueOnce({ data: null, error: null }),
            }),
          }),
        }),
      }),
    })

    const response = await GET(new Request(`http://localhost/api/missions/${missionId}`), {
      params: Promise.resolve({ id: missionId }),
    })

    expect(response.status).toBe(404)
    const json = await response.json()
    expect(json.code).toBe('MISSION_NOT_FOUND')
  })

  it.each(['owner', 'manager', 'viewer', 'malformed'])('projects review binding only for valid contracts and authorized %s', async (role) => {
    const contract = {
      contract_version: 1, goal: '예약 10건', success_criterion: { metric: 'reservations', target_value: 10 },
      observation_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2099-11-03T00:00:00Z' },
      service_scope: ['instagram'], allowed_actions: ['PUBLISH_POST'], forbidden_actions: [],
      budget_caps: { max_cost_minor_units: 50000, currency: 'CREDIT' },
      attention_policy: { max_escalations: 2, notify_on_breach: true }, fact_version_refs: {}, policy_version: 'v1',
      approval_fingerprint: null, owner_actor: { actor_type: 'user' as const, actor_id: 'owner' },
      effective_at: '2026-10-27T00:00:00Z', expires_at: '2099-11-05T00:00:00Z',
    }
    mocks.resolveCurrentWorkspaceContext.mockResolvedValueOnce({ status: 'ready', context: { workspaceId, role: role === 'malformed' ? 'owner' : role } })
    const query: any = { select: () => query, eq: vi.fn(() => query), maybeSingle: async () => ({ data: {
      id: missionId, workspace_id: workspaceId, status: 'AWAITING_APPROVAL', goal: contract.goal,
      created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z',
      metadata: { snapshot_version: 2, execution_state: 'NEEDS_DECISION', contract: role === 'malformed' ? {} : contract },
    }, error: null }) }
    mocks.createServerSupabaseClient.mockResolvedValueOnce({ from: () => query })
    const response = await GET(new Request(`http://localhost/api/missions/${missionId}`), { params: Promise.resolve({ id: missionId }) })
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(query.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    if (role === 'owner' || role === 'manager') {
      expect(json.contract_approval.payload_hash).toBe(computeContractApprovalHash(contract))
      expect(json.contract_approval.review_lines).toContain('예산 상한: 50,000 크레딧')
    } else expect(json.contract_approval).toBeNull()
    expect(json).not.toHaveProperty('metadata')
    expect(JSON.stringify(json)).not.toContain('approval_fingerprint')
  })

  it.each(['valid', 'foreign-job', 'foreign-thread', 'missing-thread'])('resolves the original conversation without creating a thread: %s', async (scenario) => {
    const jobId = '40000000-0000-4000-8000-000000000001'
    const threadId = '50000000-0000-4000-8000-000000000001'
    mocks.resolveCurrentWorkspaceContext.mockResolvedValueOnce({ status: 'ready', context: { workspaceId, role: 'owner' } })
    const reads: Array<{ table: string; filters: Record<string, unknown> }> = []
    mocks.createServerSupabaseClient.mockResolvedValueOnce({ from: (table: string) => {
      const filters: Record<string, unknown> = {}
      const query = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query }, maybeSingle: async () => {
        reads.push({ table, filters })
        if (table === 'marketing_missions') return { data: { id: missionId, workspace_id: workspaceId, source_conversation_job_id: jobId,
          status: 'COMPLETED', goal: '홍보 준비', created_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', metadata: {} }, error: null }
        if (table === 'conversation_jobs') return { data: { id: jobId, workspace_id: scenario === 'foreign-job' ? 'foreign' : workspaceId, thread_id: threadId }, error: null }
        if (table === 'conversation_threads') return { data: scenario === 'missing-thread' ? null : { id: threadId, workspace_id: scenario === 'foreign-thread' ? 'foreign' : workspaceId, status: 'active' }, error: null }
        throw new Error('unexpected table')
      } }
      return query
    } })
    const response = await GET(new Request(`http://localhost/api/missions/${missionId}`), { params: Promise.resolve({ id: missionId }) })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.conversation_href).toBe(scenario === 'valid' ? `/app/conversations/${threadId}` : null)
    expect(reads.every(read => read.filters.workspace_id === workspaceId)).toBe(true)
  })

  it('returns safe CanonicalMissionDTO without leaking raw DB row or internal admin snapshots', async () => {
    const rawMission = {
      id: missionId,
      workspace_id: workspaceId,
      trace_id: 'tr-123',
      status: 'PUBLISHED_VERIFIED',
      goal: '주말 예약 유치',
      target_channel: 'instagram',
      created_at: '2026-10-27T00:00:00.000Z',
      updated_at: '2026-10-27T02:00:00.000Z',
      metadata: {
        snapshot_version: 4,
        contract: {
          contract_version: 1,
          goal: '주말 예약 유치',
          success_criterion: { metric: 'clicks', target_value: 10 },
          observation_window: {
            start_at: '2026-10-27T00:00:00.000Z',
            end_at: '2026-10-28T00:00:00.000Z',
            evaluation_interval_hours: 1,
          },
        },
      },
    }

    mocks.resolveCurrentWorkspaceContext.mockResolvedValueOnce({
      status: 'ready',
      context: { workspaceId, role: 'owner', status: 'ACTIVE' },
    })
    mocks.createServerSupabaseClient.mockResolvedValueOnce({
      from: vi.fn().mockReturnValueOnce({
        select: vi.fn().mockReturnValueOnce({
          eq: vi.fn().mockReturnValueOnce({
            eq: vi.fn().mockReturnValueOnce({
              maybeSingle: vi.fn().mockResolvedValueOnce({ data: rawMission, error: null }),
            }),
          }),
        }),
      }),
    })

    const response = await GET(new Request(`http://localhost/api/missions/${missionId}`), {
      params: Promise.resolve({ id: missionId }),
    })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.canonicalDto.missionId).toBe(missionId)
    expect(json.canonicalDto.executionState).toBe('OBSERVING')
    expect(json.canonicalDto.outcomeState).toBe('PENDING')
    // Security check: raw DB row and internal admin snapshots are not leaked
    expect(json.mission).toBeUndefined()
    expect(json.snapshot).toBeUndefined()
  })
})
