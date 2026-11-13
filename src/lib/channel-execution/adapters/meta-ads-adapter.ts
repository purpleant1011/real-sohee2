/**
 * Meta Ads Hosted MCP POC Adapter (ANI-769)
 * 
 * Target Endpoint: https://mcp.facebook.com/ads (Hosted MCP Candidate)
 * 
 * Invariants:
 * 1. Account-level POC validation: Must verify account scope before execution.
 * 2. SPEND mutations (budget change, active campaign launch) strictly require:
 *    - Human Approval Envelope
 *    - Daily Cap Enforcement
 * 3. Authoritative Readback before marking VERIFIED.
 */

import {
  AuthoritativeReceipt,
  ChannelExecutionResult,
  SpendPolicyEnvelope
} from '../core/channel-execution-types';
import { ProviderCircuitBreakerRegistry } from '../core/provider-circuit-breaker';

export interface MetaAdsCampaignDraft {
  draftId: string;
  adAccountId: string;
  campaignName: string;
  objective: 'OUTCOME_LEADS' | 'OUTCOME_SALES' | 'OUTCOME_ENGAGEMENT';
  dailyBudgetKRW: number;
  creativeAssetIds: string[];
}

export interface MetaAdsClient {
  createCampaignDraft(draft: MetaAdsCampaignDraft): Promise<{ campaignId: string; status: 'DRAFT' | 'ACTIVE' }>;
  fetchCampaign(adAccountId: string, campaignId: string): Promise<{ campaignId: string; dailyBudgetKRW: number; status: string; objective: string } | null>;
}

export class MetaAdsAdapter {
  private readonly providerName = 'meta_ads_mcp';

  constructor(
    private readonly circuitBreaker: ProviderCircuitBreakerRegistry,
    private readonly client: MetaAdsClient,
    private readonly allowedAdAccountIds: readonly string[]
  ) {}

  public async createCampaign(
    draft: MetaAdsCampaignDraft,
    spendEnvelope: SpendPolicyEnvelope
  ): Promise<ChannelExecutionResult> {
    const executedAt = new Date().toISOString();

    // 1. Account Isolation Guardrail
    if (!this.allowedAdAccountIds.includes(draft.adAccountId)) {
      return {
        success: false,
        channel: 'meta_ads',
        action: 'ads.create_campaign',
        circuitState: 'CLOSED',
        executedAt,
        error: {
          code: 'AD_ACCOUNT_NOT_ALLOWED',
          message: `Ad Account ${draft.adAccountId} is not registered in this workspace`,
          retryable: false,
        },
      };
    }

    // 2. Spend Policy Check
    if (draft.dailyBudgetKRW > 0) {
      if (!spendEnvelope.isHumanApproved) {
        return {
          success: false,
          channel: 'meta_ads',
          action: 'ads.create_campaign',
          circuitState: 'CLOSED',
          executedAt,
          error: {
            code: 'HUMAN_APPROVAL_REQUIRED',
            message: 'Creating paid Meta campaign requires explicit human approval',
            retryable: false,
            handoffRequired: true,
          },
        };
      }

      if (draft.dailyBudgetKRW > spendEnvelope.dailyBudgetCapKRW) {
        return {
          success: false,
          channel: 'meta_ads',
          action: 'ads.create_campaign',
          circuitState: 'CLOSED',
          executedAt,
          error: {
            code: 'DAILY_BUDGET_CAP_EXCEEDED',
            message: `Requested daily budget KRW ${draft.dailyBudgetKRW} exceeds ceiling KRW ${spendEnvelope.dailyBudgetCapKRW}`,
            retryable: false,
          },
        };
      }
    }

    // 3. Circuit Breaker Preflight
    const preflight = this.circuitBreaker.checkExecutionAllowed('meta_ads', this.providerName);
    if (!preflight.allowed) {
      return {
        success: false,
        channel: 'meta_ads',
        action: 'ads.create_campaign',
        circuitState: preflight.state,
        executedAt,
        error: {
          code: 'CIRCUIT_OPEN',
          message: preflight.reason ?? 'Meta Ads circuit is OPEN',
          retryable: true,
        },
      };
    }

    try {
      // 4. External Execution
      const created = await this.client.createCampaignDraft(draft);

      // 5. Authoritative Readback
      const readback = await this.client.fetchCampaign(draft.adAccountId, created.campaignId);
      if (!readback) {
        this.circuitBreaker.recordFailure('meta_ads', this.providerName, 'Readback returned null');
        return {
          success: false,
          channel: 'meta_ads',
          action: 'ads.create_campaign',
          circuitState: this.circuitBreaker.getMetrics('meta_ads', this.providerName).state,
          executedAt,
          error: {
            code: 'READBACK_NOT_FOUND',
            message: `Meta Ads campaign ${created.campaignId} could not be read back`,
            retryable: true,
          },
        };
      }

      this.circuitBreaker.recordSuccess('meta_ads', this.providerName);

      const receipt: AuthoritativeReceipt = {
        receiptId: `rcpt-metaads-${created.campaignId}-${Date.now()}`,
        channel: 'meta_ads',
        provider: this.providerName,
        externalObjectId: created.campaignId,
        verifiedAt: new Date().toISOString(),
        readbackStatus: 'VERIFIED',
        rawPayloadHash: `hash-metaads-${draft.objective}-${draft.dailyBudgetKRW}`,
      };

      return {
        success: true,
        channel: 'meta_ads',
        action: 'ads.create_campaign',
        data: {
          campaignId: created.campaignId,
          status: readback.status,
          dailyBudgetKRW: readback.dailyBudgetKRW,
        },
        receipt,
        circuitState: 'CLOSED',
        executedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const newState = this.circuitBreaker.recordFailure('meta_ads', this.providerName, message);
      return {
        success: false,
        channel: 'meta_ads',
        action: 'ads.create_campaign',
        circuitState: newState,
        executedAt,
        error: {
          code: 'META_ADS_CREATION_FAILED',
          message,
          retryable: true,
        },
      };
    }
  }
}
