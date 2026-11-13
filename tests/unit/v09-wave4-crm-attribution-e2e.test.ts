import { describe, it, expect } from 'vitest';
import { CustomerIdentityResolutionGraph } from '@/features/crm/customer-identity-graph';
import { BookingLifecycleEngine } from '@/features/crm/booking-lifecycle';
import { CrmWriteProvenanceService } from '@/features/crm/crm-write-provenance';
import { HumanHandoffRuntime } from '@/features/crm/human-handoff-runtime';
import { ResultsAttributionDrilldownService } from '@/features/attribution/results-attribution-drilldown';
import { MeasurementHealthService } from '@/features/attribution/measurement-health';
import { AttributionConfidenceCalculator } from '@/features/attribution/attribution-confidence';
import { VerifiedOutcomeLearner } from '@/features/attribution/verified-outcome-learner';
import { Customer360Service } from '@/lib/admin-ops/customer-360-service';
import { SupportCaseLinkingService } from '@/lib/admin-ops/support-case-linking';

describe('V0.9 Wave 4: CRM, Booking, Attribution & Admin 360 Integrated E2E Lifecycle', () => {
  it('E2E Lifecycle: Identity Resolution -> CRM Consent -> Booking Loop -> Attribution Drilldown -> Health/Confidence -> Verified Learning -> Admin 360 -> CS Link -> Handoff', () => {
    const workspaceId = 'ws_wave4_e2e_001';

    // 1. 서비스 초기화
    const idGraph = new CustomerIdentityResolutionGraph();
    const bookingEngine = new BookingLifecycleEngine();
    const crmProvenance = new CrmWriteProvenanceService();
    const handoffRuntime = new HumanHandoffRuntime();
    const drilldownService = new ResultsAttributionDrilldownService();
    const healthService = new MeasurementHealthService();
    const confidenceCalc = new AttributionConfidenceCalculator();
    const outcomeLearner = new VerifiedOutcomeLearner();
    const c360Service = new Customer360Service();
    const supportService = new SupportCaseLinkingService();

    // 2. [ANI-874, ANI-875, ANI-876] Admin 360 ID 체인 및 활성화 상태 초기화
    c360Service.transitionActivationState(workspaceId, 'PAID_HEALTHY', '정식 구독 활성화');
    const idChainResult = c360Service.registerIdChain({
      userId: 'usr_e2e_boss',
      businessId: 'biz_e2e_gangnam',
      workspaceId,
      subscriptionId: 'sub_e2e_growth',
      installedPluginIds: ['plg_meta', 'plg_naver'],
      channelAccountIds: ['ch_ig_live', 'ch_nv_live'],
      recentActionRunIds: ['act_e2e_01'],
      recentOutcomeIds: ['out_e2e_01'],
    });
    expect(idChainResult.isValid).toBe(true);

    // 3. [ANI-850] 인스타그램 DM을 통한 고객 식별자 등록 & 그래프 매핑
    const customer = idGraph.resolveAndLink({
      workspaceId,
      identity: {
        type: 'INSTAGRAM_HANDLE',
        value: '@gangnam_style_star',
        sourceChannel: 'INSTAGRAM_DM',
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        confidenceScore: 0.92,
      },
      customerHints: { name: '박서연', phone: '010-5555-4444' },
    });
    expect(customer.primaryName).toBe('박서연');

    // 4. [ANI-852] CRM 고객 레코드 개인정보 동의 및 출처 불변 원장 기록
    const crmRecord = crmProvenance.recordWrite({
      workspaceId,
      customerId: customer.customerId,
      fieldName: 'preferred_service',
      oldValue: null,
      newValue: '프리미엄 볼륨 매직',
      source: 'INSTAGRAM_DM_PARSER',
      consentStatus: 'CONSENT_GRANTED',
      retentionYears: 1,
    });
    expect(crmRecord.auditDigest).toBeDefined();

    // 5. [ANI-851] 예약 폐쇄 루프: HOLD -> CONFIRMED -> VISITED -> REVENUE_ATTRIBUTED
    const booking = bookingEngine.createBooking({
      workspaceId,
      customerId: customer.customerId,
      serviceName: '프리미엄 볼륨 매직',
      slotStartTime: '2026-09-15T15:00:00Z',
      slotEndTime: '2026-09-15T17:30:00Z',
      initialStatus: 'HOLD',
      attributedSourceEventId: 'evt_post_autumn_magic',
    });
    bookingEngine.transitionStatus(booking.bookingId, 'CONFIRMED', { reason: '예약금 입금 완료' });
    bookingEngine.transitionStatus(booking.bookingId, 'VISITED', { reason: '시술 완료' });
    const finalizedBooking = bookingEngine.transitionStatus(booking.bookingId, 'REVENUE_ATTRIBUTED', {
      revenueKrw: 180000,
      reason: '현장 결제 ₩180,000 완료',
    });
    expect(finalizedBooking.revenueKrw).toBe(180000);

    // 6. [ANI-854] 매출 성과 ↔ 최초 소스 이벤트 엔드투엔드 계보 드릴다운 생성
    const drilldown = drilldownService.createDrilldownPath({
      workspaceId,
      sourceEvent: {
        sourceEventId: 'evt_post_autumn_magic',
        channel: 'INSTAGRAM_FEED',
        headline: '가을 신규 볼륨매직 화보',
        publishedAt: '2026-09-10T11:00:00Z',
      },
      lead: {
        customerId: customer.customerId,
        channel: 'INSTAGRAM_DM',
        acquiredAt: '2026-09-10T11:45:00Z',
      },
      booking: {
        bookingId: booking.bookingId,
        serviceName: '프리미엄 볼륨 매직',
        slotStartTime: booking.slotStartTime,
        status: 'VISITED',
      },
      revenue: {
        revenueKrw: 180000,
        settledAt: new Date().toISOString(),
      },
    });
    expect(drilldown.nextBestAction.actionType).toBe('SIMILAR_CONTENT_SCALE_UP');

    // 7. [ANI-855, ANI-856] 성과 파이프라인 헬스 진단 및 귀속 신뢰도 평가
    const health = healthService.evaluateHealth({
      workspaceId,
      sourceMetrics: [
        {
          sourceName: 'BOOKING_CONNECTOR',
          lastEventReceivedAt: new Date().toISOString(),
          coverageRatePercent: 96,
          untrackedEventsCount: 1,
        },
      ],
    });
    expect(health.overallStatus).toBe('HEALTHY');

    const confidence = confidenceCalc.calculateConfidence({
      workspaceId,
      totalEventsCount: 50,
      resolvedCustomerCount: 48,
      unresolvedEventCount: 2,
      directOrMissingSourceCount: 3,
      totalAttributedRevenueKrw: 180000,
      verifiedPaymentRevenueKrw: 180000,
    });
    expect(confidence.confidenceGrade).toBe('HIGH');

    // 8. [ANI-857] 오직 검증된 프로덕션 성과만을 학습하여 Next Best Action 도출
    outcomeLearner.ingestOutcomes(workspaceId, [
      {
        outcomeId: 'out_verified_01',
        workspaceId,
        isVerifiedProduction: true,
        isDemoOrFallback: false,
        channel: 'INSTAGRAM_FEED',
        publishDayOfWeek: 2,
        publishHourKst: 11,
        topic: '가을 볼륨매직',
        targetAudienceSegment: '직장인 여성',
        conversionsCount: 4,
        revenueKrw: 720000,
      },
    ]);
    const nba = outcomeLearner.generateNextBestAction(workspaceId);
    expect(nba.recommendedTopic).toBe('가을 볼륨매직');
    expect(nba.basedOnVerifiedOutcomesCount).toBe(1);

    // 9. [ANI-877] 고객 문의 발생 시 지원 케이스 ↔ 운영 액션 바인딩
    const supportTicket = supportService.createCaseWithLinks({
      workspaceId,
      userId: 'usr_e2e_boss',
      subject: '예약 알림톡 발송 지연 문의',
      description: '고객에게 알림톡이 5분 늦게 도착했습니다.',
      linkedEntities: {
        bookingId: booking.bookingId,
      },
    });
    supportService.resolveCase({
      caseId: supportTicket.caseId,
      operatorId: 'admin_cs_kim',
      actionTaken: 'EXPLAINED',
      notes: '카카오 비즈메시지 센터 일시적 지연으로 안내 완료',
    });
    expect(supportTicket.status).toBe('RESOLVED');

    // 10. [ANI-853] 민감 문의 발생 시 Human Handoff 및 상담 후 복귀
    const trigger = handoffRuntime.evaluateHandoffTrigger({
      message: '시술 후 알레르기가 생겼어요. 사장님 상담원 연결해주세요!',
      confidenceScore: 0.9,
    });
    expect(trigger.shouldHandoff).toBe(true);

    const handoffTicket = handoffRuntime.initiateHandoff({
      workspaceId,
      customerId: customer.customerId,
      channel: 'INSTAGRAM_DM',
      triggerReason: trigger.reason!,
      confidenceScore: 0.9,
      lastCustomerMessage: '사장님 상담원 연결해주세요!',
    });
    expect(handoffRuntime.isCustomerInHumanMode(customer.customerId)).toBe(true);

    handoffRuntime.returnToBot(handoffTicket.ticketId, 'owner_choi', '원장 직접 상담 및 패치테스트 예약 완료');
    expect(handoffRuntime.isCustomerInHumanMode(customer.customerId)).toBe(false);
  });
});
