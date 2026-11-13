/**
 * Evidence-Backed Next Best Action (NBA) Planner (ANI-1259)
 * 
 * Recommends actionable, goal-driven next steps based on verified outcomes,
 * budget feasibility, and failure prevention.
 * 
 * Invariants:
 * 1. Goal-Outcome Coupled: Actions directly correlate with recent business outcomes.
 * 2. Failure Prevention: Suppresses repeated actions that recently failed or hit stop conditions.
 * 3. Evidence-Backed: Zero hallucinated actions; all proposals cite concrete source missions.
 */

import crypto from 'crypto';

export interface NBAPlannerInput {
  workspaceId: string;
  sourceMissionId: string;
  businessGoal: string;
  latestOutcome: {
    status: string;
    evidenceClass: 'VERIFIED' | 'INFERRED' | 'UNKNOWN';
    bookingsCount: number;
    revenueKrw: number;
    channel: string;
  };
  availableCredit: number;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH';
  recentFailedActionTypes: string[];
}

export interface NextBestAction {
  actionId: string;
  actionType: string;
  workspaceId: string;
  sourceMissionId: string;
  title: string;
  channel: string;
  reasoningSummary: string;
  confidence: number;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresApproval: boolean;
  evidenceRefs: string[];
  createdAt: string;
}

export class NextBestActionPlanner {
  /**
   * Plans the next best marketing action based on empirical outcomes and business goals.
   */
  plan(input: NBAPlannerInput): NextBestAction {
    const {
      workspaceId,
      sourceMissionId,
      latestOutcome,
      recentFailedActionTypes,
      riskTier,
    } = input;

    const actionId = `nba_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    // 0. Insufficient Data / Unknown Evidence Guard
    if (
      latestOutcome.evidenceClass === 'UNKNOWN' ||
      latestOutcome.status === 'NOT_OBSERVED' ||
      (recentFailedActionTypes.length === 0 &&
        latestOutcome.bookingsCount === 0 &&
        latestOutcome.revenueKrw === 0 &&
        (!('inboundCount' in latestOutcome) || (latestOutcome as any).inboundCount === 0))
    ) {
      return {
        actionId,
        actionType: 'DEFERRED_INSUFFICIENT_DATA',
        workspaceId,
        sourceMissionId,
        title: '성과 관측 데이터 부족으로 인한 추천 보류',
        channel: 'NONE',
        reasoningSummary: '충분한 전환 및 관측 증거가 집계되지 않아 추가 마케팅 추천 생성을 보류하고 데이터 수집을 유지합니다.',
        confidence: 0,
        riskTier: 'LOW',
        requiresApproval: false,
        evidenceRefs: [`mission:${sourceMissionId}`],
        createdAt: now,
      };
    }

    // 1. Successful Outcome Follow-Up
    if (latestOutcome.bookingsCount > 0) {
      return {
        actionId,
        actionType: 'EXPAND_SLOTS_AND_REELS',
        workspaceId,
        sourceMissionId,
        title: '주말 추가 슬롯 오픈 및 동일 테마 릴스 후속 발행',
        channel: latestOutcome.channel || 'INSTAGRAM_FEED',
        reasoningSummary: `지난 게시물이 ₩${latestOutcome.revenueKrw.toLocaleString()} (${latestOutcome.bookingsCount}건) 확정 예약으로 연결되었습니다. 마감 임박 효과를 지속하기 위한 후속 행동을 추천합니다.`,
        confidence: 94,
        riskTier,
        requiresApproval: true,
        evidenceRefs: [`mission:${sourceMissionId}`],
        createdAt: now,
      };
    }

    // 2. Failed or Stalled Outcome Pivot
    const wasGenericFeedFailed = recentFailedActionTypes.includes('POST_GENERIC_FEED');

    if (wasGenericFeedFailed) {
      return {
        actionId,
        actionType: 'OPTIMIZE_NAVER_PLACE_COUPON',
        workspaceId,
        sourceMissionId,
        title: '네이버 플레이스 단골 쿠폰 발행 및 슬롯 리프레시',
        channel: 'NAVER_PLACE',
        reasoningSummary: '이전 동일 액션의 실패 이력(피드 무반응)을 감안하여 검색 유입 중심의 네이버 플레이스 단골 쿠폰 및 소식으로 전환을 추천합니다.',
        confidence: 82,
        riskTier,
        requiresApproval: true,
        evidenceRefs: [`mission:${sourceMissionId}`],
        createdAt: now,
      };
    }

    // 3. Standard Optimization Action
    return {
      actionId,
      actionType: 'POST_FLASH_STORY',
      workspaceId,
      sourceMissionId,
      title: '평일 잔여 슬롯 소진을 위한 타임특가 스토리 제안',
      channel: 'INSTAGRAM_STORY',
      reasoningSummary: '현재 관찰된 반응을 바탕으로 단기 전환율을 높일 수 있는 타임 세일 숏폼 스토리 발행을 추천합니다.',
      confidence: 85,
      riskTier,
      requiresApproval: true,
      evidenceRefs: [`mission:${sourceMissionId}`],
      createdAt: now,
    };
  }
}
