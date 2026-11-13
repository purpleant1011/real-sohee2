import { describe, expect, it, vi } from 'vitest';
import { ReservationCanonicalService } from '../reservation-canonical-service';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/features/booking-recovery/production', () => ({ isRecoveryEnabled: () => false }));

const row = {
  id: 'bk_cancel_write_failure', workspace_id: 'workspace-cancel', slot_id: 'slot-cancel',
  customer_id: 'customer-cancel', customer_name: '테스트 고객', service_id: 'service-cancel',
  service_name: '테스트 서비스', status: 'CONFIRMED', deposit_krw: 0, total_amount_krw: 40000,
  channel_source: 'MANUAL', confirmed_at: '2026-10-21T10:00:00Z',
  created_at: '2026-10-21T10:00:00Z', updated_at: '2026-10-21T10:00:00Z',
};

describe('ANI-1612 reservation cancellation truth', () => {
  it.each(['unchanged', 'readback-error', 'missing'])(
    'UPDATE 응답만으로 성공을 선언하지 않고 최종 장부를 확인한다 (%s)', async (scenario) => {
      const maybeSingle = vi.fn()
        .mockResolvedValueOnce({ data: { ...row }, error: null })
        .mockResolvedValueOnce({
          data: scenario === 'unchanged' ? { ...row } : null,
          error: scenario === 'readback-error' ? { message: 'readback unavailable' } : null,
        });
      const client = { from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle,
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      }) };
      await expect(ReservationCanonicalService.cancelReservation(row.id, '테스트 취소', client))
        .rejects.toMatchObject({ code: scenario === 'unchanged' ? 'CANCELLATION_NOT_VERIFIED' : 'CANCELLATION_RESULT_UNKNOWN' });
    });
  it('처음 예약 조회가 실패하면 예약 없음으로 숨기지 않는다', async () => {
    const client = { from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'lookup unavailable' } }),
    }) };
    await expect(ReservationCanonicalService.cancelReservation(row.id, undefined, client))
      .rejects.toMatchObject({ code: 'CANCELLATION_LOOKUP_FAILED', statusCode: 500 });
  });

  it('DB 취소 UPDATE가 실패하면 취소 성공을 반환하지 않는다', async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'database write rejected' } }),
    });
    const client = { from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { ...row }, error: null }), update,
    }) };
    await expect(ReservationCanonicalService.cancelReservation(row.id, '테스트 취소', client))
      .rejects.toMatchObject({ code: 'CANCELLATION_WRITE_FAILED', statusCode: 500 });
    expect(update).toHaveBeenCalledTimes(1);
  });

  describe('rescheduleReservation atomic swap', () => {
    const newSlot = {
      id: 'slot-new',
      workspace_id: 'workspace-cancel',
      service_id: 'service-cancel',
      status: 'AVAILABLE',
    };

    it('변경 대상 슬롯이 마감되었거나 없으면 변경을 거부하고 기존 상태를 보존한다', async () => {
      const client = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'reservations') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: { ...row }, error: null }),
            };
          }
          if (table === 'booking_recovery_slots') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { ...newSlot, status: 'BOOKED' }, // 이미 예약됨
                error: null,
              }),
            };
          }
          return {};
        }),
      };

      await expect(
        ReservationCanonicalService.rescheduleReservation(row.id, newSlot.id, '시간 변경', client)
      ).rejects.toMatchObject({ code: 'SLOT_NOT_AVAILABLE', statusCode: 409 });
    });

    it('새 슬롯이 사용 가능하면 DB UPDATE 후 readback 확인을 거쳐 변경을 확정한다', async () => {
      const updatedRow = { ...row, slot_id: newSlot.id, updated_at: '2026-10-22T00:00:00Z' };
      const maybeSingleRes = vi
        .fn()
        .mockResolvedValueOnce({ data: { ...row }, error: null }) // Initial find
        .mockResolvedValueOnce({ data: updatedRow, error: null }); // Readback

      const resQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: maybeSingleRes,
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      };

      const slotQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { ...newSlot }, error: null }),
      };

      const client = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'reservations') return resQuery;
          if (table === 'booking_recovery_slots') return slotQuery;
          return {};
        }),
      };

      const result = await ReservationCanonicalService.rescheduleReservation(
        row.id,
        newSlot.id,
        '시간 변경',
        client
      );
      expect(result.slotId).toBe(newSlot.id);
    });
  });
});
