import { describe, expect, it, vi, beforeEach } from 'vitest'
import { computePlanDiff } from '@/lib/mission-os/mission-plan-diff'

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  resolveCurrentWorkspaceContext: vi.fn(),
  readPreferredWorkspaceIdFromCookies: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}))

vi.mock('@/features/auth/active-workspace.server', () => ({
  readPreferredWorkspaceIdFromCookies: mocks.readPreferredWorkspaceIdFromCookies,
}))

vi.mock('@/features/auth/current-workspace', () => ({
  resolveCurrentWorkspaceContext: mocks.resolveCurrentWorkspaceContext,
}))

import { POST } from './route'

describe('API: /api/missions/[id]/apply-diff', () => {
  const workspaceId = 'ws-test-1111'
  const missionId = 'm-test-2222'

  const mockContractV1 = {
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
    forbidden_actions: ['DISCOUNT_OVER_30_PERCENT'],
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
    owner_actor: { actor_type: 'user', actor_id: 'owner_1' },
    effective_at: '2026-10-27T00:00:00.000Z',
    expires_at: '2099-11-05T00:00:00.000Z',
  }

  const mockDiff = computePlanDiff(
    mockContractV1 as any,
    { service_scope: ['instagram'] },
    {
      missionId,
      expectedSnapshotVersion: 1,
      idempotencyKey: 'idemp-1234',
      alreadySubmittedEffects: [],
      unexecutedSteps: [],
      existingApprovals: [],
    }
  )

  const correctPayloadHash = mockDiff.payload_hash

  const mockMissionRow = {
    id: missionId,
    workspace_id: workspaceId,
    trace_id: 'trace-1234',
    status: 'PLANNING',
    goal: '가을 시그니처 펌 예약 10건 유치',
    metadata: {
      snapshot_version: 1,
      contract: mockContractV1,
      applied_plan_idempotency_map: {},
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readPreferredWorkspaceIdFromCookies.mockResolvedValue(workspaceId)
    mocks.resolveCurrentWorkspaceContext.mockResolvedValue({
      status: 'success',
      context: { workspaceId, userId: 'usr-1', role: 'owner' },
    })
  })

  it('rejects mutation with 403 Forbidden for read-only viewer role', async () => {
    mocks.resolveCurrentWorkspaceContext.mockResolvedValueOnce({
      status: 'success',
      context: { workspaceId, userId: 'usr-viewer', role: 'viewer' },
    })

    const req = new Request(`http://localhost/api/missions/${missionId}/apply-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planDiff: mockDiff,
        expectedSnapshotVersion: 1,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toContain('권한이 없습니다')
  })

  it('atomically applies plan diff when snapshot version matches and hash is verified', async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'usr-1' } } }) },
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

    mocks.createAdminSupabaseClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({ data: mockMissionRow, error: null }),
            }),
          }),
        }),
      }),
      rpc: async (fnName: string) => {
        if (fnName === 'update_mission_snapshot_atomic') {
          return {
            data: {
              ...mockMissionRow,
              metadata: {
                snapshot_version: 2,
                contract: mockDiff.proposed_contract,
              },
            },
            error: null,
          }
        }
        return { data: null, error: null }
      },
    })

    const req = new Request(`http://localhost/api/missions/${missionId}/apply-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planDiff: mockDiff,
        expectedSnapshotVersion: 1,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.new_contract_version).toBe(2)
    expect(json.summary.service_scope).toEqual(['instagram'])
  })

  it('replays existing execution when identical idempotency key and payload hash are resubmitted', async () => {
    const replayedMissionRow = {
      ...mockMissionRow,
      metadata: {
        ...mockMissionRow.metadata,
        applied_plan_idempotency_map: {
          'idemp-1234': correctPayloadHash,
        },
      },
    }

    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'usr-1' } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: replayedMissionRow, error: null }),
            }),
          }),
        }),
      }),
    })

    const req = new Request(`http://localhost/api/missions/${missionId}/apply-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planDiff: mockDiff,
        expectedSnapshotVersion: 1,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.replayed).toBe(true)
  })

  it('returns 409 Conflict when existing idempotency key is resubmitted with a DIFFERENT payload hash', async () => {
    const conflictingMissionRow = {
      ...mockMissionRow,
      metadata: {
        ...mockMissionRow.metadata,
        applied_plan_idempotency_map: {
          'idemp-1234': 'different_hash_5678',
        },
      },
    }

    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'usr-1' } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: conflictingMissionRow, error: null }),
            }),
          }),
        }),
      }),
    })

    const req = new Request(`http://localhost/api/missions/${missionId}/apply-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planDiff: mockDiff,
        expectedSnapshotVersion: 1,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('rejects forged client diff with 400 Bad Request when payload_hash does not match server calculation', async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'usr-1' } } }) },
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

    const forgedDiff = {
      ...mockDiff,
      payload_hash: 'forged_fake_hash_9999',
    }

    const req = new Request(`http://localhost/api/missions/${missionId}/apply-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planDiff: forgedDiff,
        expectedSnapshotVersion: 1,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('FORGED_PLAN_DIFF_PAYLOAD')
  })

  it('fails with 409 Conflict when expectedSnapshotVersion is stale', async () => {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'usr-1' } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  ...mockMissionRow,
                  metadata: { ...mockMissionRow.metadata, snapshot_version: 5 }, // Stale!
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    })

    const req = new Request(`http://localhost/api/missions/${missionId}/apply-diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planDiff: mockDiff,
        expectedSnapshotVersion: 1, // Stale!
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(409)

    const json = await res.json()
    expect(json.code).toBe('STALE_SNAPSHOT_VERSION')
  })
})
