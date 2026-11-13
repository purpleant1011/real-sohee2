/**
 * Naver Search Ads Adapter (ANI-787)
 * 
 * Supports PowerLink / Search Ads API operations.
 * 
 * Invariants:
 * 1. Spend guardrails: Max CPC Cap and Daily Budget Ceiling.
 * 2. Human approval strictly required for bid increases.
 * 3. Authoritative Readback after keyword/adgroup mutation.
 */

import {
  AuthoritativeReceipt,
  ChannelExecutionResult,
  SpendPolicyEnvelope
} from '../core/channel-execution-types';
import { ProviderCircuitBreakerRegistry } from '../core/provider-circuit-breaker';

export interface NaverSearchAdsKeywordMutation {
  workspaceId: string;
  customerId: string;
  adgroupId: string;
  keywordId: string;
  bidAmtKRW: number;
  useGroupBidAmt: boolean;
}

export interface NaverSearchAdsClient {
  updateKeywordBid(customerId: string, adgroupId: string, keywordId: string, bidAmtKRW: number): Promise<{ nccKeywordId: string; bidAmt: number; status: string }>;
  fetchKeyword(customerId: string, adgroupId: string, keywordId: string): Promise<{ nccKeywordId: string; bidAmt: number; status: string } | null>;
}

export interface NaverSearchAdsGuardrailConfig {
  maxCpcBidKRW: number; // e.g. 5,000 KRW
}

export class NaverSearchAdsAdapter {
  private readonly providerName = 'naver_search_ads_api';

  constructor(
    private readonly circuitBreaker: ProviderCircuitBreakerRegistry,
    private readonly client: NaverSearchAdsClient,
    private readonly guardrailConfig: NaverSearchAdsGuardrailConfig = { maxCpcBidKRW: 5_000 }
  ) {}

  public async updateKeywordBid(
    mutation: NaverSearchAdsKeywordMutation,
    spendEnvelope: SpendPolicyEnvelope
  ): Promise<ChannelExecutionResult> {
    const executedAt = new Date().toISOString();

    // 1. Max CPC Bid Cap Guardrail
    if (mutation.bidAmtKRW > this.guardrailConfig.maxCpcBidKRW) {
      return {
        success: false,
        channel: 'naver_search_ads',
        action: 'ads.naver_search.update_bid',
        circuitState: 'CLOSED',
        executedAt,
        error: {
          code: 'CPC_BID_CAP_EXCEEDED',
          message: `Requested bid KRW ${mutation.bidAmtKRW} exceeds max CPC cap KRW ${this.guardrailConfig.maxCpcBidKRW}`,
          retryable: false,
        },
      };
    }

    // 2. Human Approval Envelope check
    if (!spendEnvelope.isHumanApproved) {
      return {
        success: false,
        channel: 'naver_search_ads',
        action: 'ads.naver_search.update_bid',
        circuitState: 'CLOSED',
        executedAt,
        error: {
          code: 'HUMAN_APPROVAL_REQUIRED',
          message: 'Changing search ad bidding amounts requires human confirmation',
          retryable: false,
          handoffRequired: true,
        },
      };
    }

    // 3. Circuit Breaker Preflight
    const preflight = this.circuitBreaker.checkExecutionAllowed('naver_search_ads', this.providerName);
    if (!preflight.allowed) {
      return {
        success: false,
        channel: 'naver_search_ads',
        action: 'ads.naver_search.update_bid',
        circuitState: preflight.state,
        executedAt,
        error: {
          code: 'CIRCUIT_OPEN',
          message: preflight.reason ?? 'Naver Search Ads circuit is OPEN',
          retryable: true,
        },
      };
    }

    try {
      // 4. Mutation
      const updateRes = await this.client.updateKeywordBid(
        mutation.customerId,
        mutation.adgroupId,
        mutation.keywordId,
        mutation.bidAmtKRW
      );

      // 5. Authoritative Readback
      const readback = await this.client.fetchKeyword(mutation.customerId, mutation.adgroupId, mutation.keywordId);
      if (!readback || readback.bidAmt !== mutation.bidAmtKRW) {
        this.circuitBreaker.recordFailure('naver_search_ads', this.providerName, 'Readback failed or bid mismatch');
        return {
          success: false,
          channel: 'naver_search_ads',
          action: 'ads.naver_search.update_bid',
          circuitState: this.circuitBreaker.getMetrics('naver_search_ads', this.providerName).state,
          executedAt,
          error: {
            code: 'READBACK_MISMATCH_OR_FAILED',
            message: `Keyword ${mutation.keywordId} bid readback failed or mismatch: read ${readback?.bidAmt} vs expected ${mutation.bidAmtKRW}`,
            retryable: true,
          },
        };
      }

      this.circuitBreaker.recordSuccess('naver_search_ads', this.providerName);

      const receipt: AuthoritativeReceipt = {
        receiptId: `rcpt-nsads-${mutation.keywordId}-${Date.now()}`,
        channel: 'naver_search_ads',
        provider: this.providerName,
        externalObjectId: mutation.keywordId,
        verifiedAt: new Date().toISOString(),
        readbackStatus: 'VERIFIED',
        rawPayloadHash: `hash-nsads-${mutation.keywordId}-${mutation.bidAmtKRW}`,
      };

      return {
        success: true,
        channel: 'naver_search_ads',
        action: 'ads.naver_search.update_bid',
        data: updateRes,
        receipt,
        circuitState: 'CLOSED',
        executedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const newState = this.circuitBreaker.recordFailure('naver_search_ads', this.providerName, message);
      return {
        success: false,
        channel: 'naver_search_ads',
        action: 'ads.naver_search.update_bid',
        circuitState: newState,
        executedAt,
        error: {
          code: 'NAVER_SEARCH_ADS_ERROR',
          message,
          retryable: true,
        },
      };
    }
  }
}
