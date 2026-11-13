import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMetaAdsProvider,
  DefaultMetaAdsProvider,
  MetaAdsProvider,
  MetaAdsProviderError,
  type MetaAdsFetch,
} from '@/lib/providers/meta-ads-provider';
import {
  adsDispatcher,
  setAdAccountResolver,
  resetAdAccountResolver,
  setMetaAdsProvider,
  resetMetaAdsProvider,
  setMaxCampaignBudgetGuardrail,
  resetMaxCampaignBudgetGuardrail,
  DEFAULT_MAX_CAMPAIGN_BUDGET_KRW,
} from '@/features/tool-runtime/dispatchers/ads-dispatcher';
import type { ToolExecutionContext } from '@/features/tool-runtime/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Task 3.3: Real Ads Account Probe & Campaign Runtime (ANI-978, ANI-979)', () => {
  const mockContext: ToolExecutionContext = {
    workspaceId: 'ws_salon_real_01',
    actorId: 'usr_owner_01',
    sessionId: 'ses_01',
    correlationId: 'corr_test_01',
    intentMode: 'EXECUTE',
    isTestAccount: false,
  };

  beforeEach(() => {
    resetAdAccountResolver();
    resetMetaAdsProvider();
    resetMaxCampaignBudgetGuardrail();
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. MetaAdsProvider Unit Tests
  // =========================================================================
  describe('1. MetaAdsProvider Direct Operations', () => {
    const testAccessToken = 'EAAG_test_marketing_token_secret';
    const testAccountId = 'act_102030405060';

    describe('1.1 probeAccount', () => {
      it('should successfully probe an ACTIVE ad account', async () => {
        const fetcher = vi.fn<MetaAdsFetch>().mockResolvedValueOnce(
          jsonResponse({
            id: 'act_102030405060',
            name: '소희 뷰티살롱 공식 광고계정',
            account_status: 1,
            currency: 'KRW',
            balance: 0,
          })
        );

        const provider = createMetaAdsProvider(fetcher);
        const result = await provider.probeAccount(testAccountId, testAccessToken);

        expect(result.ok).toBe(true);
        expect(result.isActive).toBe(true);
        expect(result.accountId).toBe('act_102030405060');
        expect(result.name).toBe('소희 뷰티살롱 공식 광고계정');
        expect(result.accountStatus).toBe(1);
        expect(result.statusText).toBe('ACTIVE');
        expect(result.currency).toBe('KRW');

        expect(fetcher).toHaveBeenCalledOnce();
        const callUrl = fetcher.mock.calls[0]?.[0] as string;
        expect(callUrl).toContain('/act_102030405060?fields=id,name,account_status,currency,balance');
        const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
        expect(headers.get('authorization')).toBe(`Bearer ${testAccessToken}`);
      });

      it('should return isActive=false and statusText=DISABLED when account status is 2', async () => {
        const fetcher = vi.fn<MetaAdsFetch>().mockResolvedValueOnce(
          jsonResponse({
            id: 'act_102030405060',
            name: '비활성화된 계정',
            account_status: 2,
            currency: 'KRW',
            balance: 15000,
          })
        );

        const provider = createMetaAdsProvider(fetcher);
        const result = await provider.probeAccount(testAccountId, testAccessToken);

        expect(result.ok).toBe(true);
        expect(result.isActive).toBe(false);
        expect(result.statusText).toBe('DISABLED');
        expect(result.accountStatus).toBe(2);
      });

      it('should handle API failure cleanly (HTTP 401 token expired)', async () => {
        const fetcher = vi.fn<MetaAdsFetch>().mockResolvedValueOnce(
          jsonResponse(
            {
              error: {
                message: 'Session has expired or token is invalid',
                type: 'OAuthException',
                code: 190,
                error_subcode: 463,
              },
            },
            401
          )
        );

        const provider = createMetaAdsProvider(fetcher);
        const result = await provider.probeAccount(testAccountId, 'expired_token');

        expect(result.ok).toBe(false);
        expect(result.isActive).toBe(false);
        expect(result.error).toContain('190');
      });
    });

    describe('1.2 createCampaign & independent getCampaignReadback', () => {
      it('should create campaign on Meta API and perform independent GET readback', async () => {
        const createdCampaignId = 'cmp_meta_7788990011';

        const fetcher = vi.fn<MetaAdsFetch>()
          // 1st call: POST /act_{id}/campaigns
          .mockResolvedValueOnce(
            jsonResponse({
              id: createdCampaignId,
            })
          )
          // 2nd call: GET /{campaign_id}?fields=id,name,status,daily_budget
          .mockResolvedValueOnce(
            jsonResponse({
              id: createdCampaignId,
              name: '가을 맞이 볼륨매직 프로모션',
              status: 'ACTIVE',
              daily_budget: '50000',
              objective: 'OUTCOME_TRAFFIC',
            })
          );

        const provider = createMetaAdsProvider(fetcher);

        // 1. Create
        const createResult = await provider.createCampaign({
          adAccountId: testAccountId,
          accessToken: testAccessToken,
          name: '가을 맞이 볼륨매직 프로모션',
          objective: 'OUTCOME_TRAFFIC',
          status: 'ACTIVE',
          dailyBudget: 50000,
        });

        expect(createResult.id).toBe(createdCampaignId);
        expect(createResult.name).toBe('가을 맞이 볼륨매직 프로모션');

        // Check POST request
        expect(fetcher.mock.calls[0]?.[0]).toContain(`/act_102030405060/campaigns`);
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
        const postBody = fetcher.mock.calls[0]?.[1]?.body as URLSearchParams;
        expect(postBody.get('name')).toBe('가을 맞이 볼륨매직 프로모션');
        expect(postBody.get('objective')).toBe('OUTCOME_TRAFFIC');
        expect(postBody.get('status')).toBe('ACTIVE');
        expect(postBody.get('daily_budget')).toBe('50000');

        // 2. Independent GET Readback
        const readback = await provider.getCampaignReadback(createdCampaignId, testAccessToken);

        expect(readback.id).toBe(createdCampaignId);
        expect(readback.name).toBe('가을 맞이 볼륨매직 프로모션');
        expect(readback.status).toBe('ACTIVE');
        expect(readback.dailyBudget).toBe(50000);

        // Check GET readback request
        expect(fetcher.mock.calls[1]?.[0]).toContain(`/${createdCampaignId}?fields=id,name,status,daily_budget`);
        expect(fetcher.mock.calls[1]?.[1]?.method ?? 'GET').toBe('GET');
      });

      it('should throw MetaAdsProviderError when campaign creation fails on Meta side', async () => {
        const fetcher = vi.fn<MetaAdsFetch>().mockResolvedValueOnce(
          jsonResponse(
            {
              error: {
                message: 'Invalid parameter: daily_budget below minimum allowed value',
                type: 'OAuthException',
                code: 100,
              },
            },
            400
          )
        );

        const provider = createMetaAdsProvider(fetcher);

        await expect(
          provider.createCampaign({
            adAccountId: testAccountId,
            accessToken: testAccessToken,
            name: '초저예산 테스트 캠페인',
            dailyBudget: 500,
          })
        ).rejects.toThrow(MetaAdsProviderError);
      });
    });

    describe('1.3 getSpendReporting with Zero Synthetic ROAS', () => {
      it('should report actual provider spend and strictly 0 ROAS when no conversion revenue exists', async () => {
        const campaignId = 'cmp_meta_7788990011';
        const fetcher = vi.fn<MetaAdsFetch>().mockResolvedValueOnce(
          jsonResponse({
            data: [
              {
                campaign_id: campaignId,
                campaign_name: '가을 맞이 볼륨매직 프로모션',
                spend: '38500',
                impressions: '2410',
                clicks: '86',
                cpc: '447.67',
                cpm: '15975.10',
                ctr: '3.5684',
                reach: '1980',
                date_start: '2026-09-01',
                date_stop: '2026-09-07',
              },
            ],
          })
        );

        const provider = createMetaAdsProvider(fetcher);
        const report = await provider.getSpendReporting(
          campaignId,
          { since: '2026-09-01', until: '2026-09-07' },
          testAccessToken
        );

        expect(report.campaignId).toBe(campaignId);
        expect(report.spendKrw).toBe(38500);
        expect(report.impressions).toBe(2410);
        expect(report.clicks).toBe(86);
        expect(report.reach).toBe(1980);
        expect(report.insightsAvailable).toBe(true);

        // Crucial: ROAS must be real or 0, NEVER the fake hardcoded 3.4
        expect(report.roas).toBe(0);
        expect(report.roas).not.toBe(3.4);
      });

      it('should return zero metrics cleanly when insights data is empty', async () => {
        const campaignId = 'cmp_brand_new_no_spend';
        const fetcher = vi.fn<MetaAdsFetch>().mockResolvedValueOnce(
          jsonResponse({
            data: [],
          })
        );

        const provider = createMetaAdsProvider(fetcher);
        const report = await provider.getSpendReporting(campaignId, undefined, testAccessToken);

        expect(report.campaignId).toBe(campaignId);
        expect(report.spendKrw).toBe(0);
        expect(report.impressions).toBe(0);
        expect(report.clicks).toBe(0);
        expect(report.roas).toBe(0);
        expect(report.insightsAvailable).toBe(false);
      });
    });
  });

  // =========================================================================
  // 2. Ads Dispatcher Integration Tests
  // =========================================================================
  describe('2. Ads Dispatcher Integration Runtime', () => {
    it('should fail-closed with CONNECT_REQUIRED when ad account is not connected', async () => {
      setAdAccountResolver(async () => ({
        connected: false,
        status: 'DISCONNECTED',
      }));

      const result = await adsDispatcher.execute(
        {
          _toolName: 'campaign.create',
          title: '가을 프로모션',
          goal: '신규 고객 예약 증가',
          budget: 50000,
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('UNAVAILABLE');
      expect(result.error?.code).toBe('CONNECT_REQUIRED');
      expect(result.error?.message).toContain('연결된 광고 계정이 없습니다');
    });

    it('should block execution when budget exceeds budget guardrail ceiling (BUDGET_GUARDRAIL_EXCEEDED)', async () => {
      setAdAccountResolver(async () => ({
        connected: true,
        accountId: 'act_102030405060',
        accountName: '소희 뷰티살롱 공식 광고계정',
        provider: 'META_ADS',
        status: 'ACTIVE',
        currency: 'KRW',
        campaignCount: 1,
      }));

      // Exceed default 1,000,000 KRW guardrail
      const excessiveBudget = DEFAULT_MAX_CAMPAIGN_BUDGET_KRW + 500000;

      const result = await adsDispatcher.execute(
        {
          _toolName: 'campaign.create',
          title: '초대형 예산 광고',
          goal: '전국 단위 예약 유치',
          budget: excessiveBudget,
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.error?.code).toBe('BUDGET_GUARDRAIL_EXCEEDED');
      expect(result.error?.message).toContain('허용 한도');
    });

    it('should reject non-positive or below-minimum budget with INVALID_ARGUMENT', async () => {
      setAdAccountResolver(async () => ({
        connected: true,
        accountId: 'act_102030405060',
        status: 'ACTIVE',
      }));

      const result = await adsDispatcher.execute(
        {
          _toolName: 'campaign.create',
          title: '0원 예산 광고',
          goal: '노출',
          budget: 0,
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.error?.code).toBe('INVALID_ARGUMENT');
    });

    it('should create approval proposal in DRAFT mode without calling provider execution', async () => {
      setAdAccountResolver(async () => ({
        connected: true,
        accountId: 'act_102030405060',
        accountName: '소희 뷰티살롱 공식 광고계정',
        provider: 'META_ADS',
        status: 'ACTIVE',
      }));

      const draftResult = await adsDispatcher.execute(
        {
          _toolName: 'campaign.create',
          title: '가을 주말 할인 이벤트',
          goal: '주말 예약 유치',
          budget: 60000,
        },
        {
          ...mockContext,
          intentMode: 'DRAFT',
        }
      );

      expect(draftResult.success).toBe(true);
      expect(draftResult.status).toBe('AWAITING_APPROVAL');
      expect(draftResult.proposal?.proposalType).toBe('CAMPAIGN_APPROVAL');
      expect((draftResult.proposal?.proposedValue as any).budget).toBe(60000);
      expect((draftResult.proposal?.proposedValue as any).adAccountId).toBe('act_102030405060');
    });

    it('should execute campaign creation with MetaAdsProvider and verify independent readback in EXECUTE mode', async () => {
      const mockMetaAdsProvider: MetaAdsProvider = {
        probeAccount: vi.fn(),
        createCampaign: vi.fn().mockResolvedValue({
          id: 'cmp_real_99881122',
          name: '가을 시즌 예약 유치 광고',
          status: 'ACTIVE',
        }),
        getCampaignReadback: vi.fn().mockResolvedValue({
          id: 'cmp_real_99881122',
          name: '가을 시즌 예약 유치 광고',
          status: 'ACTIVE',
          dailyBudget: 100000,
        }),
        getSpendReporting: vi.fn(),
      };

      setAdAccountResolver(async () => ({
        connected: true,
        accountId: 'act_102030405060',
        accountName: '소희 뷰티살롱 공식 광고계정',
        provider: 'META_ADS',
        status: 'ACTIVE',
        accessToken: 'real_meta_token',
      }));

      setMetaAdsProvider(mockMetaAdsProvider);

      const result = await adsDispatcher.execute(
        {
          _toolName: 'campaign.create',
          title: '가을 시즌 예약 유치 광고',
          goal: '신규 고객 예약 증가',
          budget: 100000,
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('COMPLETED');
      expect((result.data as any).campaignId).toBe('cmp_real_99881122');
      expect((result.data as any).readbackVerified).toBe(true);
      expect((result.data as any).budget).toBe(100000);

      // Verify provider calls
      expect(mockMetaAdsProvider.createCampaign).toHaveBeenCalledWith(
        expect.objectContaining({
          adAccountId: 'act_102030405060',
          name: '가을 시즌 예약 유치 광고',
          dailyBudget: 100000,
        })
      );
      expect(mockMetaAdsProvider.getCampaignReadback).toHaveBeenCalledWith('cmp_real_99881122', 'real_meta_token');

      // Evidence check
      expect(result.evidence).toBeDefined();
      expect(result.evidence?.channel).toBe('META_ADS');
      expect(result.evidence?.receiptId).toBe('cmp_real_99881122');
      expect(result.evidence?.url).toContain('cmp_real_99881122');
    });

    it('should report zero synthetic metrics (NO fake 3.4 ROAS, NO fake 12500 spend) on ads.list / campaign.status', async () => {
      const mockMetaAdsProvider: MetaAdsProvider = {
        probeAccount: vi.fn(),
        createCampaign: vi.fn(),
        getCampaignReadback: vi.fn(),
        getSpendReporting: vi.fn().mockResolvedValue({
          campaignId: 'cmp_real_99881122',
          spendKrw: 24500,
          currency: 'KRW',
          impressions: 1120,
          clicks: 45,
          cpc: 544.44,
          cpm: 21875.0,
          ctr: 4.0178,
          reach: 950,
          roas: 0, // Real ROAS without fake 3.4
          insightsAvailable: true,
        }),
      };

      setAdAccountResolver(async () => ({
        connected: true,
        accountId: 'act_102030405060',
        accountName: '소희 뷰티살롱 공식 광고계정',
        provider: 'META_ADS',
        status: 'ACTIVE',
        currency: 'KRW',
        campaignCount: 1,
      }));

      setMetaAdsProvider(mockMetaAdsProvider);

      const result = await adsDispatcher.execute(
        {
          _toolName: 'ads.list',
          campaignId: 'cmp_real_99881122',
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('COMPLETED');
      const data = result.data as any;

      // Ensure NO fake hardcoded 12500 spend or 3.4 ROAS
      expect(data.totalSpend).not.toBe(12500);
      expect(data.roas).not.toBe(3.4);

      // Verify real values from provider reporting
      expect(data.totalSpend).toBe(24500);
      expect(data.roas).toBe(0);
    });

    it('should support ads.probe tool to probe real ad account health', async () => {
      const mockMetaAdsProvider: MetaAdsProvider = {
        probeAccount: vi.fn().mockResolvedValue({
          ok: true,
          accountId: 'act_102030405060',
          name: '소희 뷰티살롱 공식 광고계정',
          accountStatus: 1,
          statusText: 'ACTIVE',
          currency: 'KRW',
          balance: 0,
          isActive: true,
        }),
        createCampaign: vi.fn(),
        getCampaignReadback: vi.fn(),
        getSpendReporting: vi.fn(),
      };

      setAdAccountResolver(async () => ({
        connected: true,
        accountId: 'act_102030405060',
        provider: 'META_ADS',
        status: 'ACTIVE',
        accessToken: 'meta_token_probe',
      }));

      setMetaAdsProvider(mockMetaAdsProvider);

      const result = await adsDispatcher.execute(
        {
          _toolName: 'ads.probe',
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('COMPLETED');
      expect(mockMetaAdsProvider.probeAccount).toHaveBeenCalledWith('act_102030405060', 'meta_token_probe');
      expect((result.data as any).accountStatus).toBe('ACTIVE');
      expect((result.data as any).isActive).toBe(true);
    });
  });
});
