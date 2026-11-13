/**
 * Sohee Ad Agency Service (ANI-895)
 * Organic -> Paid 광고 승격 및 소희 위임 / 직접 운영 UX
 */

export type AdOperationMode = 'SOHEE_AUTONOMOUS_DELEGATED' | 'OWNER_DIRECT_CONTROL';
export type AdCampaignStatus = 'DRAFT' | 'ACTIVE_RUNNING' | 'PAUSED' | 'COMPLETED';

export interface PromotedAdCampaign {
  campaignId: string;
  workspaceId: string;
  sourceContentAssetId: string;
  channel: 'META_ADS' | 'NAVER_SEARCH_ADS' | 'DAANGN_LOCAL_ADS';
  headline: string;
  dailyBudgetKrw: number;
  totalBudgetCapKrw: number;
  spentKrw: number;
  operationMode: AdOperationMode;
  status: AdCampaignStatus;
  targetAudience: {
    radiusKm: number;
    ageRange: [number, number];
    interests: string[];
  };
  metrics: {
    impressions: number;
    clicks: number;
    leadsAcquired: number;
    bookingsGenerated: number;
    attributedRevenueKrw: number;
    roasPercent: number;
  };
  createdAt: string;
  updatedAt: string;
}

export class SoheeAdAgencyService {
  private campaigns: Map<string, PromotedAdCampaign> = new Map();

  /**
   * 오가닉 콘텐츠를 유료 광고로 승격 생성 (ANI-895)
   */
  promoteContentToAd(params: {
    workspaceId: string;
    sourceContentAssetId: string;
    channel: PromotedAdCampaign['channel'];
    headline: string;
    dailyBudgetKrw: number;
    totalBudgetCapKrw: number;
    operationMode?: AdOperationMode;
    radiusKm?: number;
  }): PromotedAdCampaign {
    const {
      workspaceId,
      sourceContentAssetId,
      channel,
      headline,
      dailyBudgetKrw,
      totalBudgetCapKrw,
      operationMode = 'SOHEE_AUTONOMOUS_DELEGATED',
      radiusKm = 3,
    } = params;

    const campaignId = `ad_cmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const campaign: PromotedAdCampaign = {
      campaignId,
      workspaceId,
      sourceContentAssetId,
      channel,
      headline,
      dailyBudgetKrw,
      totalBudgetCapKrw,
      spentKrw: 0,
      operationMode,
      status: 'ACTIVE_RUNNING',
      targetAudience: {
        radiusKm,
        ageRange: [20, 49],
        interests: ['헤어스타일', '뷰티', '지역소식'],
      },
      metrics: {
        impressions: 0,
        clicks: 0,
        leadsAcquired: 0,
        bookingsGenerated: 0,
        attributedRevenueKrw: 0,
        roasPercent: 0,
      },
      createdAt: now,
      updatedAt: now,
    };

    this.campaigns.set(campaignId, campaign);
    return campaign;
  }

  /**
   * 광고 실적 기록 및 ROAS 계산
   */
  recordAdPerformance(
    campaignId: string,
    delta: {
      spentKrw: number;
      impressions: number;
      clicks: number;
      leadsAcquired: number;
      bookingsGenerated: number;
      attributedRevenueKrw: number;
    }
  ): PromotedAdCampaign {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    campaign.spentKrw += delta.spentKrw;
    campaign.metrics.impressions += delta.impressions;
    campaign.metrics.clicks += delta.clicks;
    campaign.metrics.leadsAcquired += delta.leadsAcquired;
    campaign.metrics.bookingsGenerated += delta.bookingsGenerated;
    campaign.metrics.attributedRevenueKrw += delta.attributedRevenueKrw;

    if (campaign.spentKrw > 0) {
      campaign.metrics.roasPercent = Math.round(
        (campaign.metrics.attributedRevenueKrw / campaign.spentKrw) * 100
      );
    }

    if (campaign.spentKrw >= campaign.totalBudgetCapKrw) {
      campaign.status = 'COMPLETED';
    }

    campaign.updatedAt = new Date().toISOString();
    return campaign;
  }

  switchOperationMode(campaignId: string, mode: AdOperationMode): PromotedAdCampaign {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }
    campaign.operationMode = mode;
    campaign.updatedAt = new Date().toISOString();
    return campaign;
  }

  updateDailyBudget(campaignId: string, dailyBudgetKrw: number): PromotedAdCampaign {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }
    campaign.dailyBudgetKrw = dailyBudgetKrw;
    campaign.updatedAt = new Date().toISOString();
    return campaign;
  }

  recordPerformance(
    campaignId: string,
    delta: {
      spentKrwDelta?: number;
      spentKrw?: number;
      impressionsDelta?: number;
      impressions?: number;
      clicksDelta?: number;
      clicks?: number;
      leadsDelta?: number;
      leadsAcquired?: number;
      bookingsDelta?: number;
      bookingsGenerated?: number;
      revenueKrwDelta?: number;
      attributedRevenueKrw?: number;
    }
  ): PromotedAdCampaign {
    return this.recordAdPerformance(campaignId, {
      spentKrw: delta.spentKrwDelta ?? delta.spentKrw ?? 0,
      impressions: delta.impressionsDelta ?? delta.impressions ?? 0,
      clicks: delta.clicksDelta ?? delta.clicks ?? 0,
      leadsAcquired: delta.leadsDelta ?? delta.leadsAcquired ?? 0,
      bookingsGenerated: delta.bookingsDelta ?? delta.bookingsGenerated ?? 0,
      attributedRevenueKrw: delta.revenueKrwDelta ?? delta.attributedRevenueKrw ?? 0,
    });
  }

  getCampaign(campaignId: string): PromotedAdCampaign | undefined {
    return this.campaigns.get(campaignId);
  }

  listCampaigns(workspaceId: string): PromotedAdCampaign[] {
    return Array.from(this.campaigns.values()).filter((c) => c.workspaceId === workspaceId);
  }
}
