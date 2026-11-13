import { isMarketingFixtureWorkspace } from './fixture-context';
import { AvailabilitySourceService } from './capacity-source';
import { RevenueOpportunity, ActionCandidate, RevenueGoal } from './revenue-data-spine';
import { Opportunity, OpportunityEvidence } from '../types';

export interface OpportunityContextInput {
  workspaceId: string;
  emptySlotsCount: number;
  emptySlotTargetDay?: string;
  unbookedInquiriesCount: number;
  recontactEligibleCount: number;
  pendingReviewsCount: number;
  disconnectedChannelsCount: number;
  expiringChannelsCount: number;
}

export class OpportunityRadarService {
  static scanOpportunities(workspaceId: string, goal?: RevenueGoal): RevenueOpportunity[] {
    if (!isMarketingFixtureWorkspace(workspaceId)) return [];
    const snapshot = AvailabilitySourceService.getSnapshot(workspaceId);
    const availableSlots = snapshot.slots.filter(s => s.status === 'AVAILABLE');
    const opportunities: RevenueOpportunity[] = [];

    // 1. UNDERFILLED_SLOT Detection (48~72시간 내 빈 슬롯 탐지)
    if (availableSlots.length > 0) {
      const targetSlotIds = availableSlots.map(s => s.id);
      opportunities.push({
        id: `opp-underfilled-${Date.now()}`,
        workspaceId,
        type: 'UNDERFILLED_SLOT',
        title: `이번 주 화/목 잔여 ${availableSlots.length}타임 슬롯 집중 유치`,
        description: `화요일 14:00/17:00 및 목요일 16:00/19:00 예약 슬롯이 비어 있어 36시간 내 우선 마감이 필요합니다.`,
        status: 'OPEN',
        evidenceRefs: targetSlotIds.map(id => `capacity_slot:${id}`),
        valueBand: {
          min: availableSlots.length * 120000,
          max: availableSlots.length * 240000,
          currency: 'KRW',
        },
        confidenceBand: 'HIGH',
        confidenceRationale: `[FIXTURE] 샘플 슬롯 ${availableSlots.length}개 확인`,
        urgency: 'P0',
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        targetSlotIds,
        candidateCustomerIds: ['cust-leedohyun', 'cust-parkminji'],
        allowedActionTypes: ['direct_dm_slot_proposal', 'instagram_flash_reels', 'threads_urgent_notice'],
        constraints: ['할인 금지', '야간 21:00 이후 발송 금지'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // 2. UNANSWERED_BOOKING_INTENT Detection (예약 문의 미응답 SLA 초과 방지)
    opportunities.push({
      id: `opp-inbound-intent-${Date.now()}`,
      workspaceId,
      type: 'UNANSWERED_BOOKING_INTENT',
      title: '최수아 고객님 발레아쥬 예약 문의 즉시 슬롯 제안',
      description: '인스타그램 DM으로 "9/1 화요일 오후에 발레아쥬 예약 가능한가요?" 문의 인입됨 (5분 내 응대 권장)',
      status: 'OPEN',
      evidenceRefs: ['conversation:conv-002', 'capacity_slot:slot-20260901-1400'],
      valueBand: { min: 240000, max: 240000, currency: 'KRW' },
      confidenceBand: 'HIGH',
      confidenceRationale: '고객 인텐트 분석: 시그니처 발레아쥬 + 화요일 14:00 가용 슬롯 100% 매칭',
      urgency: 'P0',
      expiresAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      targetSlotIds: ['slot-20260901-1400'],
      candidateCustomerIds: ['cust-choisua'],
      allowedActionTypes: ['customer_message_reply', 'reservation_hold_and_propose'],
      constraints: ['안전 응대 정책 준수'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return opportunities;
  }

  static generateActionCandidates(opportunity: RevenueOpportunity): ActionCandidate[] {
    if (!isMarketingFixtureWorkspace(opportunity.workspaceId)) return [];
    if (opportunity.type === 'UNDERFILLED_SLOT') {
      return [
        {
          id: `act-dm-${opportunity.id}`,
          opportunityId: opportunity.id,
          actionType: 'direct_dm_slot_proposal',
          channel: 'direct_dm',
          targetIdentity: 'cust-leedohyun',
          rationale: '과거 화요일 오후 시간대를 선호했던 고의도 리드 고객에게 1:1 슬롯 제안',
          expectedOutcomeBand: '예약 전환율 40~60% 예상',
          riskLevel: 'MEDIUM',
          approvalPolicy: 'REVERSIBLE_GRACE',
          estimatedCreditCost: 5,
          contactCost: 0,
          stopConditions: ['target_slot_booked', 'customer_declined', 'quiet_hours_active'],
          status: 'PENDING',
        },
        {
          id: `act-ig-${opportunity.id}`,
          opportunityId: opportunity.id,
          actionType: 'instagram_flash_reels',
          channel: 'instagram',
          rationale: '화/목 마감 임박 잔여 슬롯 안내 숏폼 및 전후 스타일링 콘텐츠 발행',
          expectedOutcomeBand: '노출 800~1,500회 · DM 문의 3~5건 유입',
          riskLevel: 'LOW',
          approvalPolicy: 'AUTO',
          estimatedCreditCost: 15,
          contactCost: 0,
          stopConditions: ['target_slot_booked', 'kill_switch_active'],
          status: 'PENDING',
        },
      ];
    }

    if (opportunity.type === 'UNANSWERED_BOOKING_INTENT') {
      return [
        {
          id: `act-reply-${opportunity.id}`,
          opportunityId: opportunity.id,
          actionType: 'customer_message_reply',
          channel: 'instagram',
          targetIdentity: 'cust-choisua',
          rationale: '9/1(화) 14:00 슬롯 홀드 후 1:1 맞춤형 예약 확정 안내 메시지 전송',
          expectedOutcomeBand: '예약 확정(P0) 1건 전환 (매출 240,000원)',
          riskLevel: 'LOW',
          approvalPolicy: 'AUTO',
          estimatedCreditCost: 2,
          contactCost: 0,
          stopConditions: ['slot_unavailable', 'kill_switch_active'],
          status: 'PENDING',
        },
      ];
    }

    return [];
  }
}

/**
 * Backward-compatible helper returning typed Opportunity instances
 */
export function detectOpportunities(input: OpportunityContextInput | string = 'ws-default'): Opportunity[] {
  const wsId = typeof input === 'string' ? input : input.workspaceId;
  if (!isMarketingFixtureWorkspace(wsId)) return [];
  const emptyCount = typeof input === 'object' ? input.emptySlotsCount : 2;
  const targetDay = typeof input === 'object' && input.emptySlotTargetDay ? input.emptySlotTargetDay : '목요일';

  return [
    {
      id: `opp-empty-${Date.now()}`,
      workspaceId: wsId,
      title: `${targetDay} 빈 예약 ${emptyCount}자리 채우기 캠페인`,
      type: 'empty_slot',
      urgency: 'today',
      confidence: 'high',
      confidenceScore: 92,
      summary: `${targetDay} 비어 있는 ${emptyCount}자리 슬롯을 관심 고객 매칭 및 피크타임 콘텐츠로 채웁니다.`,
      detailedWhy: `과거 해당 요일 문의 고객 3명이 존재하며 즉시 제안 시 전환 확률이 높습니다.`,
      evidences: [
        { label: '빈 슬롯', value: `${emptyCount}개`, provenance: 'measured' },
        { label: '미예약 문의', value: '4건', provenance: 'measured' },
        { label: '재접촉 가능 고객', value: '3명', provenance: 'calculated' },
        { label: '예상 전환율', value: '45%', provenance: 'estimated' },
      ],
      expectedImpact: {
        label: '예상 매출',
        value: `${(emptyCount * 120000).toLocaleString()}원`,
        provenance: 'estimated',
      },
      expectedCost: {
        amount: 0,
        unit: '원',
        provenance: 'calculated',
      },
      recommendedActionTitle: '미예약 고객 맞춤 제안 및 인스타 릴스 발행',
      recommendedActionDescription: '과거 관심 고객에게 1:1 슬롯 제안 메시지를 발송하고 피크 타임 콘텐츠를 게시합니다.',
      requiresApproval: true,
      status: 'detected',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    },
    {
      id: `opp-inbound-${Date.now()}`,
      workspaceId: wsId,
      title: '인스타그램 DM 신규 예약 문의 5분 내 응대',
      type: 'unbooked_inquiry',
      urgency: 'today',
      confidence: 'high',
      confidenceScore: 95,
      summary: '신규 고객의 발레아쥬 예약 문의에 대해 가용 슬롯을 실시간으로 확인하고 안내합니다.',
      detailedWhy: '인바운드 문의 접수 후 5분 내 응답 시 예약 성사율이 극대화됩니다.',
      evidences: [
        { label: '문의 채널', value: 'Instagram DM', provenance: 'measured' },
        { label: '인텐트', value: '시그니처 발레아쥬', provenance: 'measured' },
      ],
      expectedImpact: {
        label: '예상 매출',
        value: '240,000원',
        provenance: 'estimated',
      },
      expectedCost: {
        amount: 0,
        unit: '원',
        provenance: 'calculated',
      },
      recommendedActionTitle: '실시간 가용 슬롯 안내 및 예약 확정',
      recommendedActionDescription: '고객 선호 시간대의 실측 슬롯을 제안합니다.',
      requiresApproval: false,
      status: 'detected',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    },
  ];
}
