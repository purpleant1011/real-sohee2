import type { SupabaseClient } from '@supabase/supabase-js';
import { RecoveryActor, RecoveryResult } from './contracts';
import { BookingRecoveryRepository, RecoveryCase } from './repository';

export interface ConfirmRecoveryBookingDependencies {
  repository: BookingRecoveryRepository;
  client: SupabaseClient<any>;
}

export interface ConfirmRecoveryBookingResult {
  reservationId: string;
  slotId: string;
  confirmedAt: string;
  case: RecoveryCase;
}

/**
 * Atomically confirms a recovery booking using the server RPC.
 *
 * Invariant:
 * 1. Actor authorization, row locks, case version, proposal snapshot, slot validity,
 *    durable owner approval, and customer acceptance message are checked inside one DB transaction.
 * 2. Reservation is inserted with standard 'bk_' text ID.
 * 3. Marketing mission is transitioned to BOOKED.
 * 4. Slot is transitioned to BOOKED.
 * 5. Generic transition to BOOKING_CONFIRMED is prohibited; only this adapter / RPC is authoritative.
 */
export async function confirmRecoveryBooking(
  actor: RecoveryActor,
  params: {
    caseId: string;
    expectedVersion: number;
    proposalRevision: number;
    inboundAcceptanceMessageId: string;
    fingerprint: string;
  },
  deps: ConfirmRecoveryBookingDependencies
): Promise<RecoveryResult<ConfirmRecoveryBookingResult>> {
  const { repository } = deps;

  try {
    const result = await repository.confirmBooking(actor, {
      caseId: params.caseId,
      expectedVersion: params.expectedVersion,
      proposalRevision: params.proposalRevision,
      inboundAcceptanceMessageId: params.inboundAcceptanceMessageId,
      fingerprint: params.fingerprint,
    });

    return {
      ok: true,
      value: {
        reservationId: result.reservation_id,
        slotId: result.slot_id,
        confirmedAt: result.confirmed_at,
        case: result.case,
      },
    };
  } catch (error: any) {
    const code = error?.code || 'INTERNAL_ERROR';
    const message = error?.message || '예약 확정 실패';

    if (['VERSION_CONFLICT', '23505', '23P01', '40001', '40P01'].includes(code) || String(message).includes('VERSION_CONFLICT') || String(message).includes('CONFLICT')) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        message: '예약 슬롯 또는 케이스 상태가 변경되었습니다. 최신 정보를 확인해 주세요.',
      };
    }

    if (code === 'FORBIDDEN' || String(message).includes('FORBIDDEN')) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: '예약 확정 권한이 없거나 유효한 사장님 승인 기록이 없습니다.',
      };
    }

    if (code === 'NOT_FOUND' || String(message).includes('NOT_FOUND')) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: '필요한 예약 제안 또는 고객 수락 메시지를 찾을 수 없습니다.',
      };
    }

    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: '예약 확정 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    };
  }
}
