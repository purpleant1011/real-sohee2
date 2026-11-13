import { describe, expect, it, vi } from 'vitest';
import { ProviderCircuitBreakerRegistry } from '../core/provider-circuit-breaker';
import { PostizPublishAdapter, PostizExternalClient } from '../adapters/postiz-publish-adapter';
import { GoogleAdsAdapter, GoogleAdsClient } from '../adapters/google-ads-adapter';
import { MetaAdsAdapter, MetaAdsClient } from '../adapters/meta-ads-adapter';
import { NaverBlogBrowserAdapter, BrowserAutomationDriver } from '../adapters/naver-blog-browser-adapter';
import { NaverSearchAdsAdapter, NaverSearchAdsClient } from '../adapters/naver-search-ads-adapter';
import { SpendPolicyEnvelope } from '../core/channel-execution-types';

describe('Wave 3 Channel Execution & Provider Adapters', () => {
  describe('ANI-778: ProviderCircuitBreakerRegistry', () => {
    it('trips circuit to OPEN after 3 consecutive failures and buffers into fallback queue', () => {
      const cb = new ProviderCircuitBreakerRegistry({ failureThreshold: 3, coolDownMs: 10_000 });
      
      expect(cb.checkExecutionAllowed('instagram', 'postiz').allowed).toBe(true);

      cb.recordFailure('instagram', 'postiz', '429 Rate Limit Exceeded');
      cb.recordFailure('instagram', 'postiz', '500 Internal Server Error');
      const state = cb.recordFailure('instagram', 'postiz', '503 Service Unavailable');

      expect(state).toBe('OPEN');

      const preflight = cb.checkExecutionAllowed('instagram', 'postiz');
      expect(preflight.allowed).toBe(false);
      expect(preflight.state).toBe('OPEN');

      cb.enqueueFallback({
        id: 'fb-1',
        workspaceId: 'ws-100',
        channel: 'instagram',
        provider: 'postiz',
        action: 'social.publish.submit',
        payload: { text: 'test' },
      });

      expect(cb.getFallbackQueue()).toHaveLength(1);
    });

    it('enforces Global and Channel Kill Switches immediately', () => {
      const cb = new ProviderCircuitBreakerRegistry();
      
      cb.triggerChannelKillSwitch('google_ads', 'Budget anomaly detected');
      expect(cb.checkExecutionAllowed('google_ads', 'google_ads_mcp').allowed).toBe(false);
      expect(cb.checkExecutionAllowed('meta_ads', 'meta_ads_mcp').allowed).toBe(true);

      cb.triggerGlobalKillSwitch('Global emergency platform freeze');
      expect(cb.checkExecutionAllowed('meta_ads', 'meta_ads_mcp').allowed).toBe(false);

      cb.releaseGlobalKillSwitch();
      expect(cb.checkExecutionAllowed('meta_ads', 'meta_ads_mcp').allowed).toBe(true);
    });
  });

  describe('ANI-767: PostizPublishAdapter', () => {
    it('publishes to supported social channel and verifies authoritative receipt', async () => {
      const cb = new ProviderCircuitBreakerRegistry();
      const mockClient: PostizExternalClient = {
        createPost: vi.fn().mockResolvedValue({ id: 'postiz-999', status: 'PUBLISHED' }),
        fetchPost: vi.fn().mockResolvedValue({
          id: 'postiz-999',
          status: 'PUBLISHED',
          permalink: 'https://instagram.com/p/postiz-999',
          content: 'Hello World',
        }),
      };

      const adapter = new PostizPublishAdapter(cb, mockClient);
      const res = await adapter.publish({
        workspaceId: 'ws-100',
        channel: 'instagram',
        content: 'Hello World',
        idempotencyKey: 'idem-1001',
      });

      expect(res.success).toBe(true);
      expect(res.receipt?.readbackStatus).toBe('VERIFIED');
      expect(res.receipt?.externalPermalink).toBe('https://instagram.com/p/postiz-999');

      // Duplicate idempotency check
      const dupRes = await adapter.publish({
        workspaceId: 'ws-100',
        channel: 'instagram',
        content: 'Hello World',
        idempotencyKey: 'idem-1001',
      });
      expect(dupRes.success).toBe(false);
      expect(dupRes.error?.code).toBe('DUPLICATE_IDEMPOTENCY_KEY');
    });

    it('fails closed when authoritative readback returns null', async () => {
      const cb = new ProviderCircuitBreakerRegistry();
      const mockClient: PostizExternalClient = {
        createPost: vi.fn().mockResolvedValue({ id: 'postiz-404', status: 'PUBLISHED' }),
        fetchPost: vi.fn().mockResolvedValue(null),
      };

      const adapter = new PostizPublishAdapter(cb, mockClient);
      const res = await adapter.publish({
        workspaceId: 'ws-100',
        channel: 'threads',
        content: 'Unverifiable Post',
        idempotencyKey: 'idem-1002',
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('READBACK_NOT_FOUND');
    });
  });

  describe('ANI-768: GoogleAdsAdapter', () => {
    it('rejects mutations without human approval or exceeding daily spend cap', async () => {
      const cb = new ProviderCircuitBreakerRegistry();
      const mockClient: GoogleAdsClient = {
        searchInsights: vi.fn().mockResolvedValue([]),
        mutateCampaign: vi.fn().mockResolvedValue({ updatedCampaignId: 'c-1', newBudgetKRW: 100_000, status: 'ENABLED' }),
        fetchCampaign: vi.fn().mockResolvedValue({ campaignId: 'c-1', budgetKRW: 100_000, status: 'ENABLED' }),
      };

      const adapter = new GoogleAdsAdapter(cb, mockClient, ['cust-valid']);
      const proposal = adapter.prepareChange('cust-valid', 'c-1', 'UPDATE_BUDGET', 50_000, 100_000, 'Scale conversions');

      const spendEnvelopeUnapproved: SpendPolicyEnvelope = {
        workspaceId: 'ws-1',
        channel: 'google_ads',
        dailyBudgetCapKRW: 200_000,
        requestedSpendKRW: 50_000,
        currentDayAccumulatedSpendKRW: 10_000,
        isHumanApproved: false,
      };

      const unapprovedRes = await adapter.applyChange(proposal, spendEnvelopeUnapproved);
      expect(unapprovedRes.success).toBe(false);
      expect(unapprovedRes.error?.code).toBe('HUMAN_APPROVAL_REQUIRED');

      const spendEnvelopeOverCap: SpendPolicyEnvelope = {
        ...spendEnvelopeUnapproved,
        isHumanApproved: true,
        dailyBudgetCapKRW: 55_000,
        currentDayAccumulatedSpendKRW: 10_000, // 10k + 50k = 60k > 55k
      };

      const overCapRes = await adapter.applyChange(proposal, spendEnvelopeOverCap);
      expect(overCapRes.success).toBe(false);
      expect(overCapRes.error?.code).toBe('DAILY_BUDGET_CAP_EXCEEDED');

      const spendEnvelopeApproved: SpendPolicyEnvelope = {
        ...spendEnvelopeUnapproved,
        isHumanApproved: true,
        dailyBudgetCapKRW: 200_000,
      };

      const approvedRes = await adapter.applyChange(proposal, spendEnvelopeApproved);
      expect(approvedRes.success).toBe(true);
      expect(approvedRes.receipt?.readbackStatus).toBe('VERIFIED');
    });
  });

  describe('ANI-769: MetaAdsAdapter', () => {
    it('validates account allowlist and verifies campaign draft with daily cap', async () => {
      const cb = new ProviderCircuitBreakerRegistry();
      const mockClient: MetaAdsClient = {
        createCampaignDraft: vi.fn().mockResolvedValue({ campaignId: 'meta-c-1', status: 'DRAFT' }),
        fetchCampaign: vi.fn().mockResolvedValue({
          campaignId: 'meta-c-1',
          dailyBudgetKRW: 50_000,
          status: 'DRAFT',
          objective: 'OUTCOME_LEADS',
        }),
      };

      const adapter = new MetaAdsAdapter(cb, mockClient, ['act_12345']);

      // 1. Disallowed ad account
      const disallowedRes = await adapter.createCampaign(
        {
          draftId: 'd-1',
          adAccountId: 'act_attacker',
          campaignName: 'Test Campaign',
          objective: 'OUTCOME_LEADS',
          dailyBudgetKRW: 50_000,
          creativeAssetIds: ['asset-1'],
        },
        {
          workspaceId: 'ws-1',
          channel: 'meta_ads',
          dailyBudgetCapKRW: 100_000,
          requestedSpendKRW: 50_000,
          currentDayAccumulatedSpendKRW: 0,
          isHumanApproved: true,
        }
      );
      expect(disallowedRes.success).toBe(false);
      expect(disallowedRes.error?.code).toBe('AD_ACCOUNT_NOT_ALLOWED');

      // 2. Allowed ad account & successful readback
      const validRes = await adapter.createCampaign(
        {
          draftId: 'd-2',
          adAccountId: 'act_12345',
          campaignName: 'Lead Gen Campaign',
          objective: 'OUTCOME_LEADS',
          dailyBudgetKRW: 50_000,
          creativeAssetIds: ['asset-1'],
        },
        {
          workspaceId: 'ws-1',
          channel: 'meta_ads',
          dailyBudgetCapKRW: 100_000,
          requestedSpendKRW: 50_000,
          currentDayAccumulatedSpendKRW: 0,
          isHumanApproved: true,
        }
      );
      expect(validRes.success).toBe(true);
      expect(validRes.receipt?.readbackStatus).toBe('VERIFIED');
    });
  });

  describe('ANI-770: NaverBlogBrowserAdapter', () => {
    it('fails immediately with POLICY_DISABLED without calling driver or circuit breaker', async () => {
      const cb = new ProviderCircuitBreakerRegistry();
      const spyCheck = vi.spyOn(cb, 'checkExecutionAllowed');
      const spyRecordFailure = vi.spyOn(cb, 'recordFailure');
      const spyRecordSuccess = vi.spyOn(cb, 'recordSuccess');

      const mockDriver: BrowserAutomationDriver = {
        openSmartEditor: vi.fn(),
        fillContent: vi.fn(),
        saveDraft: vi.fn(),
        clickPublish: vi.fn(),
        verifyPublishedPost: vi.fn(),
      };

      const adapter = new NaverBlogBrowserAdapter(cb, mockDriver);
      const res = await adapter.publishBlogPost({
        workspaceId: 'ws-1',
        blogId: 'my-business-blog',
        title: '신메뉴 출시 안내',
        contentHtml: '<p>안녕하세요</p>',
        sessionCookieToken: 'cookie-abc',
        confirmPublish: true,
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('POLICY_DISABLED');
      expect(res.error?.retryable).toBe(false);

      // Driver 호출 0회 검증
      expect(mockDriver.openSmartEditor).not.toHaveBeenCalled();
      expect(mockDriver.fillContent).not.toHaveBeenCalled();
      expect(mockDriver.saveDraft).not.toHaveBeenCalled();
      expect(mockDriver.clickPublish).not.toHaveBeenCalled();
      expect(mockDriver.verifyPublishedPost).not.toHaveBeenCalled();

      // Circuit Breaker 도 건드리지 말 것
      expect(spyCheck).not.toHaveBeenCalled();
      expect(spyRecordFailure).not.toHaveBeenCalled();
      expect(spyRecordSuccess).not.toHaveBeenCalled();
    });

    // V1.2 ADR-01/02: 네이버 블로그 브라우저 자동 포스팅은 CAPTCHA 판정 이전에 POLICY_DISABLED로 즉시 차단(드라이버 0회)
    it('halts and signals OWNER_HANDOFF_REQUIRED when CAPTCHA is detected', async () => {
      const cb = new ProviderCircuitBreakerRegistry();
      const mockDriver: BrowserAutomationDriver = {
        openSmartEditor: vi.fn().mockResolvedValue({ editorReady: false, captchaDetected: true }),
        fillContent: vi.fn(),
        saveDraft: vi.fn(),
        clickPublish: vi.fn(),
        verifyPublishedPost: vi.fn(),
      };

      const adapter = new NaverBlogBrowserAdapter(cb, mockDriver);
      const res = await adapter.publishBlogPost({
        workspaceId: 'ws-1',
        blogId: 'my-business-blog',
        title: '신메뉴 출시 안내',
        contentHtml: '<p>안녕하세요</p>',
        sessionCookieToken: 'cookie-abc',
        confirmPublish: true,
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('POLICY_DISABLED');
      expect(res.error?.retryable).toBe(false);
      expect(mockDriver.openSmartEditor).not.toHaveBeenCalled();
    });

    // V1.2 ADR-01/02: confirmPublish 여부 검사 이전에 정책에 의해 POLICY_DISABLED로 즉시 차단(드라이버 0회)
    it('requires confirmPublish flag before destructive live publishing', async () => {
      const cb = new ProviderCircuitBreakerRegistry();
      const mockDriver: BrowserAutomationDriver = {
        openSmartEditor: vi.fn(),
        fillContent: vi.fn(),
        saveDraft: vi.fn(),
        clickPublish: vi.fn(),
        verifyPublishedPost: vi.fn(),
      };

      const adapter = new NaverBlogBrowserAdapter(cb, mockDriver);
      const res = await adapter.publishBlogPost({
        workspaceId: 'ws-1',
        blogId: 'my-business-blog',
        title: '신메뉴 출시 안내',
        contentHtml: '<p>안녕하세요</p>',
        sessionCookieToken: 'cookie-abc',
        confirmPublish: false, // Not confirmed!
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('POLICY_DISABLED');
      expect(res.error?.retryable).toBe(false);
      expect(mockDriver.openSmartEditor).not.toHaveBeenCalled();
    });
  });

  describe('ANI-787: NaverSearchAdsAdapter', () => {
    it('enforces Max CPC Cap and human approval on keyword bidding', async () => {
      const cb = new ProviderCircuitBreakerRegistry();
      const mockClient: NaverSearchAdsClient = {
        updateKeywordBid: vi.fn().mockResolvedValue({ nccKeywordId: 'kw-1', bidAmt: 4_500, status: 'ELIGIBLE' }),
        fetchKeyword: vi.fn().mockResolvedValue({ nccKeywordId: 'kw-1', bidAmt: 4_500, status: 'ELIGIBLE' }),
      };

      const adapter = new NaverSearchAdsAdapter(cb, mockClient, { maxCpcBidKRW: 5_000 });

      // 1. Exceeds Max CPC (6,000 > 5,000)
      const overCpcRes = await adapter.updateKeywordBid(
        {
          workspaceId: 'ws-1',
          customerId: 'naver-cust-1',
          adgroupId: 'grp-1',
          keywordId: 'kw-1',
          bidAmtKRW: 6_000,
          useGroupBidAmt: false,
        },
        {
          workspaceId: 'ws-1',
          channel: 'naver_search_ads',
          dailyBudgetCapKRW: 100_000,
          requestedSpendKRW: 6_000,
          currentDayAccumulatedSpendKRW: 0,
          isHumanApproved: true,
        }
      );
      expect(overCpcRes.success).toBe(false);
      expect(overCpcRes.error?.code).toBe('CPC_BID_CAP_EXCEEDED');

      // 2. Normal bid within cap with human approval
      const validRes = await adapter.updateKeywordBid(
        {
          workspaceId: 'ws-1',
          customerId: 'naver-cust-1',
          adgroupId: 'grp-1',
          keywordId: 'kw-1',
          bidAmtKRW: 4_500,
          useGroupBidAmt: false,
        },
        {
          workspaceId: 'ws-1',
          channel: 'naver_search_ads',
          dailyBudgetCapKRW: 100_000,
          requestedSpendKRW: 4_500,
          currentDayAccumulatedSpendKRW: 0,
          isHumanApproved: true,
        }
      );
      expect(validRes.success).toBe(true);
      expect(validRes.receipt?.readbackStatus).toBe('VERIFIED');
    });
  });
});
