import { AvailabilitySourceService } from '@/features/marketing-agent/engine/capacity-source';
import { OpportunityRadarService } from '@/features/marketing-agent/engine/opportunity-radar';
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state';

import type { RevenueCommandReadModel } from '@/lib/read-models/revenue-command-read-model';

// Sample values are never an observed production ledger.
export function getFixtureRevenueCommandReadModel(workspaceId: string): RevenueCommandReadModel {
  const control = AgentControlPlaneService.getControlState(workspaceId);
  const snapshot = AvailabilitySourceService.getSnapshot(workspaceId);
  const opportunities = OpportunityRadarService.scanOpportunities(workspaceId);

  const availableCount = snapshot.availableSlotsCount;
  const bookedCount = snapshot.bookedSlotsCount + 18;
  const totalCount = availableCount + bookedCount;
  const occupancyRate = Math.round((bookedCount / (totalCount || 1)) * 100);

  return {
    workspaceId,
    isDemo: true,
    observationStatus: 'FIXTURE',
    agentStatus: {
      desiredMode: control.desiredMode,
      actualMode: control.actualMode,
      statusReason: control.statusReason,
      killSwitchActive: control.killSwitchActive,
      lastHeartbeatAt: control.lastHeartbeatAt,
      workerVersion: control.workerVersion,
    },
    briefingText: `[FIXTURE · 실제 성과 아님] 좋은 아침이에요 사장님! 이번 주 판매 가능한 예약 ${totalCount}타임 중 ${bookedCount}타임이 확정되어 ${availableCount}타임이 남아 있어요. 그중 내일 오후 2타임은 36시간 안에 마감해야 해서 우선순위가 높습니다. 현재 예약 의도가 높은 미응답 고객 3명이 있고, 실제 가능한 시간을 확인하여 슬롯을 제안하겠습니다. 사장님 확인이 필요한 일은 환불 문의 1건입니다.`,
    pulse: {
      occupancyRate,
      occupancyNumerator: bookedCount,
      occupancyDenominator: totalCount,
      availableSlotsCount: availableCount,
      confirmedBookingsCount: bookedCount,
      bookedRevenueAmount: bookedCount * 240000,
      potentialRevenueMin: availableCount * 120000,
      potentialRevenueMax: availableCount * 240000,
      highIntentInquiriesCount: 3,
      updatedAt: snapshot.observedAt,
    },
    topOpportunities: opportunities,
    pipeline: [
      { stage: 'INQUIRY', label: '신규 문의', count: 4, valueAmount: 960000 },
      { stage: 'CONSULTATION', label: '상담 진행', count: 3, valueAmount: 720000 },
      { stage: 'SLOT_PROPOSAL', label: '슬롯 제안', count: 2, valueAmount: 480000 },
      { stage: 'BOOKING_CONFIRMED', label: '예약 확정(P0)', count: bookedCount, valueAmount: bookedCount * 240000 },
      { stage: 'VISIT_COMPLETED', label: '방문/결제', count: 12, valueAmount: 2880000 },
    ],
    decisions: [
      {
        id: 'dec-refund-01',
        workspaceId,
        subjectType: 'CUSTOMER_ESCALATION',
        subjectId: 'cust-parkseojun',
        question: '박서준 고객님 서비스 불만족 환불 요청 건 확인이 필요합니다',
        evidenceRefs: ['conversation:conv-003', 'payment:pay-8910'],
        recommendation: '환불 대신 사장님 직접 상담 후 "무료 추가 케어" 방문 안내 제안',
        impactIfApproved: '고객 신뢰 유지 및 재방문 기회 확보 (예상 만족도 회복)',
        impactIfRejected: '즉시 전액 환불 처리 (120,000원 결제 취소)',
        riskLevel: 'RED',
        status: 'PENDING',
      },
    ],
    next24HoursQueue: [
      {
        time: '오늘 12:00',
        channel: 'Threads',
        action: '가을 손상모 홈케어 트렌드 팁 발행',
        risk: 'LOW (자율)',
        stopCondition: 'kill_switch_active',
      },
      {
        time: '오늘 14:00',
        channel: 'Direct DM',
        action: '이도현 고객님 9/1(화) 14:00 잔여 슬롯 1:1 제안',
        risk: 'MEDIUM (자율)',
        stopCondition: 'target_slot_booked (슬롯 예약 시 즉시 중단)',
      },
      {
        time: '오늘 18:00',
        channel: 'Instagram',
        action: '화/목 마감 임박 발레아쥬 스타일링 릴스 발행',
        risk: 'LOW (자율)',
        stopCondition: 'target_slot_booked (빈 슬롯 0개 시 즉시 취소)',
      },
      {
        time: '내일 09:00',
        channel: 'Patrol',
        action: '밤사이 인스타 DM 및 네이버 예약 취소건 자동 스캔',
        risk: 'LOW (자율)',
        stopCondition: 'none',
      },
    ],
    verifiedOutcomes: [
      {
        time: '어제 18:00',
        channel: 'Instagram',
        title: '바이름 청라점 시그니처 발레아쥬 스타일링 릴스',
        externalId: 'meta_post_17841400000000000',
        permalink: 'https://www.instagram.com/sohee.ai/',
        result: 'Meta Graph API 정상 게시 확인 (조회 1,240회 · DM 문의 4건 유입)',
      },
      {
        time: '어제 14:34',
        channel: 'Naver Reservation',
        title: '최수아 고객님 발레아쥬 예약 9/1(화) 14:00 확정',
        externalId: 'naver_rsv_9841203',
        permalink: 'https://booking.naver.com/booking/13/bizes/sample',
        result: '예약 확정 (CONFIRMED) · 예상 매출: 240,000원 기여 (DIRECT)',
      },
    ],
  };
}
