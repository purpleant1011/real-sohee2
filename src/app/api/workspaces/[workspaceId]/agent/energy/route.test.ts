import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const mockRequireWorkspaceMembership = vi.fn();
const mockAdminFrom = vi.fn();
const mockAdminRpc = vi.fn();

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: (...args: unknown[]) => mockRequireWorkspaceMembership(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from: mockAdminFrom,
    rpc: mockAdminRpc,
  })),
}));

describe('GET /api/workspaces/[workspaceId]/agent/energy - Authoritative Credit State', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminRpc.mockResolvedValue({
      data: {
        workspace_id: 'ws-1',
        authoritative_available_credits: 350,
        state_total_credits: 600,
        ledger_spendable_balance: 350,
      },
      error: null,
    });
  });

  it('(e) returns status directly from requireWorkspaceMembership on membership failure', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'FORBIDDEN',
      message: '워크스페이스 멤버가 아닙니다.',
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('FORBIDDEN');
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });

  it('(a) calculates balance, capacity, usage and status correctly for trial row', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    const mockRow = {
      workspace_id: 'ws-1',
      commercial_state: 'TRIAL_ACTIVE',
      activation_credits: 600,
      agent_credits: 0,
      protected_wow_credits: 0,
      purchased_credits: 0,
      total_available_credits: 350,
      updated_at: '2026-10-01T00:00:00Z',
    };

    let capturedTable = '';
    let capturedFilterCol = '';
    let capturedFilterVal = '';

    mockAdminFrom.mockImplementation((table: string) => {
      capturedTable = table;
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((col: string, val: string) => {
            capturedFilterCol = col;
            capturedFilterVal = val;
            return {
              maybeSingle: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
            };
          }),
        }),
      };
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(capturedTable).toBe('workspace_credit_states');
    expect(capturedFilterCol).toBe('workspace_id');
    expect(capturedFilterVal).toBe('ws-1');

    // (a) 체험판 행: activation 600, total_available 350 -> balanceSC 350, capacity 600, usedCredits 250, usagePercentage 42, status ACTIVE
    expect(body.balanceSC).toBe(350);
    expect(body.capacity).toBe(600);
    expect(body.usedCredits).toBe(250);
    expect(body.usagePercentage).toBe(42); // Math.round((250 / 600) * 100) = 42
    expect(body.status).toBe('ACTIVE');
    expect(body.planTier).toBe('FREE_TASTE');
    expect(body.reservedSC).toBe(0);
    expect(body.forecastRunOutDays).toBeNull();
  });

  it('(b) calculates DEPLETED / EXHAUSTED when total_available_credits is 0', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    mockAdminRpc.mockResolvedValueOnce({
      data: {
        workspace_id: 'ws-1',
        authoritative_available_credits: 0,
        state_total_credits: 0,
        ledger_spendable_balance: 0,
      },
      error: null,
    });

    const mockRow = {
      workspace_id: 'ws-1',
      commercial_state: 'TRIAL_ACTIVE',
      activation_credits: 600,
      agent_credits: 0,
      protected_wow_credits: 0,
      purchased_credits: 0,
      total_available_credits: 0,
      updated_at: '2026-10-01T00:00:00Z',
    };

    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
        }),
      }),
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balanceSC).toBe(0);
    expect(body.capacity).toBe(600);
    expect(body.usedCredits).toBe(600);
    expect(body.usagePercentage).toBe(100);
    expect(body.budgetAlertStage).toBe('EXHAUSTED');
    expect(body.status).toBe('DEPLETED');
  });

  it('(c) returns 503 and does NOT insert into agent_energy_ledgers when row does not exist', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    const insertMock = vi.fn();
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'agent_energy_ledgers') {
        insertMock();
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        insert: insertMock,
      };
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('CREDIT_STATE_UNAVAILABLE');
    expect(body.message).toBeTruthy();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('(d) returns 503 on database query error without leaking internal SQL error details', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'pg_query error: syntax error at or near SELECT', code: '42601' },
          }),
        }),
      }),
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('CREDIT_STATE_UNAVAILABLE');
    expect(body.message).not.toContain('syntax error');
    expect(body.message).not.toContain('pg_query');
    expect(body.message).not.toContain('42601');
  });

  it('(f) query is strictly filtered by the provided workspaceId (tenant isolation)', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-tenant',
      role: 'owner',
      workspaceId: 'tenant-999',
    });

    let filteredByCol = '';
    let filteredByVal = '';

    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockImplementation((col: string, val: string) => {
          filteredByCol = col;
          filteredByVal = val;
          return {
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                workspace_id: 'tenant-999',
                commercial_state: 'ACTIVE',
                total_available_credits: 100,
                activation_credits: 100,
              },
              error: null,
            }),
          };
        }),
      }),
    });

    const req = new NextRequest('http://localhost/api/workspaces/tenant-999/agent/energy');
    await GET(req, { params: Promise.resolve({ workspaceId: 'tenant-999' }) });

    expect(filteredByCol).toBe('workspace_id');
    expect(filteredByVal).toBe('tenant-999');
  });

  it('(g) ensures capacity >= balanceSC even when sum of buckets is less than total_available_credits', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    const mockRow = {
      workspace_id: 'ws-1',
      commercial_state: 'ACTIVE',
      activation_credits: 0,
      agent_credits: 0,
      protected_wow_credits: 0,
      purchased_credits: 200,
      total_available_credits: 350, // available exceeds bucket sum (200)
      updated_at: '2026-10-01T00:00:00Z',
    };

    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
        }),
      }),
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balanceSC).toBe(350);
    expect(body.capacity).toBe(350);
    expect(body.capacity).toBeGreaterThanOrEqual(body.balanceSC);
    expect(body.usedCredits).toBe(0);
    expect(body.usagePercentage).toBe(0);
  });

  it('(h) prioritizes authoritative spendable balance over state row when drift exists', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-drift',
    });

    const mockRow = {
      workspace_id: 'ws-drift',
      commercial_state: 'TRIAL_ACTIVE',
      activation_credits: 600,
      total_available_credits: 10600, // inflated state row
      updated_at: '2026-10-21T00:00:00Z',
    };

    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
        }),
      }),
    });

    // Authoritative RPC returns 10,350 matching actual runtime spend condition
    mockAdminRpc.mockResolvedValueOnce({
      data: {
        workspace_id: 'ws-drift',
        authoritative_available_credits: 10350,
        state_total_credits: 10600,
        ledger_spendable_balance: 10350,
      },
      error: null,
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-drift/agent/energy');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-drift' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balanceSC).toBe(10350); // Correctly returns 10350, not 10600!
  });

  it('(i) returns 503 and never falls back to inflated total_available_credits when authoritative RPC fails', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-drift',
    });

    const mockRow = {
      workspace_id: 'ws-drift',
      commercial_state: 'TRIAL_ACTIVE',
      activation_credits: 600,
      total_available_credits: 10600, // inflated state row
      updated_at: '2026-10-21T00:00:00Z',
    };

    mockAdminFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
        }),
      }),
    });

    // Authoritative RPC fails
    mockAdminRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'authoritative rpc timeout' },
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-drift/agent/energy');
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-drift' }) });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('CREDIT_STATE_UNAVAILABLE');
    expect(body.message).toBe('크레딧 정보를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.');
  });
});
