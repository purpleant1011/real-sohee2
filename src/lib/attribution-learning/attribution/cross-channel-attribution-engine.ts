/**
 * Cross-Channel Attribution Lineage Engine (ANI-772)
 * 
 * Supports full-funnel lineage from campaign to verified outcome,
 * as well as plugin-level capability attribution.
 * 
 * Invariants:
 * 1. Likes/comments do NOT equate to revenue (likes ≠ revenue).
 * 2. Multi-touch models: FIRST_TOUCH, LAST_NON_DIRECT, LINEAR, POSITION_BASED.
 * 3. 5-tier confidence hierarchy: OBSERVED -> ASSOCIATED -> QUALIFIED -> BOOKING_LINKED -> VERIFIED_CONVERSION.
 */

export type AttributionModelType = 'FIRST_TOUCH' | 'LAST_NON_DIRECT' | 'LINEAR' | 'POSITION_BASED';

export type AttributionConfidence =
  | 'OBSERVED'
  | 'ASSOCIATED'
  | 'QUALIFIED'
  | 'BOOKING_LINKED'
  | 'VERIFIED_CONVERSION';

export interface Touchpoint {
  touchpointId: string;
  channel: string;
  campaignId: string;
  actionId?: string;
  pluginId?: string;
  pluginVersion?: string;
  timestamp: string;
  isDirect: boolean;
}

export interface FunnelLineageNode {
  lineageId: string;
  campaignId: string;
  externalAssetId?: string;
  engagementEventId?: string;
  conversationId?: string;
  leadIdentityId?: string;
  bookingOpportunityId?: string;
  bookingId?: string;
  verifiedOutcomeRevenueKRW?: number;
  confidence: AttributionConfidence;
  pluginInstallationId?: string;
}

export interface AttributedShare {
  campaignId: string;
  channel: string;
  pluginId?: string;
  sharePercentage: number;
  attributedRevenueKRW: number;
}

export class CrossChannelAttributionEngine {
  private touchpointHistory: Touchpoint[] = [];
  private lineageNodes: FunnelLineageNode[] = [];

  public recordTouchpoint(touchpoint: Touchpoint): void {
    this.touchpointHistory.push(touchpoint);
  }

  public recordLineageNode(node: FunnelLineageNode): void {
    this.lineageNodes.push(node);
  }

  public getLineage(campaignId: string): readonly FunnelLineageNode[] {
    return this.lineageNodes.filter(n => n.campaignId === campaignId);
  }

  /**
   * Calculates multi-touch attribution shares for a verified conversion.
   */
  public calculateAttribution(
    conversionRevenueKRW: number,
    model: AttributionModelType,
    touchpoints: readonly Touchpoint[]
  ): AttributedShare[] {
    if (touchpoints.length === 0) {
      return [];
    }

    if (touchpoints.length === 1) {
      const tp = touchpoints[0];
      return [{
        campaignId: tp.campaignId,
        channel: tp.channel,
        pluginId: tp.pluginId,
        sharePercentage: 100,
        attributedRevenueKRW: conversionRevenueKRW,
      }];
    }

    switch (model) {
      case 'FIRST_TOUCH': {
        const first = touchpoints[0];
        return [{
          campaignId: first.campaignId,
          channel: first.channel,
          pluginId: first.pluginId,
          sharePercentage: 100,
          attributedRevenueKRW: conversionRevenueKRW,
        }];
      }

      case 'LAST_NON_DIRECT': {
        // Find last non-direct touchpoint, or fall back to last touchpoint
        const lastNonDirect = [...touchpoints].reverse().find(tp => !tp.isDirect) ?? touchpoints[touchpoints.length - 1];
        return [{
          campaignId: lastNonDirect.campaignId,
          channel: lastNonDirect.channel,
          pluginId: lastNonDirect.pluginId,
          sharePercentage: 100,
          attributedRevenueKRW: conversionRevenueKRW,
        }];
      }

      case 'LINEAR': {
        const equalShare = 100 / touchpoints.length;
        const perTouchRevenue = conversionRevenueKRW / touchpoints.length;
        return touchpoints.map(tp => ({
          campaignId: tp.campaignId,
          channel: tp.channel,
          pluginId: tp.pluginId,
          sharePercentage: Math.round(equalShare * 100) / 100,
          attributedRevenueKRW: Math.round(perTouchRevenue),
        }));
      }

      case 'POSITION_BASED': {
        // U-shaped: 40% First, 40% Last, 20% divided evenly among middle
        const count = touchpoints.length;
        const middleCount = count - 2;
        const first = touchpoints[0];
        const last = touchpoints[count - 1];

        const result: AttributedShare[] = [
          {
            campaignId: first.campaignId,
            channel: first.channel,
            pluginId: first.pluginId,
            sharePercentage: 40,
            attributedRevenueKRW: Math.round(conversionRevenueKRW * 0.4),
          },
        ];

        if (middleCount > 0) {
          const middleShare = 20 / middleCount;
          const middleRev = (conversionRevenueKRW * 0.2) / middleCount;
          for (let i = 1; i < count - 1; i++) {
            const mid = touchpoints[i];
            result.push({
              campaignId: mid.campaignId,
              channel: mid.channel,
              pluginId: mid.pluginId,
              sharePercentage: Math.round(middleShare * 100) / 100,
              attributedRevenueKRW: Math.round(middleRev),
            });
          }
        }

        result.push({
          campaignId: last.campaignId,
          channel: last.channel,
          pluginId: last.pluginId,
          sharePercentage: middleCount === 0 ? 60 : 40, // If only 2 touchpoints, 40% / 60% or 50% / 50%
          attributedRevenueKRW: Math.round(conversionRevenueKRW * (middleCount === 0 ? 0.6 : 0.4)),
        });

        return result;
      }
    }
  }
}
