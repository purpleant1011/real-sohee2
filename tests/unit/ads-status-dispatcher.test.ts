import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher';
import {
  setAdAccountResolver,
  resetAdAccountResolver,
  setMetaAdsProvider,
  resetMetaAdsProvider,
} from '@/features/tool-runtime/dispatchers/ads-dispatcher';
import { MetaAdsProvider } from '@/lib/providers/meta-ads-provider';

describe('ANI-920 / Task B: ads.status dispatcher routing', () => {
  const WORKSPACE_ID = 'ws-test-ads-status';

  beforeEach(() => {
    resetAdAccountResolver();
    resetMetaAdsProvider();
  });

  it('dispatches ads.status and returns live campaign status reporting without falling to NOT_IMPLEMENTED', async () => {
    // Mock connected ad account
    setAdAccountResolver(async (wsId: string) => ({
      connected: true,
      accountId: 'act_123456789',
      accountName: '바이름 뷰티 살롱',
      provider: 'META_ADS',
      status: 'ACTIVE',
      currency: 'KRW',
      campaignCount: 1,
      accessToken: 'test-token',
    }));

    // Mock provider getSpendReporting
    const mockProvider = {
      getSpendReporting: vi.fn(async () => ({
        campaignId: 'cmp_123456789_active',
        currency: 'KRW',
        cpc: 1285,
        cpm: 37500,
        spendKrw: 45000,
        impressions: 1200,
        clicks: 35,
        reach: 980,
        roas: 2.4,
        campaignName: '바이름 봄맞이 이벤트 캠페인',
        dateRange: { startDate: '2026-10-01', endDate: '2026-10-10' },
      })),
    };
    setMetaAdsProvider(mockProvider as any);

    const result = await ToolDispatcher.dispatch(
      'ads.status',
      { campaignId: 'cmp_123456789_active' },
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-ads-status',
      }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETED');
    expect(result.toolId).toBe('ads.status');
    const data = result.data as any;
    expect(data?.campaigns).toBeDefined();
    expect(data?.campaigns[0].name).toBe('바이름 봄맞이 이벤트 캠페인');
    expect(data?.campaigns[0].spendToday).toBe(45000);
  });
});
