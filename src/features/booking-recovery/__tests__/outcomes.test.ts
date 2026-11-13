import { describe, it, expect } from 'vitest';
import { calculateRecoveryOutcome, RecoveryEventRecord } from '../outcomes';

describe('Booking Recovery Outcome & Aggregation (Task 11)', () => {
  it('예약 확정액을 실제 매출로 바꾸지 않는다 (매출은 항상 NOT_OBSERVED 및 null)', () => {
    const events: RecoveryEventRecord[] = [
      {
        id: 'ev-1',
        workspaceId: 'a1111111-1111-4111-8111-111111111111',
        caseId: '11111111-1111-4111-8111-111111111111',
        eventType: 'BOOKING_CONFIRMED',
        reservationId: 'bk_1001',
        amountKrw: 120000,
        occurredAt: '2026-10-16T10:00:00Z',
        isActual: true,
      },
    ];

    const outcome = calculateRecoveryOutcome(events, {
      timezone: 'Asia/Seoul',
    });

    expect(outcome.confirmedBookings).toBe(1);
    expect(outcome.activeConfirmedBookings).toBe(1);
    expect(outcome.revenue).toEqual({
      status: 'NOT_OBSERVED',
      amountKrw: null,
    });
  });

  it('예약 취소 발생 시 active confirmed 수는 0이 되고, 누적 확정 수는 보존된다', () => {
    const events: RecoveryEventRecord[] = [
      {
        id: 'ev-1',
        workspaceId: 'a1111111-1111-4111-8111-111111111111',
        caseId: '11111111-1111-4111-8111-111111111111',
        eventType: 'BOOKING_CONFIRMED',
        reservationId: 'bk_1001',
        amountKrw: 120000,
        occurredAt: '2026-10-16T10:00:00Z',
        isActual: true,
      },
      {
        id: 'ev-2',
        workspaceId: 'a1111111-1111-4111-8111-111111111111',
        caseId: '11111111-1111-4111-8111-111111111111',
        eventType: 'BOOKING_CANCELLED',
        reservationId: 'bk_1001',
        amountKrw: 120000,
        occurredAt: '2026-10-16T11:00:00Z',
        isActual: true,
      },
    ];

    const outcome = calculateRecoveryOutcome(events, {
      timezone: 'Asia/Seoul',
    });

    expect(outcome.confirmedBookings).toBe(1); // 누적
    expect(outcome.activeConfirmedBookings).toBe(0); // 현재 유효
    expect(outcome.cancelledBookings).toBe(1);
    expect(outcome.revenue).toEqual({
      status: 'NOT_OBSERVED',
      amountKrw: null,
    });
  });

  it('동일 예약에 대한 중복 이벤트가 있어도 distinct booking으로 집계한다', () => {
    const events: RecoveryEventRecord[] = [
      {
        id: 'ev-1',
        workspaceId: 'a1111111-1111-4111-8111-111111111111',
        caseId: '11111111-1111-4111-8111-111111111111',
        eventType: 'BOOKING_CONFIRMED',
        reservationId: 'bk_1001',
        amountKrw: 120000,
        occurredAt: '2026-10-16T10:00:00Z',
        isActual: true,
      },
      {
        id: 'ev-1-dup',
        workspaceId: 'a1111111-1111-4111-8111-111111111111',
        caseId: '11111111-1111-4111-8111-111111111111',
        eventType: 'BOOKING_CONFIRMED',
        reservationId: 'bk_1001',
        amountKrw: 120000,
        occurredAt: '2026-10-16T10:00:05Z',
        isActual: true,
      },
    ];

    const outcome = calculateRecoveryOutcome(events, {
      timezone: 'Asia/Seoul',
    });

    expect(outcome.confirmedBookings).toBe(1);
    expect(outcome.activeConfirmedBookings).toBe(1);
  });

  it('TEST 또는 SHOWCASE_DEMO 데이터는 ACTUAL 성과 집계에서 배제된다', () => {
    const events: RecoveryEventRecord[] = [
      {
        id: 'ev-actual',
        workspaceId: 'a1111111-1111-4111-8111-111111111111',
        caseId: '11111111-1111-4111-8111-111111111111',
        eventType: 'BOOKING_CONFIRMED',
        reservationId: 'bk_actual',
        amountKrw: 50000,
        occurredAt: '2026-10-16T10:00:00Z',
        isActual: true,
      },
      {
        id: 'ev-test',
        workspaceId: 'a1111111-1111-4111-8111-111111111111',
        caseId: '22222222-2222-4222-8222-222222222222',
        eventType: 'BOOKING_CONFIRMED',
        reservationId: 'bk_test_demo',
        amountKrw: 100000,
        occurredAt: '2026-10-16T10:05:00Z',
        isActual: false,
      },
    ];

    const outcome = calculateRecoveryOutcome(events, {
      timezone: 'Asia/Seoul',
      requireActual: true,
    });

    expect(outcome.confirmedBookings).toBe(1);
    expect(outcome.activeConfirmedBookings).toBe(1);
  });
});
