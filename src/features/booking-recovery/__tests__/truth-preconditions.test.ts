import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReservationCanonicalService, ReservationError } from '@/features/reservations/reservation-canonical-service';
import { BookingConflictGuard } from '@/features/booking/booking-conflict-guard';
import { customerDispatcher } from '@/features/tool-runtime/dispatchers/customer-dispatcher';

describe('Truth Preconditions & Fail-Closed Booking (Task 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ReservationCanonicalService.resetState();
  });

  describe('ReservationCanonicalService.createReservation', () => {
    it('서비스와 가격이 없으면 예약을 만들지 않는다', async () => {
      const db = { from: vi.fn() };
      await expect(
        ReservationCanonicalService.createReservation(
          {
            workspaceId: 'workspace-a',
            slotId: 'slot-a',
            customerId: 'customer-a',
          },
          db
        )
      ).rejects.toThrow(/SERVICE_SPECIFICATION_REQUIRED/);
      expect(db.from).not.toHaveBeenCalled();
    });

    it('serviceId나 serviceName이 누락되면 예약을 만들지 않는다', async () => {
      const db = { from: vi.fn() };
      await expect(
        ReservationCanonicalService.createReservation(
          {
            workspaceId: 'workspace-a',
            slotId: 'slot-a',
            customerId: 'customer-a',
            serviceId: '',
            serviceName: '펌 시술',
            totalAmountKrw: 100000,
            depositKrw: 20000,
          },
          db
        )
      ).rejects.toThrow(/SERVICE_SPECIFICATION_REQUIRED/);

      await expect(
        ReservationCanonicalService.createReservation(
          {
            workspaceId: 'workspace-a',
            slotId: 'slot-a',
            customerId: 'customer-a',
            serviceId: 'srv-1',
            serviceName: '',
            totalAmountKrw: 100000,
            depositKrw: 20000,
          },
          db
        )
      ).rejects.toThrow(/SERVICE_SPECIFICATION_REQUIRED/);
      expect(db.from).not.toHaveBeenCalled();
    });

    it('totalAmountKrw가 누락, 음수, NaN인 경우 차단한다', async () => {
      const db = { from: vi.fn() };
      for (const invalidAmount of [undefined, -5000, NaN, 1.5]) {
        await expect(
          ReservationCanonicalService.createReservation(
            {
              workspaceId: 'workspace-a',
              slotId: 'slot-a',
              customerId: 'customer-a',
              serviceId: 'srv-1',
              serviceName: '상담',
              totalAmountKrw: invalidAmount as any,
              depositKrw: 0,
            },
            db
          )
        ).rejects.toThrow(/SERVICE_SPECIFICATION_REQUIRED/);
      }
      expect(db.from).not.toHaveBeenCalled();
    });

    it('depositKrw가 누락, 음수, NaN 또는 totalAmountKrw를 초과하면 차단한다', async () => {
      const db = { from: vi.fn() };
      // 누락, 음수, NaN, 소수
      for (const invalidDeposit of [undefined, -1000, NaN, 10.5]) {
        await expect(
          ReservationCanonicalService.createReservation(
            {
              workspaceId: 'workspace-a',
              slotId: 'slot-a',
              customerId: 'customer-a',
              serviceId: 'srv-1',
              serviceName: '상담',
              totalAmountKrw: 50000,
              depositKrw: invalidDeposit as any,
            },
            db
          )
        ).rejects.toThrow(/SERVICE_SPECIFICATION_REQUIRED/);
      }

      // totalAmountKrw 초과 (예약금 60,000 > 총액 50,000)
      await expect(
        ReservationCanonicalService.createReservation(
          {
            workspaceId: 'workspace-a',
            slotId: 'slot-a',
            customerId: 'customer-a',
            serviceId: 'srv-1',
            serviceName: '상담',
            totalAmountKrw: 50000,
            depositKrw: 60000,
          },
          db
        )
      ).rejects.toThrow(/SERVICE_SPECIFICATION_REQUIRED/);
      expect(db.from).not.toHaveBeenCalled();
    });

    it('확인된 무료 서비스는 0원 금액과 0원 예약금을 정상 보존한다', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const db = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'reservations') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: mockMaybeSingle,
              insert: mockInsert,
            };
          }
          return {};
        }),
      };

      const result = await ReservationCanonicalService.createReservation(
        {
          workspaceId: 'workspace-a',
          slotId: 'slot-free',
          customerId: 'customer-a',
          serviceId: 'srv-free',
          serviceName: '무료 첫 상담',
          totalAmountKrw: 0,
          depositKrw: 0,
        },
        db
      );

      expect(result.totalAmountKrw).toBe(0);
      expect(result.depositKrw).toBe(0);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          total_amount_krw: 0,
          deposit_krw: 0,
          service_id: 'srv-free',
          service_name: '무료 첫 상담',
        })
      );
    });

    it('조회 중 DB 에러(PGRST116 포함) 발생 시 예외 무시 없이 fail-closed 에러를 던진다', async () => {
      const db = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116', message: 'multiple rows or internal db error' },
          }),
        }),
      };

      await expect(
        ReservationCanonicalService.createReservation(
          {
            workspaceId: 'workspace-a',
            slotId: 'slot-a',
            customerId: 'customer-a',
            serviceId: 'srv-1',
            serviceName: '상담',
            totalAmountKrw: 50000,
            depositKrw: 10000,
          },
          db
        )
      ).rejects.toThrow(/DB_CHECK_FAILED/);
    });
  });

  describe('BookingConflictGuard.evaluateBookingSafety', () => {
    it('조회 실패를 빈 슬롯으로 취급하지 않는다 (PGRST116 포함 모든 에러 fail-closed)', async () => {
      for (const errCode of ['PGRST116', 'CONNECTION_REFUSED', 'UNKNOWN']) {
        const db = {
          from: () => ({
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: null, error: { code: errCode, message: 'db error' } }),
                  }),
                }),
              }),
            }),
          }),
        };
        const guard = new BookingConflictGuard(db as never);
        const result = await guard.evaluateBookingSafety({
          workspaceId: 'workspace-a',
          slotId: 'slot-a',
          customerId: 'customer-a',
          customerMessage: '예약 문의',
        });
        expect(result.action).toBe('HUMAN_REVIEW');
        expect(result.requiresHandoff).toBe(true);
        expect(result.riskReason).toContain('예약표를 확인하지 못했습니다');
      }
    });

    it('확인된 예약이 이미 존재하면 CONFLICT를 반환한다', async () => {
      const db = {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: 'bk_existing', slot_id: 'slot-a' },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      };
      const guard = new BookingConflictGuard(db as never);
      const result = await guard.evaluateBookingSafety({
        workspaceId: 'workspace-a',
        slotId: 'slot-a',
        customerId: 'customer-a',
        customerMessage: '예약 문의',
      });
      expect(result.action).toBe('CONFLICT');
      expect(result.conflictSlotId).toBe('slot-a');
    });
  });

  describe('customerDispatcher (reservation.create)', () => {
    it('DRAFT 모드에서도 slotId나 customerId가 공란이면 AWAITING_APPROVAL 성공 카드를 내지 않고 차단한다', async () => {
      const context = {
        workspaceId: 'workspace-a',
        userId: 'user-a',
        intentMode: 'DRAFT' as const,
        correlationId: 'corr-1',
      };

      // slotId 누락
      const noSlot = await customerDispatcher.execute(
        {
          _toolName: 'reservation.create',
          slotId: '',
          customerId: 'cust-1',
          serviceId: 'srv-1',
          serviceName: '기본 시술',
          totalAmountKrw: 50000,
          depositKrw: 10000,
        },
        context
      );
      expect(noSlot.success).toBe(false);
      expect(noSlot.status).toBe('FAILED');
      expect(noSlot.error?.code).toBe('INVALID_RESERVATION_PARAMS');

      // customerId 누락
      const noCustomer = await customerDispatcher.execute(
        {
          _toolName: 'reservation.create',
          slotId: 'slot-1',
          customerId: '',
          serviceId: 'srv-1',
          serviceName: '기본 시술',
          totalAmountKrw: 50000,
          depositKrw: 10000,
        },
        context
      );
      expect(noCustomer.success).toBe(false);
      expect(noCustomer.status).toBe('FAILED');
      expect(noCustomer.error?.code).toBe('INVALID_RESERVATION_PARAMS');
    });

    it('서비스/가격 명시가 누락되면 기본값을 주입하지 않고 실패(fail-closed)한다', async () => {
      const context = {
        workspaceId: 'workspace-a',
        userId: 'user-a',
        intentMode: 'EXECUTE' as const,
        correlationId: 'corr-1',
      };

      const result = await customerDispatcher.execute(
        {
          _toolName: 'reservation.create',
          slotId: 'slot-1',
          customerId: 'cust-1',
          // serviceId, serviceName, totalAmountKrw, depositKrw 의도적 누락
        },
        context
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.error?.code).toBe('SERVICE_SPECIFICATION_REQUIRED');
    });
  });
});
