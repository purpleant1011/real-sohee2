import { describe, it, expect } from 'vitest';
import { CustomerReservationRevenueEngine } from '../engine/customer-reservation-revenue';

describe('Customer Agent, Reservation Domain (P0) & Revenue Loop (V0.8.7 Spec)', () => {
  const sampleWorkspaceId = 'fixture:TEST:marketing';

  it('다채널에서 인입된 고객 정보를 Canonical Customer로 통합 식별한다', () => {
    const engine = new CustomerReservationRevenueEngine();

    const cust1 = engine.findOrCreateCustomer({
      workspaceId: sampleWorkspaceId,
      channel: 'instagram',
      channelUserId: 'ig_user_8841',
      displayName: '김민지',
      handle: '@minji_style',
    });

    expect(cust1.displayName).toBe('김민지');
    expect(cust1.identities).toHaveLength(1);
    expect(cust1.identities[0].channel).toBe('instagram');

    // 동일 채널 사용자로 다시 조회 시 기존 고객 반환
    const cust1Refetch = engine.findOrCreateCustomer({
      workspaceId: sampleWorkspaceId,
      channel: 'instagram',
      channelUserId: 'ig_user_8841',
      displayName: '김민지 (업데이트)',
    });

    expect(cust1Refetch.id).toBe(cust1.id);
  });

  it('일반 안내 메시지(GREEN)와 예약 문의(YELLOW)를 적절히 자동 응대한다', () => {
    const engine = new CustomerReservationRevenueEngine();
    const customer = engine.findOrCreateCustomer({
      workspaceId: sampleWorkspaceId,
      channel: 'instagram',
      channelUserId: 'ig_user_102',
      displayName: '이지은',
    });

    // 1. 일반 영업시간 문의 (GREEN)
    const resGreen = engine.processInboundMessage({
      workspaceId: sampleWorkspaceId,
      customerId: customer.id,
      channel: 'instagram',
      externalThreadId: 'th-ig-102',
      text: '안녕하세요, 오늘 영업시간이 어떻게 되나요?',
    });

    expect(resGreen.riskTier).toBe('GREEN');
    expect(resGreen.autoReplyText).toContain('확인 후 안내');
    expect(resGreen.autoReplyText).not.toContain('바이름 청라점');
    expect(resGreen.conversation.messages).toHaveLength(2);

    // 2. 예약 문의 (YELLOW)
    const resYellow = engine.processInboundMessage({
      workspaceId: sampleWorkspaceId,
      customerId: customer.id,
      channel: 'instagram',
      externalThreadId: 'th-ig-102',
      text: '이번 주 토요일 오후 2시에 헤어 시술 예약 가능한가요?',
    });

    expect(resYellow.riskTier).toBe('YELLOW');
    expect(resYellow.detectedIntent).toBe('booking_inquiry');
    expect(resYellow.conversation.status).toBe('BOOKING_INTENT');
    expect(resYellow.autoReplyText).toContain('예약 가능 시간');
  });

  it('환불/불만 요청(RED) 발생 시 자동 답변을 즉시 차단하고 사장님 Decision Card로 에스컬레이션한다', () => {
    const engine = new CustomerReservationRevenueEngine();
    const customer = engine.findOrCreateCustomer({
      workspaceId: sampleWorkspaceId,
      channel: 'instagram',
      channelUserId: 'ig_user_999',
      displayName: '박서준',
    });

    const resRed = engine.processInboundMessage({
      workspaceId: sampleWorkspaceId,
      customerId: customer.id,
      channel: 'instagram',
      externalThreadId: 'th-ig-999',
      text: '어제 받은 시술이 너무 마음에 안 들어요. 전액 환불해주세요.',
    });

    expect(resRed.riskTier).toBe('RED');
    expect(resRed.detectedIntent).toBe('complaint_refund');
    expect(resRed.autoReplyText).toBeUndefined(); // 자동 답변 금지!
    expect(resRed.escalatedCard).toBeDefined();
    expect(resRed.escalatedCard?.title).toContain('환불');
    expect(resRed.conversation.status).toBe('TRIAGED');
    expect(resRed.conversation.escalationRequired).toBe(true);
  });

  it('문의 ➔ 슬롯 제안 ➔ 예약 확정(P0) ➔ Revenue Loop 매출 기여도 추적 전과정이 연결된다', () => {
    const engine = new CustomerReservationRevenueEngine();
    const customer = engine.findOrCreateCustomer({
      workspaceId: sampleWorkspaceId,
      channel: 'instagram',
      channelUserId: 'ig_user_555',
      displayName: '최수아',
    });

    // 1. 예약 슬롯 제안 (SLOT_PROPOSED)
    const reservation = engine.createReservationProposal({
      workspaceId: sampleWorkspaceId,
      customerId: customer.id,
      serviceId: 'srv-balayage-01',
      serviceName: '시그니처 발레아쥬 & 헤드스파',
      proposedSlots: ['2026-09-02T14:00:00+09:00', '2026-09-04T16:00:00+09:00'],
      sourceChannel: 'instagram',
      sourceConversationId: 'conv-ig-555',
      sourceContentId: 'post-ig-byreum-0831',
    });

    expect(reservation.status).toBe('SLOT_PROPOSED');
    expect(reservation.requestedSlots).toHaveLength(2);

    // 2. 예약 확정 (CONFIRMED) - 실제 결제 금액(120,000원) 반영
    const confirmedRes = engine.confirmReservation(reservation.id, '2026-09-02T14:00:00+09:00', 120000);
    expect(confirmedRes.status).toBe('CONFIRMED');
    expect(confirmedRes.selectedSlot).toBe('2026-09-02T14:00:00+09:00');

    // 3. Revenue Loop Trace 검증
    const traces = engine.getRevenueTraces(sampleWorkspaceId);
    expect(traces).toHaveLength(1);
    const trace = traces[0];
    expect(trace.reservationId).toBe(confirmedRes.id);
    expect(trace.contentId).toBe('post-ig-byreum-0831');
    expect(trace.realizedRevenue).toBe(120000);
    expect(trace.stepCompleted).toBe('reservation');
    expect(trace.attributionConfidence).toBeGreaterThanOrEqual(0.9);
  });
});
