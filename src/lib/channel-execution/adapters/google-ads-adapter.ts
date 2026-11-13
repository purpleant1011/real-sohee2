/**
 * Google Ads MCP Read & Safe Write Adapter (ANI-768)
 * 
 * Invariants:
 * 1. Read operations (insights, search, diagnose) pass through official MCP surface.
 * 2. Write operations (budget change, campaign status) require:
 *    - Allowed Customer ID check (account isolation)
 *    - Daily Spend Ceiling check
 *    - Mandatory Human Approval Envelope
 *    - Authoritative Readback before marking VERIFIED
 */

import {
  AuthoritativeReceipt,
  ChannelExecutionResult,
  SpendPolicyEnvelope
} from '../core/channel-execution-types';
import { ProviderCircuitBreakerRegistry } from '../core/provider-circuit-breaker';

export interface GoogleAdsCampaignInsight {
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  costMicros: number; // 1 KRW ~ 1,000,000 micros approx or standard Google currency
  ctr: number;
  cpcKRW: number;
}

export interface GoogleAdsProposal {
  proposalId: string;
  customerId: string;
  campaignId: string;
  actionType: 'UPDATE_BUDGET' | 'PAUSE_CAMPAIGN' | 'ENABLE_CAMPAIGN';
  currentBudgetKRW: number;
  proposedBudgetKRW: number;
  spendDeltaKRW: number;
  rationale: string;
}

export interface GoogleAdsClient {
  searchInsights(customerId: string): Promise<GoogleAdsCampaignInsight[]>;
  mutateCampaign(customerId: string, campaignId: string, mutation: { budgetKRW?: number; status?: 'ENABLED' | 'PAUSED' }): Promise<{ updatedCampaignId: string; newBudgetKRW: number; status: string }>;
  fetchCampaign(customerId: string, campaignId: string): Promise<{ campaignId: string; budgetKRW: number; status: string } | null>;
}

export class GoogleAdsAdapter {
  private readonly providerName = 'google_ads_mcp';

  constructor(
    private readonly circuitBreaker: ProviderCircuitBreakerRegistry,
    private readonly client: GoogleAdsClient,
    private readonly allowedCustomerIds: readonly string[]
  ) {}

