/**
 * Autonomous Opportunity Detector & Replan Loop (ANI-906)
 * 
 * Core Invariants:
 * 1. Proactive Event-Driven Opportunities: Elevates business gaps/thresholds into durable autonomous triggers.
 * 2. Deduplication & Cooldown: Same trigger key within cooldown window must not create redundant runs.
 * 3. Priority Ranking: Scored on business impact (e.g., booking gap > regular scheduled post).
 * 4. Gated Execution: Only promotes candidates to execution if workspace is READY and Charter is ACTIVE.
 */

import type { A3AutonomyCharter } from './types';

export type OpportunityType =
  | 'SCHEDULE_DUE'
  | 'BOOKING_GAP'
  | 'GOAL_SHORTFALL'
  | 'CHANNEL_RECONNECTED'
  | 'UNANSWERED_INQUIRY';

export interface OpportunityCandidate {
  id: string;
  workspaceId: string;
  type: OpportunityType;
  dedupeKey: string;
  detectedAt: string;
  urgencyScore: number; // 0 - 100
  title: string;
  rationale: string;
  recommendedAction: string;
  targetChannel: string;
}

export interface WorkspaceBusinessSignal {
  hasOpenBookingSlotsNext48h: boolean;
  openSlotCount: number;
  scheduledPostDue: boolean;
  weeklyGoalCompletionRate: number; // e.g. 0.4 = 40%
  unansweredInquiriesCount: number;
  recentlyReconnectedChannel?: string;
}

export class OpportunityDetector {
  private recentDedupeKeys: Map<string, number> = new Map(); // key -> timestamp
  private cooldownMs: number;

  constructor(cooldownMs = 60 * 60 * 1000) {
    this.cooldownMs = cooldownMs;
  }

  /**
   * Scans workspace business signals and extracts deduplicated, ranked opportunity candidates.
   */
  detectOpportunities(
    workspaceId: string,
    signals: WorkspaceBusinessSignal,
    now = Date.now()
  ): OpportunityCandidate[] {
    const candidates: OpportunityCandidate[] = [];

    // 1. Booking Gap Signal (High Priority)
    if (signals.hasOpenBookingSlotsNext48h && signals.openSlotCount > 0) {
      const dedupeKey = `${workspaceId}:BOOKING_GAP:${Math.floor(now / (3 * 3600 * 1000))}`;
      if (!this.isCoolingDown(dedupeKey, now)) {
        candidates.push({
          id: `opp_gap_${now}`,
          workspaceId,
          type: 'BOOKING_GAP',
          dedupeKey,
          detectedAt: new Date(now).toISOString(),
          urgencyScore: 90,
          title: `향후 48시간 내 빈 예약 슬롯 ${signals.openSlotCount}개 발견`,
          rationale: '공실 위험 시간대를 인스타그램 피드 타임특가 이벤트로 채웁니다.',
          recommendedAction: 'POST_FLASH_FEED',
          targetChannel: 'instagram',
        });
      }
    }

    // 2. Unanswered Customer Inquiry (High Priority)
    if (signals.unansweredInquiriesCount > 0) {
      const dedupeKey = `${workspaceId}:INQUIRY:${Math.floor(now / (3600 * 1000))}`;
      if (!this.isCoolingDown(dedupeKey, now)) {
        candidates.push({
          id: `opp_inquiry_${now}`,
          workspaceId,
          type: 'UNANSWERED_INQUIRY',
          dedupeKey,
          detectedAt: new Date(now).toISOString(),
          urgencyScore: 85,
          title: `미답변 신규 문의 ${signals.unansweredInquiriesCount}건 대기 중`,
          rationale: '네이버 톡톡 및 인스타 DM 고객 문의 답변 초안 준비',
          recommendedAction: 'PREPARE_INQUIRY_REPLY',
          targetChannel: 'naver',
        });
      }
    }

    // 3. Goal Shortfall Signal (Medium Priority)
    if (signals.weeklyGoalCompletionRate < 0.5) {
      const dedupeKey = `${workspaceId}:GOAL_SHORTFALL:${Math.floor(now / (12 * 3600 * 1000))}`;
      if (!this.isCoolingDown(dedupeKey, now)) {
        candidates.push({
          id: `opp_goal_${now}`,
          workspaceId,
          type: 'GOAL_SHORTFALL',
          dedupeKey,
          detectedAt: new Date(now).toISOString(),
          urgencyScore: 70,
          title: '주간 목표 달성률 50% 미만 경고',
          rationale: '주간 예약 및 방문 목표 달성을 위해 당근 비즈프로필 소식 초안 준비 제안',
          recommendedAction: 'PREPARE_DAANGN_POST',
          targetChannel: 'daangn',
        });
      }
    }

    // 4. Scheduled Post Due (Normal Priority)
    if (signals.scheduledPostDue) {
      const dedupeKey = `${workspaceId}:SCHEDULE:${Math.floor(now / (3600 * 1000))}`;
      if (!this.isCoolingDown(dedupeKey, now)) {
        candidates.push({
          id: `opp_sched_${now}`,
          workspaceId,
          type: 'SCHEDULE_DUE',
          dedupeKey,
          detectedAt: new Date(now).toISOString(),
          urgencyScore: 50,
          title: '정기 소식 발행 시간 도래',
          rationale: '정기 네이버 플레이스 소식 및 인스타 피드 게시',
          recommendedAction: 'PUBLISH_CONTENT',
          targetChannel: 'naver',
        });
      }
    }

    // Rank candidates by urgencyScore descending
    return candidates.sort((a, b) => b.urgencyScore - a.urgencyScore);
  }

