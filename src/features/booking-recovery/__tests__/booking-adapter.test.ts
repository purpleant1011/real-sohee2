import { describe, it, expect, vi, beforeEach } from 'vitest';
import { confirmRecoveryBooking } from '../booking-adapter';
import { BookingRecoveryRepository } from '../repository';
import { RecoveryActor } from '../contracts';

describe('Booking Recovery Booking Adapter', () => {
  let mockSupabase: any;
  let repository: BookingRecoveryRepository;

  const actor: RecoveryActor = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    role: 'owner',
  };

  const caseId = '33333333-3333-4333-8333-333333333333';
  const acceptanceMessageId = '44444444-4444-4444-8444-444444444444';
  const fingerprint = 'a'.repeat(64);

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn(),
    };
    repository = new BookingRecoveryRepository(mockSupabase);
  });

  it('RPC confirm_booking_recovery를 통해 예약 확정 및 원자 트랜잭션을 커밋한다', async () => {
    vi.spyOn(repository, 'confirmBooking').mockResolvedValue({
      case: {
        id: caseId,
        workspace_id: actor.workspaceId,
        mission_id: '55555555-5555-4555-8555-555555555555',
        source_thread_id: '66666666-6666-4666-8666-666666666666',
        source_inbound_message_id: '77777777-7777-4777-8777-777777777777',
        customer_ref: 'cust_100',
        stage: 'BOOKING_CONFIRMED',
        version: 5,
        created_at: '2026-10-16T10:00:00Z',
        updated_at: '2026-10-16T12:00:00Z',
      },
      reservation_id: 'bk_12345678abcdef',
      slot_id: '88888888-8888-4888-8888-888888888888',
      confirmed_at: '2026-10-16T12:00:00Z',
    });

    const result = await confirmRecoveryBooking(
      actor,
      {
        caseId,
        expectedVersion: 4,
        proposalRevision: 1,
        inboundAcceptanceMessageId: acceptanceMessageId,
        fingerprint,
      },
      { repository, client: mockSupabase }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reservationId).toBe('bk_12345678abcdef');
      expect(result.value.case.stage).toBe('BOOKING_CONFIRMED');
    }
  });

  it.each(['23505', '23P01', '40001', '40P01'])('DB 충돌 %s는 재확인 가능한 충돌로 반환한다', async (code) => {
    vi.spyOn(repository, 'confirmBooking').mockRejectedValue({ code, message: 'database rejected transaction' });
    const result = await confirmRecoveryBooking(actor, {
      caseId, expectedVersion: 4, proposalRevision: 1,
      inboundAcceptanceMessageId: acceptanceMessageId, fingerprint,
    }, { repository, client: mockSupabase });
    expect(result).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect(repository.confirmBooking).toHaveBeenCalledTimes(1);
  });

  it('슬롯 충돌 또는 버전 불일치 시 409 VERSION_CONFLICT를 반환한다', async () => {
    vi.spyOn(repository, 'confirmBooking').mockRejectedValue({
      code: 'VERSION_CONFLICT',
      message: '슬롯 버전이 일치하지 않거나 이미 마감되었습니다.',
    });

    const result = await confirmRecoveryBooking(
      actor,
      {
        caseId,
        expectedVersion: 4,
        proposalRevision: 1,
        inboundAcceptanceMessageId: acceptanceMessageId,
        fingerprint,
      },
      { repository, client: mockSupabase }
    );

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});
