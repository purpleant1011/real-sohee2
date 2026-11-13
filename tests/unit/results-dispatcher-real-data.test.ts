import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resultsDispatcher } from '@/features/tool-runtime/dispatchers/results-dispatcher';
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher';
import {
  setAdAccountResolver,
  resetAdAccountResolver,
  setMetaAdsProvider,
  resetMetaAdsProvider,
} from '@/features/tool-runtime/dispatchers/ads-dispatcher';

const mockDbState = {
  client: null as any,
};

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => mockDbState.client),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => mockDbState.client),
}));

describe('Task A: resultsDispatcher real database queries & verified facts only', () => {
  const WORKSPACE_A = '11111111-1111-4111-a111-111111111111';
  const WORKSPACE_B = '22222222-2222-4222-b222-222222222222';

  beforeEach(() => {
    resetAdAccountResolver();
    resetMetaAdsProvider();
    mockDbState.client = null;
    vi.clearAllMocks();
  });

  it('aggregates real verified facts across tables strictly filtered by workspace_id and generates Korean summaryText', async () => {
    // Ad account connected with spend
    setAdAccountResolver(async (wsId: string) => {
      if (wsId === WORKSPACE_A) {
        return {
          connected: true,
          accountId: 'act_live_123',
          provider: 'META_ADS',
          status: 'ACTIVE',
        };
      }
      return { connected: false };
    });

    setMetaAdsProvider({
      getSpendReporting: async () => ({
        spendKrw: 35000,
        impressions: 800,
        clicks: 25,
        reach: 700,
        roas: 2.1,
      }),
    } as any);

    // Mock DB data containing mixed workspaces
    const mockActionRequests = [
      { id: 'ar_1', workspace_id: WORKSPACE_A, channel: 'instagram', action_kind: 'feed_publish', status: 'succeeded', created_at: '2026-10-08T10:00:00Z' },
      { id: 'ar_2', workspace_id: WORKSPACE_A, channel: 'instagram', action_kind: 'feed_publish', status: 'succeeded', created_at: '2026-10-09T10:00:00Z' },
      { id: 'ar_3', workspace_id: WORKSPACE_A, channel: 'threads', action_kind: 'thread_publish', status: 'succeeded', created_at: '2026-10-09T11:00:00Z' },
      { id: 'ar_other', workspace_id: WORKSPACE_B, channel: 'instagram', action_kind: 'feed_publish', status: 'succeeded', created_at: '2026-10-09T10:00:00Z' },
    ];

    const mockChannelDrafts = [
      { id: 'cd_1', workspace_id: WORKSPACE_A, created_at: '2026-10-08T09:00:00Z' },
      { id: 'cd_2', workspace_id: WORKSPACE_A, created_at: '2026-10-09T09:00:00Z' },
      { id: 'cd_other', workspace_id: WORKSPACE_B, created_at: '2026-10-09T09:00:00Z' },
    ];

    const mockVaultItems = [
      { id: 'vi_1', workspace_id: WORKSPACE_A, created_at: '2026-10-08T12:00:00Z', deleted_at: null },
      { id: 'vi_other', workspace_id: WORKSPACE_B, created_at: '2026-10-08T12:00:00Z', deleted_at: null },
    ];

    const mockCreditLedger = [
      { id: 'cl_1', workspace_id: WORKSPACE_A, kind: 'consume', amount: 50, occurred_at: '2026-10-08T10:00:00Z' },
      { id: 'cl_2', workspace_id: WORKSPACE_A, kind: 'consume', amount: 100, occurred_at: '2026-10-09T10:00:00Z' },
      { id: 'cl_other', workspace_id: WORKSPACE_B, kind: 'consume', amount: 500, occurred_at: '2026-10-09T10:00:00Z' },
    ];

    const mockReservations = [
      { id: 'res_1', workspace_id: WORKSPACE_A, status: 'CONFIRMED', confirmed_at: '2026-10-09T14:00:00Z', created_at: '2026-10-09T14:00:00Z' },
      { id: 'res_other', workspace_id: WORKSPACE_B, status: 'CONFIRMED', confirmed_at: '2026-10-09T14:00:00Z', created_at: '2026-10-09T14:00:00Z' },
    ];

    mockDbState.client = {
      from: vi.fn((table: string) => {
        let wsFilter: string | null = null;
        let statusFilter: string | null = null;
        let kindFilter: string | null = null;

        const builder: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: string) => {
            if (col === 'workspace_id') wsFilter = val;
            if (col === 'status') statusFilter = val;
            if (col === 'kind') kindFilter = val;
            return builder;
          }),
          in: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          then: (resolve: any) => {
            let data: any[] = [];
            if (table === 'external_action_requests') {
              data = mockActionRequests.filter(
                (r) => r.workspace_id === wsFilter && (!statusFilter || r.status === statusFilter)
              );
            } else if (table === 'channel_drafts') {
              data = mockChannelDrafts.filter((r) => r.workspace_id === wsFilter);
            } else if (table === 'vault_items') {
              data = mockVaultItems.filter((r) => r.workspace_id === wsFilter);
            } else if (table === 'credit_ledger_entries') {
              data = mockCreditLedger.filter(
                (r) => r.workspace_id === wsFilter && (!kindFilter || r.kind === kindFilter)
              );
            } else if (table === 'reservations') {
              data = mockReservations.filter(
                (r) => r.workspace_id === wsFilter && (!statusFilter || r.status === statusFilter)
              );
            }
            return Promise.resolve(resolve({ data, error: null }));
          },
        };
        return builder;
      }),
    };

    const result = await resultsDispatcher.execute(
      { period: 'last_week' },
      {
        workspaceId: WORKSPACE_A,
        correlationId: 'corr_test_results',
      }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETED');
    expect(result.data).toBeDefined();

    const data = result.data as any;
    const metrics = data.metrics;
    // 1. Published posts
    expect(metrics.publishedPosts.total).toBe(3);
    expect(metrics.publishedPosts.byChannel.instagram).toBe(2);
    expect(metrics.publishedPosts.byChannel.threads).toBe(1);
    expect(metrics.publishedPosts.state).toBe('OK');

    // 2. Drafts created
    expect(metrics.draftsCreated.total).toBe(2);
    expect(metrics.draftsCreated.state).toBe('OK');

    // 3. Vault saved
    expect(metrics.vaultSaved.total).toBe(1);
    expect(metrics.vaultSaved.state).toBe('OK');

    // 4. Credits used
    expect(metrics.creditsUsed.total).toBe(150);
    expect(metrics.creditsUsed.state).toBe('OK');

    // 5. Reservations
    expect(metrics.reservationsCount.total).toBe(1);
    expect(metrics.reservationsCount.state).toBe('OK');

    // 6. Ad spend
    // 이 도구는 광고 지출 숫자를 만들지 않는다(캠페인별 실측은 ads.list). 연동돼 있어도 value 는 null.
    expect(metrics.adSpendKrw.value).toBeNull();
    expect(metrics.adSpendKrw.state).toBe('UNAVAILABLE');
    expect(metrics.adSpendKrw.reason).toContain('광고 성과');

    // 7. Revenue must be null with honest reason (zero fabricated revenue)
    expect(metrics.revenueKrw.value).toBeNull();
    expect(metrics.revenueKrw.state).toBe('UNAVAILABLE');
    expect(metrics.revenueKrw.reason).toBe('매출 데이터가 연동되어 있지 않아요');

    // Summary text must be in clean Korean without internal codes or UUIDs
    expect(data.summaryText).toContain('인스타그램');
    expect(data.summaryText).toContain('3건');
    expect(data.summaryText).toContain('150');
    expect(data.summaryText).not.toContain('AWAITING_INITIAL_DATA');
    expect(data.summaryText).not.toContain(WORKSPACE_A);
  });

  it('handles empty database records cleanly with state: EMPTY and does not fabricate numbers', async () => {
    // Ad account not connected
    setAdAccountResolver(async () => ({ connected: false }));

    mockDbState.client = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        then: (resolve: any) => Promise.resolve(resolve({ data: [], error: null })),
      })),
    };

    const result = await resultsDispatcher.execute(
      {},
      {
        workspaceId: WORKSPACE_A,
        correlationId: 'corr_test_empty',
      }
    );

    expect(result.success).toBe(true);
    const emptyData = result.data as any;
    const metrics = emptyData.metrics;
    expect(metrics.publishedPosts.total).toBe(0);
    expect(metrics.publishedPosts.state).toBe('EMPTY');
    expect(metrics.draftsCreated.total).toBe(0);
    expect(metrics.draftsCreated.state).toBe('EMPTY');
    expect(metrics.vaultSaved.total).toBe(0);
    expect(metrics.vaultSaved.state).toBe('EMPTY');
    expect(metrics.creditsUsed.total).toBe(0);
    expect(metrics.creditsUsed.state).toBe('EMPTY');
    expect(metrics.reservationsCount.total).toBe(0);
    expect(metrics.reservationsCount.state).toBe('EMPTY');

    // Ad spend when not connected must be null, not 0
    expect(metrics.adSpendKrw.value).toBeNull();
    expect(metrics.adSpendKrw.state).toBe('UNAVAILABLE');

    // Revenue must be null
    expect(metrics.revenueKrw.value).toBeNull();
    expect(metrics.revenueKrw.state).toBe('UNAVAILABLE');

    // Korean summary text must accurately reflect zero/empty
    expect(emptyData.summaryText).toBeDefined();
    expect(emptyData.summaryText).not.toContain('AWAITING_INITIAL_DATA');
  });

  it('fails closed and returns success: false on database query errors (never masks as 0)', async () => {
    mockDbState.client = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        then: (resolve: any) =>
          Promise.resolve(resolve({ data: null, error: { message: 'DB connection failure' } })),
      })),
    };

    const result = await resultsDispatcher.execute(
      {},
      {
        workspaceId: WORKSPACE_A,
        correlationId: 'corr_test_err',
      }
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error?.message).toContain('성과');
  });

  it('fails mutation: catches legacy hardcoded zero returns instead of verified null and real counts', async () => {
    // Ad account disconnected
    setAdAccountResolver(async () => ({ connected: false }));

    // Real data exists in DB
    mockDbState.client = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        then: (resolve: any) => {
          if (table === 'channel_drafts') {
            return Promise.resolve(resolve({ data: [{ id: 'cd_1', workspace_id: WORKSPACE_A }], error: null }));
          }
          if (table === 'credit_ledger_entries') {
            return Promise.resolve(resolve({ data: [{ id: 'cl_1', amount: 80, kind: 'consume' }], error: null }));
          }
          return Promise.resolve(resolve({ data: [], error: null }));
        },
      })),
    };

    const result = await resultsDispatcher.execute(
      {},
      { workspaceId: WORKSPACE_A, correlationId: 'corr_mutation_check' }
    );

    expect(result.success).toBe(true);
    const mutData = result.data as any;
    const metrics = mutData?.metrics;

    // Mutation checks:
    // 1. If someone reverts to hardcoded drafts=0 when DB has 1, fail!
    expect(metrics.draftsCreated.total).toBe(1);
    expect(metrics.draftsCreated.total).not.toBe(0);

    // 2. If someone reverts to hardcoded credits=0 when DB has 80, fail!
    expect(metrics.creditsUsed.total).toBe(80);
    expect(metrics.creditsUsed.total).not.toBe(0);

    // 3. If someone reverts to hardcoded revenue=0, fail! (Must be null)
    expect(metrics.revenueKrw.value).toBeNull();
    expect(metrics.revenueKrw.value).not.toBe(0);

    // 4. If someone reverts to hardcoded adSpend=0 when disconnected, fail! (Must be null)
    expect(metrics.adSpendKrw.value).toBeNull();
    expect(metrics.adSpendKrw.value).not.toBe(0);

    // 5. Internal status codes must NOT be returned in user data
    expect(result.data?.status).not.toBe('AWAITING_INITIAL_DATA');
  });
});
