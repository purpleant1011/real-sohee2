import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  resolveCurrentWorkspaceContext: vi.fn(),
  readPreferredWorkspaceIdFromCookies: vi.fn(),
  loadChannelCredentialByChannel: vi.fn(),
  getWorkspaceAuthoritativeCreditBalance: vi.fn(),
  loadApprovedFactSnapshot: vi.fn(),
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

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: mocks.loadChannelCredentialByChannel,
}))

vi.mock('@/features/credits/actual-spend-balance.server', () => ({
  getWorkspaceAuthoritativeCreditBalance: mocks.getWorkspaceAuthoritativeCreditBalance,
}))

vi.mock('@/features/knowledge/approved-fact-resolver', () => ({
  loadApprovedFactSnapshot: mocks.loadApprovedFactSnapshot,
}))

import { POST, PUT } from './route'

describe('API: /api/missions/[id]/rehearsal', () => {
  const workspaceId = 'ws-test-1111'
  const missionId = 'm-test-2222'

  const mockApprovedContract = {
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
    service_scope: ['instagram'],
    allowed_actions: ['PUBLISH_POST'],
    forbidden_actions: [],
    budget_caps: {
      max_cost_minor_units: 5000000,
      currency: 'CREDIT',
    },
    attention_policy: {
      max_escalations: 2,
      notify_on_breach: true,
    },
    fact_version_refs: { base_fact: 'fact_v1' },
    policy_version: 'v1',
    approval_fingerprint: 'a'.repeat(64),
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
      execution_state: 'READY',
      contract: mockApprovedContract,
      last_rehearsal: {
        success: true,
        is_rehearsal: true,
        kpi_isolated: true,
        live_provider_write_count: 0,
        rehearsal_run_id: 'reh_12345',
        contract_version: 1,
        receipts: [],
        total_simulated_cost_minor_units: 0,
        timeline_items: [],
        created_at: '2026-10-27T02:00:00.000Z',
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readPreferredWorkspaceIdFromCookies.mockResolvedValue(workspaceId)
    mocks.resolveCurrentWorkspaceContext.mockResolvedValue({
      status: 'success',
      context: { workspaceId, userId: 'usr-1', role: 'owner' },
    })
    mocks.loadChannelCredentialByChannel.mockResolvedValue({
      channel: 'instagram',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    })
    mocks.getWorkspaceAuthoritativeCreditBalance.mockResolvedValue({
      authoritativeAvailableCredits: 10000000,
      totalCredits: 10000000,
      spentCredits: 0,
    })
    mocks.loadApprovedFactSnapshot.mockResolvedValue({
      hash: 'fact_v1',
      version: 1,
    })
    mocks.createAdminSupabaseClient.mockReturnValue({
      rpc: async () => ({ error: null }),
    })
  })

  it('rejects mutation with 403 Forbidden for read-only viewer role', async () => {
    mocks.resolveCurrentWorkspaceContext.mockResolvedValueOnce({
      status: 'success',
      context: { workspaceId, userId: 'usr-viewer', role: 'viewer' },
    })

    const req = new Request(`http://localhost/api/missions/${missionId}/rehearsal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await POST(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(403)
  })

  it('runs preview rehearsal with 0 live provider writes and isolated KPI', async () => {
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

    const req = new Request(`http://localhost/api/missions/${missionId}/rehearsal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await POST(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.snapshot_version).toBe(2)
    expect(json.rehearsal.live_provider_write_count).toBe(0)
    expect(json.rehearsal.kpi_isolated).toBe(true)
    expect(json.rehearsal.is_rehearsal).toBe(true)
  })

  it('promotes rehearsal to live when preflight invariants are verified', async () => {
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

    const req = new Request(`http://localhost/api/missions/${missionId}/rehearsal`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await PUT(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.mode).toBe('LIVE')
  })

  it('rejects promotion when preflight invariants fail (disconnected channel)', async () => {
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

    // Simulate disconnected channel
    mocks.loadChannelCredentialByChannel.mockRejectedValueOnce(new Error('Channel disconnected'))

    const req = new Request(`http://localhost/api/missions/${missionId}/rehearsal`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await PUT(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(422)

    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('채널')
  })

  it('rejects promotion with 422 when contract is unapproved (approval_fingerprint is null)', async () => {
    const unapprovedRow = {
      ...mockMissionRow,
      metadata: {
        ...mockMissionRow.metadata,
        execution_state: 'NEEDS_DECISION',
        contract: {
          ...mockApprovedContract,
          approval_fingerprint: null,
        },
      },
    }

    mocks.createServerSupabaseClient.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: 'usr-1' } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: unapprovedRow, error: null }),
            }),
          }),
        }),
      }),
    })

    const req = new Request(`http://localhost/api/missions/${missionId}/rehearsal`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await PUT(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(422)

    const json = await res.json()
    expect(json.code).toBe('UNAPPROVED_CONTRACT')
  })

  it('rejects promotion with 422 when contract currency does not match authoritative CREDIT ledger', async () => {
    const currencyMismatchRow = {
      ...mockMissionRow,
      metadata: {
        ...mockMissionRow.metadata,
        contract: {
          ...mockApprovedContract,
          budget_caps: {
            ...mockApprovedContract.budget_caps,
            currency: 'KRW',
          },
        },
      },
    }

    mocks.createServerSupabaseClient.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: 'usr-1' } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: currencyMismatchRow, error: null }),
            }),
          }),
        }),
      }),
    })

    const req = new Request(`http://localhost/api/missions/${missionId}/rehearsal`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await PUT(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(422)

    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('통화 단위')
  })

  it('rejects promotion with 409 when mission is PAUSED', async () => {
    const pausedRow = {
      ...mockMissionRow,
      metadata: {
        ...mockMissionRow.metadata,
        execution_state: 'PAUSED',
      },
    }

    mocks.createServerSupabaseClient.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: 'usr-1' } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: pausedRow, error: null }),
            }),
          }),
        }),
      }),
    })

    const req = new Request(`http://localhost/api/missions/${missionId}/rehearsal`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    const res = await PUT(req, { params: Promise.resolve({ id: missionId }) })
    expect(res.status).toBe(409)

    const json = await res.json()
    expect(json.code).toBe('MISSION_PAUSED_CONFLICT')
  })
})
