/**
 * Tests for Sohee V0.9 Wave 3 Customer CRM Closed Loop
 * Traceability: ANI-928
 */

import { describe, it, expect } from 'vitest';
import { CustomerCrmService } from '@/lib/crm/customer-crm-service';
import { BookingRecord, CustomerConversation } from '@/types/customer-crm';

describe('V0.9 Wave 3 · Customer CRM Closed Loop (ANI-928)', () => {
  it('1. 고객 의도 분석 및 Human Handoff 민감 키워드를 감지해야 한다', () => {
    // 1-1. 정상 예약 문의
    const bookingInquiry = CustomerCrmService.analyzeCustomerIntent('자연 눈썹 시술 화요일 오후 3시 예약 가능한가요?');
    expect(bookingInquiry.intent).toBe('BOOKING_REQUEST');
    expect(bookingInquiry.requiresHumanHandoff).toBe(false);

    // 1-2. 가격 문의
    const priceInquiry = CustomerCrmService.analyzeCustomerIntent('자연결 눈썹 시술 비용이 얼마인가요?');
    expect(priceInquiry.intent).toBe('PRICE_INQUIRY');
    expect(priceInquiry.requiresHumanHandoff).toBe(false);

    // 1-3. 민감/환불/부작용 키워드 감지 시 원장님 직접 응대(Human Handoff)로 전환
    const complaint = CustomerCrmService.analyzeCustomerIntent('시술 부위에 염증이 생긴 것 같은데 즉시 환불해 주세요.');
    expect(complaint.requiresHumanHandoff).toBe(true);
    expect(complaint.intent).toBe('COMPLAINT_REFUND');
    expect(complaint.handoffReason).toContain('민감 키워드 감지');
  });

  it('2. 슬롯 가용성 사전 검증 없이 예약 확정 문구를 생성하지 못해야 한다', () => {
    const existingBookings: BookingRecord[] = [
      {
        bookingId: 'book-001',
        workspaceId: 'ws-gangnam',
        customerId: 'cust-001',
        conversationId: 'conv-001',
        status: 'CONFIRMED',
        serviceName: '눈썹',
        slotDateTime: '2026-09-08T15:00:00.000Z',
        totalPriceKrw: 100000,
        depositPaidKrw: 20000,
        depositStatus: 'PAID',
        availabilityVerifiedAt: '2026-09-07T10:00:00.000Z',
        createdAt: '2026-09-07T10:00:00.000Z',
      },
    ];

    // 중복 시간대 요청 (오후 3시 30분 -> 1시간 충돌)
    const conflictCheck = CustomerCrmService.verifySlotAvailability(
      existingBookings,
      '2026-09-08T15:30:00.000Z'
    );
    expect(conflictCheck.isAvailable).toBe(false);

    // 유휴 시간대 요청 (오후 5시 -> 가능)
    const freeCheck = CustomerCrmService.verifySlotAvailability(
      existingBookings,
      '2026-09-08T17:00:00.000Z'
    );
    expect(freeCheck.isAvailable).toBe(true);
    expect(freeCheck.verificationProofAt).toBeTruthy();

    // 사전 검증 증빙 없이 HOLD 생성 시 에러
    expect(() => {
      CustomerCrmService.holdBookingSlot({
        workspaceId: 'ws-gangnam',
        customerId: 'cust-002',
        conversationId: 'conv-002',
        slotDateTime: '2026-09-08T17:00:00.000Z',
        serviceName: '자연 눈썹',
        totalPriceKrw: 120000,
        availabilityVerificationAt: '', // 누락
      });
    }).toThrow(/Availability read is strictly required/);
  });

  it('3. 가예약(HOLD) ➔ 예약금 완납(CONFIRMED) ➔ 매장 방문 및 매출(REVENUE) 완결 루프를 보장해야 한다', () => {
    // 3-1. 슬롯 검증 후 가예약 생성
    const slotCheck = CustomerCrmService.verifySlotAvailability([], '2026-09-08T14:00:00.000Z');
    const hold = CustomerCrmService.holdBookingSlot({
      workspaceId: 'ws-gangnam',
      customerId: 'cust-003',
      conversationId: 'conv-003',
      slotDateTime: '2026-09-08T14:00:00.000Z',
      serviceName: '퍼스널 브로우',
      totalPriceKrw: 100000,
      availabilityVerificationAt: slotCheck.verificationProofAt,
    });

    expect(hold.status).toBe('SLOT_HELD');
    expect(hold.depositStatus).toBe('PENDING');

    // 3-2. 예약금 수납 후 확정
    const confirmed = CustomerCrmService.confirmBookingDeposit(hold, 20000);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.depositStatus).toBe('PAID');
    expect(confirmed.depositPaidKrw).toBe(20000);
    expect(confirmed.readbackVerifiedAt).toBeTruthy();

    // 3-3. 매장 방문 및 시술 완료, 최종 매출 결산
    const { updatedBooking, outcome } = CustomerCrmService.recordVisitAndRevenue(
      confirmed,
      100000,
      'CARD'
    );

    expect(updatedBooking.status).toBe('COMPLETED');
    expect(outcome.amountKrw).toBe(100000);
    expect(outcome.paymentMethod).toBe('CARD');
    expect(outcome.evidenceId).toBeTruthy();
  });

  it('4. Controlled Canary Customer의 7단계 완결 Trace를 온전히 생성해야 한다', () => {
    const canary = CustomerCrmService.generateCanaryTrace({
      workspaceId: 'ws-gangnam-canary',
      customerName: '김민지',
      channel: 'instagram',
      handle: '@minji_kim',
      slotIso: '2026-09-09T14:00:00.000Z',
      serviceName: '봄맞이 결 브로우',
      depositKrw: 20000,
      finalKrw: 120000,
    });

    expect(canary.steps).toHaveLength(7);
    expect(canary.steps[0].step).toBe('CONVERSATION');
    expect(canary.steps[1].step).toBe('INTENT');
    expect(canary.steps[2].step).toBe('SLOT_CHECK');
    expect(canary.steps[3].step).toBe('BOOKING_HOLD');
    expect(canary.steps[4].step).toBe('DEPOSIT_CONFIRM');
    expect(canary.steps[5].step).toBe('VISIT');
    expect(canary.steps[6].step).toBe('REVENUE');

    // 모든 단계가 verified: true여야 함
    expect(canary.steps.every(s => s.verified)).toBe(true);
    expect(canary.bookingId).toBeTruthy();
    expect(canary.outcomeId).toBeTruthy();
  });

  it('5. Dock 지시: 미예약 문의 고객에게 유휴 슬롯을 자동 제안해야 한다', () => {
    const conversations: CustomerConversation[] = [
      {
        conversationId: 'conv-inq-1',
        customerId: 'cust-unbooked-1',
        workspaceId: 'ws-gangnam',
        channel: 'instagram',
        lastMessageAt: '2026-09-06T10:00:00.000Z',
        intent: 'PRICE_INQUIRY',
        intentConfidence: 0.95,
        messages: [],
        status: 'ACTIVE',
      },
      {
        conversationId: 'conv-inq-2',
        customerId: 'cust-booked-2',
        workspaceId: 'ws-gangnam',
        channel: 'naver',
        lastMessageAt: '2026-09-06T11:00:00.000Z',
        intent: 'BOOKING_REQUEST',
        intentConfidence: 0.98,
        messages: [],
        status: 'ACTIVE',
      },
    ];

    const confirmedBookings: BookingRecord[] = [
      {
        bookingId: 'bk-already',
        workspaceId: 'ws-gangnam',
        customerId: 'cust-booked-2', // 이미 예약된 고객
        conversationId: 'conv-inq-2',
        status: 'CONFIRMED',
        serviceName: '눈썹',
        slotDateTime: '2026-09-10T14:00:00.000Z',
        totalPriceKrw: 100000,
        depositPaidKrw: 20000,
        depositStatus: 'PAID',
        availabilityVerifiedAt: '2026-09-06T12:00:00.000Z',
        createdAt: '2026-09-06T12:00:00.000Z',
      },
    ];

    const proposals = CustomerCrmService.proposeSlotsToUnbookedInquirers(
      conversations,
      confirmedBookings,
      ['2026-09-09T16:00:00.000Z']
    );

    // 미예약 고객 1명에게만 제안이 가야 함
    expect(proposals).toHaveLength(1);
    expect(proposals[0].customerId).toBe('cust-unbooked-1');
    expect(proposals[0].proposalMessage).toContain('잔여 슬롯 예약이 가능합니다');
  });
});
