import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET, POST } from './route';
import * as routeAuth from '@/features/quick-start/route-auth';

vi.mock('@/features/quick-start/route-auth');

describe('Booking Recovery Availability API Route (Task 4)', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const serviceId = '33333333-3333-4333-8333-333333333333';

  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BOOKING_RECOVERY_ENABLED = 'true';
    process.env.BOOKING_RECOVERY_WORKSPACE_ALLOWLIST = workspaceId;
    delete process.env.BOOKING_RECOVERY_KILL_SWITCH;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe('GET', () => {
    it('인증된 사용자의 활성 카탈로그 서비스와 가용 슬롯 목록을 반환한다', async () => {
      const mockServices = [
        {
          id: serviceId,
          workspace_id: workspaceId,
          name: '헤어 컷',
          price: 30000,
          active: true,
          updated_at: '2026-10-15T00:00:00Z',
          duration_minutes: 60,
        },
      ];
      const mockSlots = [
        {
          id: 'slot-1',
          workspace_id: workspaceId,
          service_id: serviceId,
          starts_at: '2026-10-20T14:00:00Z',
          ends_at: '2026-10-20T15:00:00Z',
          timezone: 'Asia/Seoul',
          confirmed_by: userId,
          confirmed_at: '2026-10-16T10:00:00Z',
          valid_until: '2026-10-16T10:15:00Z',
          version: 1,
          status: 'AVAILABLE',
        },
      ];

      const mockAdmin = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'workspace_products_services') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: mockServices, error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === 'booking_recovery_slots') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    gt: vi.fn().mockReturnValue({
                      gt: vi.fn().mockReturnValue({
                        order: vi.fn().mockResolvedValue({ data: mockSlots, error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(routeAuth, 'authorizeQuickRequest').mockResolvedValue({
        userId,
        workspaceId,
        role: 'owner',
        admin: mockAdmin,
        supabase: {} as any,
      });

      const req = new Request('http://localhost/api');
      const res = await GET(req, { params: Promise.resolve({ workspaceId }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.services).toHaveLength(1);
      expect(json.services[0].name).toBe('헤어 컷');
      // ANI-1609: the slot-duration guard reads the catalog duration, so it must survive the DTO.
      expect(json.services[0].durationMinutes).toBe(60);
      expect(json.slots).toHaveLength(1);
      expect(json.slots[0].id).toBe('slot-1');
    });
  });

  describe('POST', () => {
    it('유효한 슬롯 입력을 검증하고 201 상태로 새 슬롯을 생성한다', async () => {
      const mockService = {
        id: serviceId,
        active: true,
        price: 30000,
        // ANI-1609: createOwnerConfirmedSlot refuses a catalog row without a duration.
        duration_minutes: 60,
      };

      const mockCreatedSlot = {
        id: 'new-slot-id',
        workspace_id: workspaceId,
        service_id: serviceId,
        starts_at: '2026-10-20T14:00:00.000Z',
        ends_at: '2026-10-20T15:00:00.000Z',
        timezone: 'Asia/Seoul',
        confirmed_by: userId,
        confirmed_at: '2026-10-16T10:00:00.000Z',
        valid_until: '2026-10-16T10:15:00.000Z',
        version: 1,
        status: 'AVAILABLE',
      };

      const mockAdmin = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'workspace_products_services') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: mockService, error: null }),
                  }),
                }),
              }),
            };
          }
          if (table === 'booking_recovery_slots') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    lte: vi.fn().mockResolvedValue({ error: null }),
                  }),
                }),
              }),
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: mockCreatedSlot, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(routeAuth, 'authorizeQuickRequest').mockResolvedValue({
        userId,
        workspaceId,
        role: 'owner',
        admin: mockAdmin,
        supabase: {} as any,
      });

      const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const futureEnd = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();

      const body = {
        serviceId,
        startsAt: futureStart,
        endsAt: futureEnd,
        depositKrw: 10000,
        timezone: 'Asia/Seoul',
        acknowledgedLedger: true,
      };

      const req = new Request('http://localhost/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const res = await POST(req, { params: Promise.resolve({ workspaceId }) });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.slot.id).toBe('new-slot-id');
    });

    it('장부 미확인(acknowledgedLedger: false) 시 422 에러를 반환한다', async () => {
      vi.spyOn(routeAuth, 'authorizeQuickRequest').mockResolvedValue({
        userId,
        workspaceId,
        role: 'owner',
        admin: {},
        supabase: {} as any,
      });

      const body = {
        serviceId,
        startsAt: '2026-10-20T14:00:00.000Z',
        endsAt: '2026-10-20T15:00:00.000Z',
        depositKrw: 10000,
        timezone: 'Asia/Seoul',
        acknowledgedLedger: false, // Invalid!
      };

      const req = new Request('http://localhost/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const res = await POST(req, { params: Promise.resolve({ workspaceId }) });
      expect(res.status).toBe(422);
    });

    it('기능 게이트가 비활성화되어 있으면 503 상태를 반환한다', async () => {
      process.env.BOOKING_RECOVERY_ENABLED = 'false';

      const req = new Request('http://localhost/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await POST(req, { params: Promise.resolve({ workspaceId }) });
      expect(res.status).toBe(503);
    });

    // D-3: the owner's own mistakes must not come back as an opaque 500.
    function adminWithService(service: Record<string, unknown>) {
      return {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'workspace_products_services') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: service, error: null }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };
    }

    function slotRequest(body: Record<string, unknown>) {
      return new Request('http://localhost/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    const futureWindow = () => ({
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
    });

    it('카탈로그 소요시간이 없으면 422와 구체 사유를 돌려준다(500 아님)', async () => {
      vi.spyOn(routeAuth, 'authorizeQuickRequest').mockResolvedValue({
        userId,
        workspaceId,
        role: 'owner',
        admin: adminWithService({ id: serviceId, active: true, price: 30000, duration_minutes: null }),
        supabase: {} as any,
      });

      const res = await POST(
        slotRequest({ serviceId, ...futureWindow(), depositKrw: 10000, timezone: 'Asia/Seoul', acknowledgedLedger: true }),
        { params: Promise.resolve({ workspaceId }) },
      );

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.code).toBe('SLOT_SERVICE_DURATION_MISSING');
      expect(json.error).toContain('소요시간');
      expect(json.error).toContain('카탈로그');
    });

    it('슬롯 길이가 소요시간보다 짧으면 422로 어느 쪽이 짧은지 알려준다', async () => {
      vi.spyOn(routeAuth, 'authorizeQuickRequest').mockResolvedValue({
        userId,
        workspaceId,
        role: 'owner',
        admin: adminWithService({ id: serviceId, active: true, price: 30000, duration_minutes: 90 }),
        supabase: {} as any,
      });

      const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const res = await POST(
        slotRequest({
          serviceId,
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
          depositKrw: 10000,
          timezone: 'Asia/Seoul',
          acknowledgedLedger: true,
        }),
        { params: Promise.resolve({ workspaceId }) },
      );

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.code).toBe('SLOT_TOO_SHORT');
      expect(json.error).toContain('30분');
      expect(json.error).toContain('90분');
    });

    it('비활성 서비스는 400으로 알린다', async () => {
      vi.spyOn(routeAuth, 'authorizeQuickRequest').mockResolvedValue({
        userId,
        workspaceId,
        role: 'owner',
        admin: adminWithService({ id: serviceId, active: false, price: 30000, duration_minutes: 90 }),
        supabase: {} as any,
      });

      const res = await POST(
        slotRequest({ serviceId, ...futureWindow(), depositKrw: 10000, timezone: 'Asia/Seoul', acknowledgedLedger: true }),
        { params: Promise.resolve({ workspaceId }) },
      );

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('SLOT_SERVICE_INACTIVE');
    });

    it('예약금이 서비스 금액을 넘으면 422로 알린다', async () => {
      vi.spyOn(routeAuth, 'authorizeQuickRequest').mockResolvedValue({
        userId,
        workspaceId,
        role: 'owner',
        admin: adminWithService({ id: serviceId, active: true, price: 10000, duration_minutes: 60 }),
        supabase: {} as any,
      });

      const res = await POST(
        slotRequest({ serviceId, ...futureWindow(), depositKrw: 20000, timezone: 'Asia/Seoul', acknowledgedLedger: true }),
        { params: Promise.resolve({ workspaceId }) },
      );

      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe('SLOT_DEPOSIT_EXCEEDS_PRICE');
    });

    it('예상 못 한 서버 오류는 여전히 불투명한 500으로 남는다', async () => {
      vi.spyOn(routeAuth, 'authorizeQuickRequest').mockResolvedValue({
        userId,
        workspaceId,
        role: 'owner',
        admin: {
          from: vi.fn().mockImplementation(() => {
            throw new Error('db exploded: connection refused');
          }),
        },
        supabase: {} as any,
      });

      const res = await POST(
        slotRequest({ serviceId, ...futureWindow(), depositKrw: 10000, timezone: 'Asia/Seoul', acknowledgedLedger: true }),
        { params: Promise.resolve({ workspaceId }) },
      );

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('예약 가능 시간 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      // Internal detail must not leak to the owner.
      expect(JSON.stringify(json)).not.toContain('db exploded');
    });
  });
});