  /**
   * Evaluates if candidates are executable against active charter and readiness.
   */
  filterPromotableOpportunities(
    candidates: OpportunityCandidate[],
    charter: A3AutonomyCharter,
    isReadinessHealthy: boolean
  ): OpportunityCandidate[] {
    if (!isReadinessHealthy || charter.status !== 'ACTIVE') {
      return [];
    }

    return candidates.filter((candidate) => {
      // Channel must be allowed in charter envelope
      return charter.envelope.allowedChannels.includes(candidate.targetChannel);
    });
  }

  markExecuted(dedupeKey: string, now = Date.now()): void {
    this.recentDedupeKeys.set(dedupeKey, now);
  }

  private isCoolingDown(key: string, now: number): boolean {
    const lastSeen = this.recentDedupeKeys.get(key);
    if (!lastSeen) return false;
    return now - lastSeen < this.cooldownMs;
  }
}

export interface BusinessSignalSlot {
  slotId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface BusinessSignalInquiry {
  conversationId: string;
  channel: string;
  customerName: string;
  waitingMinutes: number;
  sourceMessageId: string;
}

export interface BusinessSignalEnvelope {
  workspaceId: string;
  observedAt: string;
  bookingSlots?: BusinessSignalSlot[];
  unansweredInquiries?: BusinessSignalInquiry[];
  daysSinceLastPost?: number;
  weeklyGoalProgress?: number;
}

export interface CanonicalOpportunityCandidate {
  id: string;
  workspaceId: string;
  type: 'BOOKING_GAP' | 'UNANSWERED_INQUIRY' | 'CONTENT_DROUGHT' | 'GOAL_SHORTFALL' | 'SCHEDULE_DUE';
  dedupeKey: string;
  detectedAt: string;
  urgencyScore: number;
  confidence: number;
  source: {
    type: string;
    id: string;
    count?: number;
  };
  title: string;
  rationale: string;
  recommendedAction: string;
  targetChannel: string;
}

export class CanonicalOpportunityDetector {
  private recentDedupeKeys: Map<string, number> = new Map();
  private cooldownMs: number;

  constructor(options?: { cooldownMs?: number }) {
    this.cooldownMs = options?.cooldownMs ?? 3600 * 1000;
  }