  // --- Read Operations ---
  public async readInsights(customerId: string): Promise<ChannelExecutionResult<GoogleAdsCampaignInsight[]>> {
    const executedAt = new Date().toISOString();
    const preflight = this.circuitBreaker.checkExecutionAllowed('google_ads', this.providerName);
    if (!preflight.allowed) {
      return {
        success: false,
        channel: 'google_ads',
        action: 'ads.read_insights',
        circuitState: preflight.state,
        executedAt,
        error: {
          code: 'CIRCUIT_OPEN',
          message: preflight.reason ?? 'Google Ads circuit is OPEN',
          retryable: true,
        },
      };
    }

    if (!this.allowedCustomerIds.includes(customerId)) {
      return {
        success: false,
        channel: 'google_ads',
        action: 'ads.read_insights',
        circuitState: preflight.state,
        executedAt,
        error: {
          code: 'CUSTOMER_ID_NOT_ALLOWED',
          message: `Customer ID ${customerId} is not in allowed tenant scope`,
          retryable: false,
        },
      };
    }

    try {
      const insights = await this.client.searchInsights(customerId);
      this.circuitBreaker.recordSuccess('google_ads', this.providerName);
      return {
        success: true,
        channel: 'google_ads',
        action: 'ads.read_insights',
        data: insights,
        circuitState: 'CLOSED',
        executedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const newState = this.circuitBreaker.recordFailure('google_ads', this.providerName, message);
      return {
        success: false,
        channel: 'google_ads',
        action: 'ads.read_insights',
        circuitState: newState,
        executedAt,
        error: { code: 'GOOGLE_ADS_READ_FAILED', message, retryable: true },
      };
    }
  }

  // --- Proposal Preparation ---
  public prepareChange(
    customerId: string,
    campaignId: string,
    actionType: 'UPDATE_BUDGET' | 'PAUSE_CAMPAIGN' | 'ENABLE_CAMPAIGN',
    currentBudgetKRW: number,
    proposedBudgetKRW: number,
    rationale: string
  ): GoogleAdsProposal {
    return {
      proposalId: `gads-prop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      customerId,
      campaignId,
      actionType,
      currentBudgetKRW,
      proposedBudgetKRW,
      spendDeltaKRW: Math.max(0, proposedBudgetKRW - currentBudgetKRW),
      rationale,
    };
  }

  // --- Safe Write Execution ---
  public async applyChange(
    proposal: GoogleAdsProposal,
    spendEnvelope: SpendPolicyEnvelope
  ): Promise<ChannelExecutionResult> {
    const executedAt = new Date().toISOString();

    // 1. Account Isolation Guardrail
    if (!this.allowedCustomerIds.includes(proposal.customerId)) {
      return {
        success: false,
        channel: 'google_ads',
        action: 'ads.apply_change',
        circuitState: 'CLOSED',
        executedAt,
        error: {
          code: 'CUSTOMER_ID_NOT_ALLOWED',
          message: `Customer ID ${proposal.customerId} is not in allowed scope`,
          retryable: false,
        },
      };
    }

    // 2. Spend Guardrails & Human Approval Envelope
    if (proposal.actionType === 'UPDATE_BUDGET' || proposal.spendDeltaKRW > 0) {
      if (!spendEnvelope.isHumanApproved) {
        return {
          success: false,
          channel: 'google_ads',
          action: 'ads.apply_change',
          circuitState: 'CLOSED',
          executedAt,
          error: {
            code: 'HUMAN_APPROVAL_REQUIRED',
            message: 'Budget increase or spend mutations strictly require human approval',
            retryable: false,
            handoffRequired: true,
          },
        };
      }

      const totalProjectedSpend = spendEnvelope.currentDayAccumulatedSpendKRW + proposal.spendDeltaKRW;
      if (totalProjectedSpend > spendEnvelope.dailyBudgetCapKRW) {
        return {
          success: false,
          channel: 'google_ads',
          action: 'ads.apply_change',
          circuitState: 'CLOSED',
          executedAt,
          error: {
            code: 'DAILY_BUDGET_CAP_EXCEEDED',
            message: `Projected spend KRW ${totalProjectedSpend} exceeds daily cap KRW ${spendEnvelope.dailyBudgetCapKRW}`,
            retryable: false,
          },
        };
      }
    }

    // 3. Circuit Breaker Check
    const preflight = this.circuitBreaker.checkExecutionAllowed('google_ads', this.providerName);
    if (!preflight.allowed) {
      return {
        success: false,
        channel: 'google_ads',
        action: 'ads.apply_change',
        circuitState: preflight.state,
        executedAt,
        error: {
          code: 'CIRCUIT_OPEN',
          message: preflight.reason ?? 'Google Ads write blocked by circuit breaker',
          retryable: true,
        },
      };
    }

    // 4. Mutation Execution
    try {
      const mutationRes = await this.client.mutateCampaign(proposal.customerId, proposal.campaignId, {
        budgetKRW: proposal.proposedBudgetKRW,
        status: proposal.actionType === 'PAUSE_CAMPAIGN' ? 'PAUSED' : proposal.actionType === 'ENABLE_CAMPAIGN' ? 'ENABLED' : undefined,
      });

      // 5. Authoritative Readback (Crucial Invariant: Verify actual state in Ads engine)
      const readback = await this.client.fetchCampaign(proposal.customerId, proposal.campaignId);
      if (!readback) {
        this.circuitBreaker.recordFailure('google_ads', this.providerName, 'Readback campaign not found');
        return {
          success: false,
          channel: 'google_ads',
          action: 'ads.apply_change',
          circuitState: this.circuitBreaker.getMetrics('google_ads', this.providerName).state,
          executedAt,
          error: {
            code: 'READBACK_NOT_FOUND',
            message: `Campaign ${proposal.campaignId} readback failed after mutation`,
            retryable: true,
          },
        };
      }

      // Check if mutation matches readback
      if (proposal.actionType === 'UPDATE_BUDGET' && readback.budgetKRW !== proposal.proposedBudgetKRW) {
        return {
          success: false,
          channel: 'google_ads',
          action: 'ads.apply_change',
          circuitState: 'CLOSED',
          executedAt,
          error: {
            code: 'READBACK_STATE_MISMATCH',
            message: `Readback budget ${readback.budgetKRW} did not match proposed ${proposal.proposedBudgetKRW}`,
            retryable: false,
          },
        };
      }

      this.circuitBreaker.recordSuccess('google_ads', this.providerName);

      const receipt: AuthoritativeReceipt = {
        receiptId: `rcpt-gads-${proposal.campaignId}-${Date.now()}`,
        channel: 'google_ads',
        provider: this.providerName,
        externalObjectId: proposal.campaignId,
        verifiedAt: new Date().toISOString(),
        readbackStatus: 'VERIFIED',
        rawPayloadHash: `hash-gads-${proposal.actionType}-${proposal.proposedBudgetKRW}`,
      };

      return {
        success: true,
        channel: 'google_ads',
        action: 'ads.apply_change',
        data: mutationRes,
        receipt,
        circuitState: 'CLOSED',
        executedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const newState = this.circuitBreaker.recordFailure('google_ads', this.providerName, message);
      return {
        success: false,
        channel: 'google_ads',
        action: 'ads.apply_change',
        circuitState: newState,
        executedAt,
        error: { code: 'GOOGLE_ADS_MUTATION_FAILED', message, retryable: true },
      };
    }
  }
}
