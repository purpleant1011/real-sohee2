import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getEnergy } from '../route';
import { POST as reserveEnergy } from '../reserve/route';
import { POST as settleEnergy } from '../settle/route';

const mockRequireWorkspaceMembership = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: (...args: unknown[]) => mockRequireWorkspaceMembership(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

describe('Agent Energy Canonical Ledger Routes (ANI-705, ANI-722)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. GET returns 401 when unauthenticated', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'AUTH_REQUIRED',
      message: '인증이 필요합니다.',
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy');
    const res = await getEnergy(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('AUTH_REQUIRED');
  });

  it('2. GET returns existing ledger with correct budget alert stage and energy balance', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    const mockCreditState = {
      workspace_id: 'ws-1',
      commercial_state: 'TRIAL_ACTIVE',
      activation_credits: 5000,
      agent_credits: 0,
      protected_wow_credits: 0,
      purchased_credits: 0,
      total_available_credits: 3500,
      updated_at: '2026-09-05T00:00:00Z',
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'workspace_credit_states') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValueOnce({ data: mockCreditState, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    mockRpc.mockImplementationOnce((fnName: string, args: Record<string, unknown>) => {
      if (fnName === 'get_workspace_authoritative_credit_balance') {
        expect(args).toEqual({ p_workspace_id: 'ws-1' });
        return Promise.resolve({
          data: {
            workspace_id: 'ws-1',
            authoritative_available_credits: 3500,
            state_total_credits: 3500,
            ledger_spendable_balance: 3500,
            has_signup_grant: false,
            updated_at: '2026-09-05T00:00:00Z',
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy');
    const res = await getEnergy(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(mockRpc).toHaveBeenCalledWith('get_workspace_authoritative_credit_balance', {
      p_workspace_id: 'ws-1',
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.planTier).toBe('FREE_TASTE');
    expect(data.capacity).toBe(5000);
    expect(data.monthlyTotalEnergy).toBe(5000);
    expect(data.remainingAvailableEnergy).toBe(3500);
    expect(data.balanceSC).toBe(3500);
    expect(data.forecastRunOutDays).toBeNull();
  });

  it('2-1. GET prioritizes authoritative RPC balance over creditState row as SSOT when they differ', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    const mockCreditState = {
      workspace_id: 'ws-1',
      commercial_state: 'TRIAL_ACTIVE',
      activation_credits: 5000,
      agent_credits: 0,
      protected_wow_credits: 0,
      purchased_credits: 0,
      total_available_credits: 3500, // creditState says 3500
      updated_at: '2026-09-05T00:00:00Z',
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'workspace_credit_states') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValueOnce({ data: mockCreditState, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    // Authoritative RPC returns 3000 (SSOT)
    mockRpc.mockImplementationOnce((fnName: string) => {
      if (fnName === 'get_workspace_authoritative_credit_balance') {
        return Promise.resolve({
          data: {
            workspace_id: 'ws-1',
            authoritative_available_credits: 3000,
            state_total_credits: 3500,
            ledger_spendable_balance: 3000,
            has_signup_grant: false,
            updated_at: '2026-09-05T00:00:00Z',
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy');
    const res = await getEnergy(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    // Authoritative balance (3000) must override creditState row (3500)
    expect(data.balanceSC).toBe(3000);
    expect(data.remainingAvailableEnergy).toBe(3000);
    expect(data.capacity).toBe(5000);
    expect(data.usedCredits).toBe(2000);
  });

  it('2-2. GET returns 503 fail-closed when authoritative RPC returns database error', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    const mockCreditState = {
      workspace_id: 'ws-1',
      commercial_state: 'TRIAL_ACTIVE',
      activation_credits: 5000,
      total_available_credits: 3500,
      updated_at: '2026-09-05T00:00:00Z',
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'workspace_credit_states') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValueOnce({ data: mockCreditState, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    mockRpc.mockImplementationOnce(() =>
      Promise.resolve({
        data: null,
        error: { message: 'relation or procedure error' },
      })
    );

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy');
    const res = await getEnergy(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('CREDIT_STATE_UNAVAILABLE');
  });

  it('2-3. GET returns 503 fail-closed when authoritative RPC returns malformed payload', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    const mockCreditState = {
      workspace_id: 'ws-1',
      commercial_state: 'TRIAL_ACTIVE',
      activation_credits: 5000,
      total_available_credits: 3500,
      updated_at: '2026-09-05T00:00:00Z',
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'workspace_credit_states') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValueOnce({ data: mockCreditState, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    mockRpc.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          workspace_id: 'ws-1',
          authoritative_available_credits: -100, // Invalid negative credits
          state_total_credits: 3500,
          ledger_spendable_balance: -100,
        },
        error: null,
      })
    );

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy');
    const res = await getEnergy(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('CREDIT_STATE_UNAVAILABLE');
  });

  it('2-4. GET returns 503 fail-closed when authoritative RPC returns mismatched workspaceId', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    const mockCreditState = {
      workspace_id: 'ws-1',
      commercial_state: 'TRIAL_ACTIVE',
      activation_credits: 5000,
      total_available_credits: 3500,
      updated_at: '2026-09-05T00:00:00Z',
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'workspace_credit_states') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValueOnce({ data: mockCreditState, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    mockRpc.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          workspace_id: 'ws-ANOTHER-TENANT', // Mismatched workspace tenant
          authoritative_available_credits: 3500,
          state_total_credits: 3500,
          ledger_spendable_balance: 3500,
        },
        error: null,
      })
    );

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy');
    const res = await getEnergy(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('CREDIT_STATE_UNAVAILABLE');
  });

  it('3. POST reserve fails with 402 ENERGY_EXHAUSTED when requested amount exceeds balance', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    const mockLedger = {
      workspace_id: 'ws-1',
      plan_tier: 'FREE_TASTE',
      monthly_total_energy: 50,
      used_energy_current_month: 40,
      reserved_energy_active_runs: 5,
      remaining_available_energy: 5,
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_energy_ledgers') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValueOnce({ data: mockLedger, error: null }),
            }),
          }),
        };
      }
      return {};
    });

    // Requesting 10 energy when only 5 are available
    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy/reserve', {
      method: 'POST',
      body: JSON.stringify({ amount: 10 }),
    });
    const res = await reserveEnergy(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(402);
    const data = await res.json();
    expect(data.error).toBe('ENERGY_EXHAUSTED');
    expect(data.remainingAvailable).toBe(5);
  });

  it('4. POST reserve succeeds and updates reserved amount when balance is sufficient', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    const mockLedger = {
      workspace_id: 'ws-1',
      plan_tier: 'FREE_TASTE',
      monthly_total_energy: 50,
      used_energy_current_month: 10,
      reserved_energy_active_runs: 0,
      remaining_available_energy: 40,
    };

    const updateMock = vi.fn().mockReturnThis();
    const eqMock = vi.fn().mockResolvedValueOnce({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_energy_ledgers') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValueOnce({ data: mockLedger, error: null }),
            }),
          }),
          update: updateMock.mockReturnValue({ eq: eqMock }),
        };
      }
      if (table === 'agent_energy_reservations') {
        return { insert: vi.fn().mockResolvedValueOnce({ error: null }) };
      }
      return {};
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy/reserve', {
      method: 'POST',
      body: JSON.stringify({ amount: 5, actionType: 'FIRST_CHANNEL_PUBLISH' }),
    });
    const res = await reserveEnergy(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.reservedAmount).toBe(5);
    expect(data.remainingAvailable).toBe(35);
  });

  it('5. POST settle updates used energy and releases reservation atomically', async () => {
    mockRequireWorkspaceMembership.mockResolvedValueOnce({
      ok: true,
      userId: 'usr-1',
      role: 'owner',
      workspaceId: 'ws-1',
    });

    const mockLedger = {
      workspace_id: 'ws-1',
      plan_tier: 'FREE_TASTE',
      monthly_total_energy: 50,
      used_energy_current_month: 10,
      reserved_energy_active_runs: 5,
      remaining_available_energy: 35,
    };

    const updateMock = vi.fn().mockReturnThis();
    const eqMock = vi.fn().mockResolvedValueOnce({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_energy_ledgers') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValueOnce({ data: mockLedger, error: null }),
            }),
          }),
          update: updateMock.mockReturnValue({ eq: eqMock }),
        };
      }
      if (table === 'agent_energy_transactions') {
        return { insert: vi.fn().mockResolvedValueOnce({ error: null }) };
      }
      return {};
    });

    const req = new NextRequest('http://localhost/api/workspaces/ws-1/agent/energy/settle', {
      method: 'POST',
      body: JSON.stringify({ reservationId: 'resv_123', actualSpent: 5, receiptId: 'rcpt_123' }),
    });
    const res = await settleEnergy(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.settledAmount).toBe(5);
    expect(data.remainingAvailable).toBe(35);
  });
});
