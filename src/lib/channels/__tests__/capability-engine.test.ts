import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateEffectiveCapability } from '../capability-engine';

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn(),
}));

import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard';

describe('Channel Capability Engine (ANI-708)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns BLOCKED_BY_KILL_SWITCH when kill switch is engaged', async () => {
    vi.mocked(checkKillSwitchPreflight).mockResolvedValue({
      blocked: true,
      reason: '전역 킬스위치 긴급 활성화',
    });

    const mockSupabase = {} as any;
    const res = await calculateEffectiveCapability(mockSupabase, 'ws-123', 'INSTAGRAM');

    expect(res.status).toBe('BLOCKED_BY_KILL_SWITCH');
    expect(res.canPublish).toBe(false);
    expect(res.reason).toContain('전역 킬스위치');
  });

  it('returns REQUIRES_CONNECTION when no channel connection exists in DB', async () => {
    vi.mocked(checkKillSwitchPreflight).mockResolvedValue({ blocked: false });

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_capabilities') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { status: 'SUPPORTED', execution_plane: 'META_GRAPH_API' },
                }),
              }),
            }),
          };
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null }), // 미연결
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const res = await calculateEffectiveCapability(mockSupabase as any, 'ws-123', 'INSTAGRAM');

    expect(res.status).toBe('REQUIRES_CONNECTION');
    expect(res.canPublish).toBe(false);
    expect(res.requiresUserAction).toBe(true);
  });

  it('returns AVAILABLE when channel is connected with valid status', async () => {
    vi.mocked(checkKillSwitchPreflight).mockResolvedValue({ blocked: false });

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'channel_capabilities') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { status: 'SUPPORTED', execution_plane: 'META_GRAPH_API' },
                }),
              }),
            }),
          };
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'conn-meta-1',
                      status: 'connected',
                      auth_state: 'active',
                      last_verified_at: '2026-09-05T00:00:00.000Z',
                    },
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const res = await calculateEffectiveCapability(mockSupabase as any, 'ws-123', 'INSTAGRAM');

    expect(res.status).toBe('AVAILABLE');
    expect(res.canPublish).toBe(true);
    expect(res.requiresUserAction).toBe(false);
  });
});
