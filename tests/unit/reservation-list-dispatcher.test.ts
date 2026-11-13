import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher';
import { ReservationCanonicalService } from '@/features/reservations/reservation-canonical-service';

// Hoistable mock state for Supabase
const mockState = {
  mockClient: null as any,
};

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => mockState.mockClient),
}));

describe('ANI-981 / Task B: reservation.list dispatcher routing & honest queries', () => {
  const WORKSPACE_ID = 'ws-test-res-list';
  const OTHER_WORKSPACE_ID = 'ws-other-res-list';

  beforeEach(() => {
    ReservationCanonicalService.resetState();
    mockState.mockClient = null;
    vi.clearAllMocks();
  });

  it('dispatches reservation.list and returns masked reservations filtered by workspace_id', async () => {
    const mockReservations = [
      {
        id: 'bk_1',
        workspace_id: WORKSPACE_ID,
        slot_id: '2026-10-15T14:00:00Z',
        customer_id: 'cust_1',
        customer_name: '홍길동',
        customer_phone: '010-1234-5678',
        service_id: 'srv_1',
        service_name: '속눈썹 펌',
        status: 'CONFIRMED',
        deposit_krw: 20000,
        total_amount_krw: 50000,
        channel_source: 'INSTAGRAM_DM',
        proof_id: 'proof_1',
        confirmed_at: '2026-10-10T10:00:00Z',
        created_at: '2026-10-10T10:00:00Z',
        updated_at: '2026-10-10T10:00:00Z',
      },
      {
        id: 'bk_other',
        workspace_id: OTHER_WORKSPACE_ID,
        slot_id: '2026-10-15T16:00:00Z',
        customer_id: 'cust_other',
        customer_name: '타매장손님',
        customer_phone: '010-0000-0000',
        service_id: 'srv_other',
        service_name: '타매장시술',
        status: 'CONFIRMED',
        deposit_krw: 10000,
        total_amount_krw: 30000,
        channel_source: 'INSTAGRAM_DM',
        proof_id: 'proof_other',
        confirmed_at: '2026-10-10T10:00:00Z',
        created_at: '2026-10-10T10:00:00Z',
        updated_at: '2026-10-10T10:00:00Z',
      },
      {
        id: 'bk_2',
        workspace_id: WORKSPACE_ID,
        slot_id: '2026-10-16T15:00:00Z',
        customer_id: 'cust_2',
        customer_name: '이영희',
        customer_phone: '010-9876-5432',
        service_id: 'srv_2',
        service_name: '자연 눈썹',
        status: 'CONFIRMED',
        deposit_krw: 30000,
        total_amount_krw: 120000,
        channel_source: 'INSTAGRAM_DM',
        proof_id: 'proof_2',
        confirmed_at: '2026-10-11T11:00:00Z',
        created_at: '2026-10-11T11:00:00Z',
        updated_at: '2026-10-11T11:00:00Z',
      },
    ];

    mockState.mockClient = {
      from: vi.fn((table: string) => {
        expect(table).toBe('reservations');
        let currentWorkspaceFilter: string | null = null;
        let currentStatusFilter: string | null = null;

        const builder: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: string) => {
            if (col === 'workspace_id') currentWorkspaceFilter = val;
            if (col === 'status') currentStatusFilter = val;
            return builder;
          }),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockImplementation(async () => {
            const filtered = mockReservations.filter(
              (r) =>
                r.workspace_id === currentWorkspaceFilter &&
                (!currentStatusFilter || r.status === currentStatusFilter)
            );
            return { data: filtered, error: null };
          }),
        };
        return builder;
      }),
    };

    const result = await ToolDispatcher.dispatch(
      'reservation.list',
      { status: 'CONFIRMED' },
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-res-list',
      }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETED');
    const data = result.data as any;
    expect(data?.empty).toBe(false);
    expect(data?.count).toBe(2);

    // Customer personal information must be masked
    const items = data?.reservations;
    expect(items[0].customerName).toBe('홍*동');
    expect(items[0].customerPhone).toBe('010-****-5678');
    expect(items[1].customerName).toBe('이*희');
    expect(items[1].customerPhone).toBe('010-****-5432');
  });

  it('returns honest empty result when no reservations exist', async () => {
    mockState.mockClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
    };

    const result = await ToolDispatcher.dispatch(
      'reservation.list',
      {},
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-res-empty',
      }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('COMPLETED');
    const emptyData = result.data as any;
    expect(emptyData?.empty).toBe(true);
    expect(emptyData?.count).toBe(0);
    expect(emptyData?.reservations).toEqual([]);
  });

  it('fails with error and does not pretend success on query error', async () => {
    mockState.mockClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database connection failed', code: 'PGRST000' },
        }),
      })),
    };

    const result = await ToolDispatcher.dispatch(
      'reservation.list',
      {},
      {
        workspaceId: WORKSPACE_ID,
        correlationId: 'test-corr-res-error',
      }
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error?.message).toContain('예약');
  });
});
