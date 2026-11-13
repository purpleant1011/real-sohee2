import { describe, it, expect } from 'vitest';
import { CustomerIdentityResolutionGraph } from '@/features/crm/customer-identity-graph';
import { BookingLifecycleEngine } from '@/features/crm/booking-lifecycle';
import { CrmWriteProvenanceService } from '@/features/crm/crm-write-provenance';
import { HumanHandoffRuntime } from '@/features/crm/human-handoff-runtime';

describe('V0.9 Wave 4: CRM & Booking Core Tests', () => {
  // ANI-850: Customer Identity Resolution Graph
  it('ANI-850: CustomerIdentityResolutionGraph merges cross-channel identities into a canonical customer', () => {
    const graph = new CustomerIdentityResolutionGraph();
    const wsId = 'ws_crm_1';

    // 1. 인스타 DM으로 고객 최초 인입
    const cust1 = graph.resolveAndLink({
      workspaceId: wsId,
      identity: {
        type: 'INSTAGRAM_HANDLE',
        value: '@beauty_lover_99',
        sourceChannel: 'INSTAGRAM_DM',
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        confidenceScore: 0.9,
      },
      customerHints: { name: '이지은' },
    });

    expect(cust1.customerId).toBeDefined();
    expect(cust1.primaryName).toBe('이지은');
    expect(cust1.identities.length).toBe(1);

    // 2. 이후 카카오톡에서 전화번호 힌트와 함께 인입되어 그래프 병합
    const custMerged = graph.resolveAndLink({
      workspaceId: wsId,
      identity: {
        type: 'KAKAO_TALK_ID',
        value: 'kakao_user_xyz',
        sourceChannel: 'KAKAO_CHANNEL',
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        confidenceScore: 0.95,
      },
      customerHints: { name: '이지은', phone: '010-1234-5678' },
    });

    // 3. 네이버 예약에서 동일 전화번호로 인입 시 기존 고객과 정확히 일치 조회
    const custByPhone = graph.lookupByIdentity('PHONE_NUMBER', '010-1234-5678', wsId);
    expect(custByPhone?.customerId).toBe(custMerged.customerId);
  });

  // ANI-851: Booking Lifecycle Closed Loop
  it('ANI-851: BookingLifecycleEngine enforces LEAD->INTENT->HOLD->CONFIRMED->VISITED->REVENUE_ATTRIBUTED flow', () => {
    const engine = new BookingLifecycleEngine();
    const wsId = 'ws_booking_1';
    const customerId = 'cust_101';

    // 1. 예약 초기화 (HOLD 상태)
    const booking = engine.createBooking({
      workspaceId: wsId,
      customerId,
      serviceName: '시그니처 헤어 컷 & 클리닉',
      slotStartTime: '2026-09-12T14:00:00Z',
      slotEndTime: '2026-09-12T15:30:00Z',
      initialStatus: 'HOLD',
      holdTtlMinutes: 15,
      attributedSourceEventId: 'evt_insta_post_001',
    });

    expect(booking.status).toBe('HOLD');
    expect(booking.holdExpiresAt).toBeDefined();

    // 2. 예약 확정 (CONFIRMED)
    const confirmed = engine.transitionStatus(booking.bookingId, 'CONFIRMED', {
      reason: '고객 예약금 입금 완료',
    });
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.holdExpiresAt).toBeUndefined();

    // 3. 매장 방문 완료 (VISITED)
    const visited = engine.transitionStatus(booking.bookingId, 'VISITED', {
      reason: '매장 체크인 완료',
    });
    expect(visited.status).toBe('VISITED');

    // 4. 매출 확정 및 성과 귀속 (REVENUE_ATTRIBUTED)
    const revenueClosed = engine.transitionStatus(booking.bookingId, 'REVENUE_ATTRIBUTED', {
      revenueKrw: 88000,
      reason: '현장 카드 결제 ₩88,000 완료',
    });
    expect(revenueClosed.status).toBe('REVENUE_ATTRIBUTED');
    expect(revenueClosed.revenueKrw).toBe(88000);
    expect(revenueClosed.statusHistory.length).toBe(4);
  });

  // ANI-852: CRM Write Provenance & Consent
  it('ANI-852: CrmWriteProvenanceService issues SHA-256 audit digest and enforces retention policy', () => {
    const service = new CrmWriteProvenanceService();

    const prov = service.recordWrite({
      workspaceId: 'ws_prov_1',
      customerId: 'cust_prov_101',
      fieldName: 'contact_number',
      oldValue: null,
      newValue: '010-9999-8888',
      source: 'INSTAGRAM_DM_PARSER',
      consentStatus: 'CONSENT_GRANTED',
      consentAcquiredAt: new Date().toISOString(),
      retentionYears: 1,
    });

    expect(prov.auditDigest).toBeDefined();
    expect(prov.consentStatus).toBe('CONSENT_GRANTED');

    // 보존 만료 검사 (1년 후이므로 현재는 만료되지 않음)
    expect(service.isRetentionExpired(prov.recordId)).toBe(false);

    // 변경 이력 조회
    const history = service.getCustomerAuditHistory('cust_prov_101');
    expect(history.length).toBe(1);
    expect(history[0].recordId).toBe(prov.recordId);
  });

  // ANI-853: Human Handoff Runtime
  it('ANI-853: HumanHandoffRuntime detects sensitive keywords / low confidence and manages ticket lifecycle', () => {
    const runtime = new HumanHandoffRuntime();

    // 1. 민감 키워드(환불 요청) 트리거 검사
    const triggerRefund = runtime.evaluateHandoffTrigger({
      message: '시술 받은 머리가 너무 마음에 안 들어요. 전액 환불해주세요!',
      confidenceScore: 0.95,
    });
    expect(triggerRefund.shouldHandoff).toBe(true);
    expect(triggerRefund.reason).toBe('REFUND_REQUEST');

    // 2. 티켓 발행 및 봇 응답 차단
    const ticket = runtime.initiateHandoff({
      workspaceId: 'ws_handoff_1',
      customerId: 'cust_angry_1',
      channel: 'INSTAGRAM_DM',
      triggerReason: triggerRefund.reason!,
      confidenceScore: 0.95,
      lastCustomerMessage: '전액 환불해주세요!',
    });

    expect(ticket.handoffStatus).toBe('HANDED_OFF');
    expect(runtime.isCustomerInHumanMode('cust_angry_1')).toBe(true);

    // 3. 운영자 상담 완료 후 봇 모드 복귀
    const returned = runtime.returnToBot(ticket.ticketId, 'operator_park', '고객과 통화하여 무료 재시술로 협의 완료');
    expect(returned.handoffStatus).toBe('RETURNED_TO_BOT');
    expect(runtime.isCustomerInHumanMode('cust_angry_1')).toBe(false);
  });
});
