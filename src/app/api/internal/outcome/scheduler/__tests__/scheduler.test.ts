import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from '@/lib/supabase/server';

describe('Internal Outcome Scheduler Route (ANI-701)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed with 401 when Authorization header is missing', async () => {
    const req = new Request('http://localhost:3000/api/internal/outcome/scheduler', {
      method: 'POST',
      headers: {},
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain('valid CRON_SECRET is strictly required');
  });

  it('fails closed with 401 when Authorization header does not match secret', async () => {
    const req = new Request('http://localhost:3000/api/internal/outcome/scheduler', {
      method: 'POST',
      headers: {
        authorization: 'Bearer invalid_secret',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('evaluates and atomically claims due automations with valid secret', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'automation_instances') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        instance_id: 'inst_due_01',
                        workspace_id: 'ws-101',
                        automation_id: 'auto_insta',
                        current_state: 'SCHEDULED',
                        scheduled_at: '2026-09-04T00:00:00.000Z',
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { instance_id: 'inst_due_01' },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockSupabase as any);

    const req = new Request('http://localhost:3000/api/internal/outcome/scheduler', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test_cron_secret',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.evaluatedCount).toBe(1);
    expect(data.claimedCount).toBe(1);
    expect(data.claimedInstanceIds).toContain('inst_due_01');
  });
});
