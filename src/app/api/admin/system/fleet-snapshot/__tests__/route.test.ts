import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator';
import { createServerSupabaseClient } from '@/lib/supabase/server';

vi.mock('@/features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

describe('Admin Fleet Snapshot API (ANI-749 Same-Truth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAnyScope).mockResolvedValue({} as any);
  });

  it('calculates real telemetry and returns Truth Envelope without fake fallbacks', async () => {
    const mockWorkspaces = [
      { id: 'ws-1', name: '실제 사업자 A', created_at: '2026-09-01' },
      { id: 'ws-demo', name: '데모 헤어살롱', created_at: '2026-09-01' },
    ];

    const overdueTime = new Date(Date.now() - 5000).toISOString();
    const mockOverdue = [{ instance_id: 'auto-1', next_run_at: overdueTime }];

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'workspaces') {
          return {
            select: vi.fn().mockResolvedValue({ data: mockWorkspaces, error: null }),
          };
        }
        if (table === 'automation_instances') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                lt: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: mockOverdue, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'kill_switches') {
          const query: any = { select: () => query, eq: () => query, then: (resolve: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve) };
          return query;
        }
        if (table === 'work_proposals' || table === 'verified_proof_receipts' || table === 'workspace_knowledge_harnesses') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }),
    };

    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockSupabase as any);

    const req = new NextRequest('https://example.com/api/admin/system/fleet-snapshot');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.fleet.totalWorkspaces).toBe(2);
    expect(json.truthEnvelope.actualWorkspacesCount.value).toBe(1);
    expect(json.truthEnvelope.demoWorkspacesCount.value).toBe(1);
    expect(json.fleet.killSwitchState).toBe('NORMAL');
    expect(json.fleet.schedulerLagSeconds).toBeGreaterThanOrEqual(4.5);
    expect(json.truthEnvelope.schedulerLagSeconds.status).toBe('OK');
    expect(json.trace).toBeNull();
  });

  it('does not report NORMAL on kill-switch query failure, and detects multiple active global switches', async () => {
    const switchQuery = (data: unknown, error: unknown) => {
      const q: any = { select: () => q, eq: () => q, then: (resolve: (v: unknown) => void) => Promise.resolve({ data, error }).then(resolve) };
      return q;
    };
    const createDb = (data: unknown, error: unknown) => ({ from(table: string) {
      if (table === 'kill_switches') return switchQuery(data, error);
      if (table === 'workspaces') return { select: async () => ({ data: [], error: null }) };
      const q: any = { select: () => q, in: () => q, lt: () => q, order: () => q, limit: () => q,
        then: (resolve: (v: unknown) => void) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve) };
      return q;
    } });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(createDb(null, { message: 'timeout' }) as any);
    const req = new NextRequest('https://example.com/api/admin/system/fleet-snapshot');
    const bad = await (await GET(req)).json();
    expect(bad.fleet.killSwitchState).toBe('UNKNOWN');
    expect(bad.truthEnvelope.killSwitch.status).toBe('DEGRADED');

    vi.mocked(createServerSupabaseClient).mockResolvedValue(createDb([{ switch_id: 'one' }, { switch_id: 'two' }], null) as any);
    const active = await (await GET(req)).json();
    expect(active.fleet.killSwitchState).toBe('ACTIVATED');
  });

  it('handles database errors gracefully and returns DEGRADED status instead of false zero', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'workspaces') {
          return {
            select: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB connection timeout', code: 'TIMEOUT' } }),
          };
        }
        if (table === 'kill_switches') {
          const query: any = { select: () => query, eq: () => query, then: (resolve: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve) };
          return query;
        }
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      }),
    };

    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockSupabase as any);

    const req = new NextRequest('https://example.com/api/admin/system/fleet-snapshot');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.truthEnvelope.totalWorkspaces.value).toBeNull();
    expect(json.truthEnvelope.totalWorkspaces.status).toBe('DEGRADED');
    expect(json.truthEnvelope.totalWorkspaces.error_code).toBe('TIMEOUT');
  });
});
