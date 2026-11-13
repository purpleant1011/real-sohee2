/**
 * Sohee V0.8.9 Autonomous Campaign & Content Calendar Engine
 * 
 * Implements:
 * 1. Business Goal -> Campaign -> Channel Schedule mapping.
 * 2. Closed autonomous loop: Plan -> Execute -> Observe -> Optimize -> Report.
 */

import { ChannelId } from '../channels/channel-registry';

export type CampaignGoal =
  | 'ACQUIRE_NEW_CUSTOMERS'
  | 'BOOST_OFFPEAK_RESERVATIONS'
  | 'PROMOTE_SEASONAL_MENU'
  | 'RETAIN_LOCAL_LOYALTY';

export type CampaignStatus =
  | 'PLANNING'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED';

export interface ScheduledContentItem {
  id: string;
  campaignId: string;
  channelId: ChannelId;
  title: string;
  body: string;
  mediaUrls: string[];
  scheduledAt: string;
  status: 'DRAFT' | 'APPROVED' | 'QUEUED' | 'PUBLISHED' | 'VERIFIED' | 'FAILED';
  externalReceiptId?: string;
}

export interface MarketingCampaign {
  id: string;
  workspaceId: string;
  title: string;
  goal: CampaignGoal;
  targetChannels: ChannelId[];
  startDate: string;
  endDate: string;
  budgetCredits: number;
  status: CampaignStatus;
  scheduledContents: ScheduledContentItem[];
  outcomes: {
    impressions: number;
    clicks: number;
    inquiries: number;
    reservations: number;
  };
}

export function createAutonomousCampaign(
  workspaceId: string,
  title: string,
  goal: CampaignGoal,
  targetChannels: ChannelId[],
  durationDays: number = 7
): MarketingCampaign {
  const now = new Date();
  const endDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const campaignId = `cmp_${Date.now()}`;

  // 채널별 기본 캘린더 생성
  const scheduledContents: ScheduledContentItem[] = targetChannels.map((ch, idx) => ({
    id: `cnt_${Date.now()}_${idx}`,
    campaignId,
    channelId: ch,
    title: `${title} - ${ch} 맞춤 포스팅`,
    body: '소희가 매장 비법 지식을 기반으로 최적화된 마케팅 콘텐츠를 작성했습니다.',
    mediaUrls: [],
    scheduledAt: new Date(now.getTime() + (idx + 1) * 24 * 60 * 60 * 1000).toISOString(),
    status: 'DRAFT'
  }));

  return {
    id: campaignId,
    workspaceId,
    title,
    goal,
    targetChannels,
    startDate: now.toISOString(),
    endDate: endDate.toISOString(),
    budgetCredits: 5000,
    status: 'PLANNING',
    scheduledContents,
    outcomes: {
      impressions: 0,
      clicks: 0,
      inquiries: 0,
      reservations: 0
    }
  };
}
