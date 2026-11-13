import { describe, expect, it, vi, beforeEach } from 'vitest'

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

import { POST, GET } from './route'

describe('API: /api/missions/[id]/plan-diff', () => {
  const workspaceId = 'ws-test-1111'
  const missionId = 'm-test-2222'

  const mockContract = {
    contract_version: 1,
    goal: '가을 시그니처 펌 예약 10건 유치',
    success_criterion: {
      metric: 'verified_reservations',
      target_value: 10,
    },
    observation_window: {
      start_at: '2026-10-27T00:00:00.000Z',
      end_at: '2026-11-03T00:00:00.000Z',
    },
    service_scope: ['instagram', 'threads'],
    allowed_actions: ['PUBLISH_POST'],
    forbidden_actions: [],
    budget_caps: {
      max_cost_minor_units: 5000000,
      currency: 'KRW',
    },
    attention_policy: {
      max_escalations: 2,
      notify_on_breach: true,
    },
    fact_version_refs: {},
    policy_version: 'v1',
    approval_fingerprint: null,
    owner_actor: { actor_type: 'user' },
    effective_at: '2026-10-27T00:00:00.000Z',
    expires_at: '2099-11-05T00:00:00.000Z',
  }

  const mockMissionRow = {
    id: missionId,
    workspace_id: workspaceId,
    trace_id: 'trace-1234',
    status: 'PLANNING',
    goal: '가을 시그니처 펌 예약 10건 유치',
    metadata: {
      snapshot_version: 1,
      contract: mockContract,
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readPreferredWorkspaceIdFromCookies.mockResolvedValue(workspaceId)
    mocks.resolveCurrentWorkspaceContext.mockResolvedValue({
      status: 'success',
      context: { workspaceId, userId: 'usr-1' },
    })
  })

  it('computes plan diff for "인스타만, 예산 그대로" without modifying external state', async () => {
    mocks.createServerSupabaseClient.mockResolvedValueOnce({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockMissionRow, error: null }),
            }),
          }),
        }),
      }),
    })

    const req = new Request(`http://localhost/api/missions/${missionId}/plan-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        intentText: '인스타만 해줘, 예산 그대로',
        expectedSnapshotVersion: 1,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.is_ambiguous).toBe(false)
    expect(json.plan_diff.mission_id).toBe(missionId)
    expect(json.plan_diff.new_contract_version).toBe(2)
    expect(json.plan_diff.proposed_contract.service_scope).toEqual(['instagram'])
    expect(json.plan_diff.proposed_contract.budget_caps.max_cost_minor_units).toBe(5000000)
  })

  it('returns 409 Conflict when expectedSnapshotVersion diverges from current snapshot', async () => {
    mocks.createServerSupabaseClient.mockResolvedValueOnce({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockMissionRow, error: null }),
            }),
          }),
        }),
      }),
    })

    const req = new Request(`http://localhost/api/missions/${missionId}/plan-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        intentText: '인스타만 해줘',
        expectedSnapshotVersion: 99, // Stale version!
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(409)

    const json = await res.json()
    expect(json.code).toBe('STALE_SNAPSHOT_VERSION')
  })

  it('returns is_ambiguous: true and clarification_prompt for vague input', async () => {
    mocks.createServerSupabaseClient.mockResolvedValueOnce({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockMissionRow, error: null }),
            }),
          }),
        }),
      }),
    })

    const req = new Request(`http://localhost/api/missions/${missionId}/plan-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        intentText: '그거 좀 바꿔줘',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.is_ambiguous).toBe(true)
    expect(json.plan_diff).toBeNull()
    expect(json.clarification_prompt).toContain('어떤 부분을 변경할까요?')
  })
})
