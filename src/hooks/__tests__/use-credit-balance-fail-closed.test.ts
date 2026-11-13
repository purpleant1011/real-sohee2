import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCreditBalance } from '../use-credit-balance';

// Mock useWorkspaceId
vi.mock('../use-workspace-context', () => ({
  useWorkspaceId: () => 'ws-test-123',
  useWorkspaceContext: () => ({ workspaceId: 'ws-test-123' }),
  useOptionalWorkspaceContext: () => ({ workspaceId: 'ws-test-123' }),
}));

describe('useCreditBalance Fail-Closed & Canonical Ledger Integration (ANI-722)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads canonical conversation credits without subtracting reservations twice', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {
      activeJobCount: 0, attentionThreadCount: 0, threads: [],
      creditBalance: { available: 1234, weeklyLimit: 2000, consumed: 746, reserved: 20, policyVersion: 'live' },
      observedAt: '2026-10-29T10:00:00Z',
    } }) });
    const { result } = renderHook(() => useCreditBalance('ws-test-123', 'conversation'));
    await act(async () => { await result.current.refreshCredits(); });
    expect(global.fetch).toHaveBeenCalledWith('/api/workspaces/ws-test-123/conversation-work-status', { cache: 'no-store' });
    expect(result.current.balance).toBe(1234);
    expect(result.current.available).toBe(1234);
    expect(result.current.reserved).toBe(20);
    expect(result.current.capacity).toBe(2000);
  });

  it('does not accept legacy energy data as canonical conversation credits', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ balanceSC: 5000, capacity: 5000 }) });
    const { result } = renderHook(() => useCreditBalance('ws-test-123', 'conversation'));
    await act(async () => { await result.current.refreshCredits(); });
    expect(result.current.hasError).toBe(true);
    expect(result.current.balance).toBe(0);
  });

  it('1. Starts with 0 balance and isLoading=true until verified by server ledger', () => {
    // Mock hanging fetch
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useCreditBalance());

    expect(result.current.balance).toBe(0);
    expect(result.current.isLoading).toBe(true);
  });

  it('2. Enforces fail-closed (0 balance, DEPLETED status) when server fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useCreditBalance());

    await act(async () => {
      await result.current.refreshCredits();
    });

    expect(result.current.balance).toBe(0);
    expect(result.current.status).toBe('DEPLETED');
    expect(result.current.available).toBe(0);
  });

  it('3. reserveCredit returns FALSE (Fail-Closed) when server API fails — no client false-success', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useCreditBalance());

    let success: boolean = true;
    await act(async () => {
      success = await result.current.reserveCredit(500, 'mission-1');
    });

    expect(success).toBe(false);
    expect(result.current.reserved).toBe(0);
  });

  it('4. settleCredit returns FALSE (Fail-Closed) when server API fails — no client false-success', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useCreditBalance());

    let success: boolean = true;
    await act(async () => {
      success = await result.current.settleCredit('resv-1', 200);
    });

    expect(success).toBe(false);
  });

  it('5. Successfully loads authoritative server energy and maps to state', async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        workspaceId: 'ws-test-123',
        planTier: 'FREE_TASTE',
        monthlyTotalEnergy: 50,
        usedEnergyCurrentMonth: 10,
        reservedEnergyActiveRuns: 5,
        remainingAvailableEnergy: 35,
        burnRatePercentage: 30,
        budgetAlertStage: 'NORMAL',
        capacity: 5000,
        balanceSC: 3500,
        reservedSC: 500,
        usedCredits: 1000,
        status: 'ACTIVE',
      }),
    }));

    const { result } = renderHook(() => useCreditBalance());

    await act(async () => {
      await result.current.refreshCredits();
    });

    expect(result.current.balance).toBe(3500);
    expect(result.current.capacity).toBe(5000);
    expect(result.current.reserved).toBe(500);
    expect(result.current.available).toBe(3000);
    expect(result.current.status).toBe('ACTIVE');
    expect(result.current.burnGovernorActive).toBe(false);
  });

  it('6. Starts with capacity=0 and balance=0 while loading (no 5000 hardcoded fallback)', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useCreditBalance());

    expect(result.current.balance).toBe(0);
    expect(result.current.capacity).toBe(0);
    expect(result.current.isLoading).toBe(true);
    expect(Number.isNaN(result.current.usagePercentage)).toBe(false);
    expect(Number.isNaN(result.current.remainingPercentage)).toBe(false);
    expect(result.current.usagePercentage).toBe(0);
    expect(result.current.remainingPercentage).toBe(0);
  });

  it('7. Sets capacity=0, balance=0, hasError=true without NaN percentages when server errors', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const { result } = renderHook(() => useCreditBalance());

    await act(async () => {
      await result.current.refreshCredits();
    });

    expect(result.current.hasError).toBe(true);
    expect(result.current.balance).toBe(0);
    expect(result.current.capacity).toBe(0);
    expect(Number.isNaN(result.current.usagePercentage)).toBe(false);
    expect(Number.isNaN(result.current.remainingPercentage)).toBe(false);
    expect(result.current.usagePercentage).toBe(0);
    expect(result.current.remainingPercentage).toBe(0);
  });

  it('8. Uses exact server capacity (e.g. 600) and does not fall back to 5000', async () => {
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        workspaceId: 'ws-test-123',
        planTier: 'FREE_TASTE',
        capacity: 600,
        balanceSC: 350,
        reservedSC: 0,
        usedCredits: 250,
        usagePercentage: 42,
        status: 'ACTIVE',
      }),
    }));

    const { result } = renderHook(() => useCreditBalance());

    await act(async () => {
      await result.current.refreshCredits();
    });

    expect(result.current.capacity).toBe(600);
    expect(result.current.balance).toBe(350);
    expect(result.current.spent).toBe(250);
    expect(result.current.usagePercentage).toBe(42);
    expect(result.current.remainingPercentage).toBe(58);
  });
});
