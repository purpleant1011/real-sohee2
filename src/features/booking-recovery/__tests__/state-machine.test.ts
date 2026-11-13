import { describe, it, expect } from 'vitest';
import { canTransition } from '../state-machine';
import type { RecoveryStage } from '../contracts';

describe('Booking Recovery State Machine (Task 2)', () => {
  it('고객 의도(DISCOVERED)만으로 예약 확정을 허용하지 않는다', () => {
    expect(canTransition('DISCOVERED', 'BOOKING_CONFIRMED')).toBe(false);
    expect(canTransition('AWAITING_BOOKING_APPROVAL', 'BOOKING_CONFIRMED')).toBe(true);
  });

  it('발송 검증(SEND_VERIFIED) 전에는 고객 수락(CUSTOMER_ACCEPTED)으로 전이할 수 없다', () => {
    expect(canTransition('AWAITING_SEND_APPROVAL', 'CUSTOMER_ACCEPTED')).toBe(false);
    expect(canTransition('SEND_REQUESTED', 'CUSTOMER_ACCEPTED')).toBe(false);
    expect(canTransition('PROVIDER_ACCEPTED', 'CUSTOMER_ACCEPTED')).toBe(false);
    expect(canTransition('AWAITING_CUSTOMER', 'CUSTOMER_ACCEPTED')).toBe(true);
  });

  it('고객 수락 상태에서 직접 확정(BOOKING_CONFIRMED)으로 직행할 수 없다 (사장님 승인 대기 필수)', () => {
    expect(canTransition('CUSTOMER_ACCEPTED', 'BOOKING_CONFIRMED')).toBe(false);
    expect(canTransition('CUSTOMER_ACCEPTED', 'AWAITING_BOOKING_APPROVAL')).toBe(true);
    expect(canTransition('AWAITING_BOOKING_APPROVAL', 'BOOKING_CONFIRMED')).toBe(true);
  });

  it('RESULT_UNKNOWN 상태에서 SEND_REQUESTED로 자동 복귀할 수 없다 (자동 재발송 차단)', () => {
    expect(canTransition('RESULT_UNKNOWN', 'SEND_REQUESTED')).toBe(false);
    expect(canTransition('RESULT_UNKNOWN', 'AWAITING_SEND_APPROVAL')).toBe(false);
    expect(canTransition('RESULT_UNKNOWN', 'NEEDS_RECONCILIATION')).toBe(true);
    expect(canTransition('RESULT_UNKNOWN', 'HUMAN_REVIEW')).toBe(true);
  });

  it('종결 상태(BOOKING_CONFIRMED, DECLINED, EXPIRED)에서는 다른 상태로 전이할 수 없다', () => {
    const terminalStages: RecoveryStage[] = ['BOOKING_CONFIRMED', 'DECLINED', 'EXPIRED'];
    for (const terminal of terminalStages) {
      expect(canTransition(terminal, 'DRAFT_READY')).toBe(false);
      expect(canTransition(terminal, 'AWAITING_SEND_APPROVAL')).toBe(false);
      expect(canTransition(terminal, 'BOOKING_CONFIRMED')).toBe(false);
    }
  });
});