  detect(signals: BusinessSignalEnvelope, now = Date.now()): CanonicalOpportunityCandidate[] {
    const candidates: CanonicalOpportunityCandidate[] = [];
    const observedTimestamp = new Date(signals.observedAt).getTime();

    // 1. Stale signal filter: > 24 hours old signals must be purged
    if (now - observedTimestamp > 24 * 3600 * 1000) {
      return [];
    }

    const { workspaceId } = signals;

    // 2. Booking Gap (Urgent Priority: 90) - Requires explicit booking slot sources
    if (signals.bookingSlots && signals.bookingSlots.length > 0) {
      const firstSlot = signals.bookingSlots[0];
      const dedupeKey = `${workspaceId}:BOOKING_GAP:${firstSlot.date}:${Math.floor(now / (3 * 3600 * 1000))}`;
      if (!this.isCoolingDown(dedupeKey, now)) {
        candidates.push({
          id: `opp_gap_${now}_${firstSlot.slotId}`,
          workspaceId,
          type: 'BOOKING_GAP',
          dedupeKey,
          detectedAt: new Date(now).toISOString(),
          urgencyScore: 90,
          confidence: 1.0,
          source: {
            type: 'RESERVATION_SLOTS',
            id: firstSlot.slotId,
            count: signals.bookingSlots.length,
          },
          title: `향후 48시간 내 빈 예약 슬롯 ${signals.bookingSlots.length}개 발견`,
          rationale: '공실 시간대를 채우기 위한 인스타그램 타임특가 피드 게시 제안',
          recommendedAction: 'POST_FLASH_FEED',
          targetChannel: 'INSTAGRAM_FEED',
        });
      }
    }

    // 3. Unanswered Inquiries (High Priority: 85) - Requires concrete customer conversation source
    if (signals.unansweredInquiries && signals.unansweredInquiries.length > 0) {
      const firstInq = signals.unansweredInquiries[0];
      const dedupeKey = `${workspaceId}:INQUIRY:${firstInq.conversationId}:${Math.floor(now / (3600 * 1000))}`;
      if (!this.isCoolingDown(dedupeKey, now)) {
        candidates.push({
          id: `opp_inq_${now}_${firstInq.conversationId}`,
          workspaceId,
          type: 'UNANSWERED_INQUIRY',
          dedupeKey,
          detectedAt: new Date(now).toISOString(),
          urgencyScore: 85,
          confidence: 0.95,
          source: {
            type: 'CUSTOMER_CONVERSATION',
            id: firstInq.conversationId,
            count: signals.unansweredInquiries.length,
          },
          title: `미답변 고객 문의 ${signals.unansweredInquiries.length}건 대기 중`,
          rationale: `${firstInq.customerName} 고객 외 문의 대기 시간(${firstInq.waitingMinutes}분) 초과 대응`,
          recommendedAction: 'REPLY_INQUIRY',
          targetChannel: firstInq.channel,
        });
      }
    }

    // 4. Goal Shortfall (Medium Priority: 70) - Requires goal progress < 50%
    if (typeof signals.weeklyGoalProgress === 'number' && signals.weeklyGoalProgress < 0.5) {
      const dedupeKey = `${workspaceId}:GOAL_SHORTFALL:${Math.floor(now / (12 * 3600 * 1000))}`;
      if (!this.isCoolingDown(dedupeKey, now)) {
        candidates.push({
          id: `opp_goal_${now}`,
          workspaceId,
          type: 'GOAL_SHORTFALL',
          dedupeKey,
          detectedAt: new Date(now).toISOString(),
          urgencyScore: 70,
          confidence: 0.85,
          source: {
            type: 'GOAL_TRACKER',
            id: `goal_week_${Math.floor(now / (7 * 24 * 3600 * 1000))}`,
          },
          title: `주간 목표 달성률 미달 (${Math.round(signals.weeklyGoalProgress * 100)}%)`,
          rationale: '목표 달성을 위한 리텐션 쿠폰 발행 및 재방문 프로모션 제안',
          recommendedAction: 'PROPOSE_CAMPAIGN',
          targetChannel: 'NAVER_PLACE',
        });
      }
    }

    // 5. Content Drought (Medium Priority: 65) - Requires daysSinceLastPost >= 3
    if (typeof signals.daysSinceLastPost === 'number' && signals.daysSinceLastPost >= 3) {
      const dedupeKey = `${workspaceId}:CONTENT_DROUGHT:${Math.floor(now / (24 * 3600 * 1000))}`;
      if (!this.isCoolingDown(dedupeKey, now)) {
        candidates.push({
          id: `opp_drought_${now}`,
          workspaceId,
          type: 'CONTENT_DROUGHT',
          dedupeKey,
          detectedAt: new Date(now).toISOString(),
          urgencyScore: 65,
          confidence: 0.9,
          source: {
            type: 'CHANNEL_FEED_MONITOR',
            id: `channel_last_post_${signals.daysSinceLastPost}d`,
          },
          title: `최근 ${signals.daysSinceLastPost}일간 신규 콘텐츠 발행 공백`,
          rationale: '인스타그램 및 네이버 플레이스 피드 신선도 유지 필요',
          recommendedAction: 'PUBLISH_CONTENT',
          targetChannel: 'INSTAGRAM_FEED',
        });
      }
    }

    return candidates.sort((a, b) => b.urgencyScore - a.urgencyScore);
  }

  markExecuted(dedupeKey: string, now = Date.now()): void {
    this.recentDedupeKeys.set(dedupeKey, now);
  }

  private isCoolingDown(key: string, now: number): boolean {
    const lastSeen = this.recentDedupeKeys.get(key);
    if (!lastSeen) return false;
    return now - lastSeen < this.cooldownMs;
  }
}

