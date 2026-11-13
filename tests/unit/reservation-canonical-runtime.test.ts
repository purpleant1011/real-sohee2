import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractionExecutor } from '@/lib/agent-os/executors/interaction-executor';
import {
  ReservationCanonicalService,
  ReservationError,
} from '@/features/reservations/reservation-canonical-service';

// Mock Supabase server client
const mockDbTables: Record<string, any[]> = {
  customer_conversations: [],
  external_action_receipts: [],
  evidence_chains: [],
  evidence_blocks: [],
  reservations: [],
};

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      let currentTable = mockDbTables[table] || [];
      let filters: Record<string, any> = {};

      const queryBuilder: any = {
        select: vi.fn(() => queryBuilder),
        eq: vi.fn((col: string, val: any) => {
          filters[col] = val;
          return queryBuilder;
        }),
        order: vi.fn(() => queryBuilder),
        limit: vi.fn(() => queryBuilder),
        maybeSingle: vi.fn(async () => {
          const match = currentTable.find(row =>
            Object.entries(filters).every(([k, v]) => row[k] === v)
          );
          return { data: match || null, error: null };
        }),
        insert: vi.fn(async (rows: any | any[]) => {
          const toInsert = Array.isArray(rows) ? rows : [rows];
          // Check simulated unique constraint: (workspace_id, slot_id, status)
          for (const row of toInsert) {
            if (table === 'reservations' && row.status === 'CONFIRMED') {
              const conflict = currentTable.find(
                r => r.workspace_id === row.workspace_id &&
                     r.slot_id === row.slot_id &&
                     r.status === 'CONFIRMED'
              );
              if (conflict) {
                return {
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint on slot_id' },
                };
              }
            }
          }
          currentTable.push(...toInsert);
          return { data: toInsert, error: null };
        }),
        update: vi.fn((updates: any) => ({
          eq: vi.fn(async (col: string, val: any) => {
            let updated = 0;
            currentTable.forEach(row => {
              if (row[col] === val) {
                Object.assign(row, updates);
                updated++;
              }
            });
            return { data: updated, error: null };
          }),
        })),
      };

      // Thenable to support awaiting the builder directly
      queryBuilder.then = (resolve: any) => {
        let results = currentTable.filter(row =>
          Object.entries(filters).every(([k, v]) => row[k] === v)
        );
        return Promise.resolve({ data: results, error: null }).then(resolve);
      };

      return queryBuilder;
    }),
  })),
}));

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn(async () => ({ blocked: false })),
}));

// Mock Meta provider response
vi.mock('@/features/channels/meta-response-provider', () => ({
  sendApprovedMetaResponse: vi.fn(async (claim: any) => {
    return {
      providerReference: `meta_msg_${claim.claimToken.slice(0, 8)}`,
    };
  }),
}));

describe('Task 3.4: DM / Comment Evidence Maturity & Reservation Runtime', () => {
  const workspaceId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbTables.customer_conversations = [];
    mockDbTables.external_action_receipts = [];
    mockDbTables.evidence_chains = [];
    mockDbTables.evidence_blocks = [];
    mockDbTables.reservations = [];
    ReservationCanonicalService.resetState();
  });

  describe('Part 1: ANI-980 DM / Comment Evidence Maturity', () => {
    it('should NOT claim EXTERNAL_VERIFIED when sending DM without independent readback', async () => {
      const result = await InteractionExecutor.sendDirectMessage({
        workspaceId,
        channel: 'INSTAGRAM',
        targetId: 'customer_insta_101',
        replyText: '안녕하세요! 예약 상담 도와드리겠습니다.',
        intentMode: 'EXECUTE',
      });

      // 1. Must succeed in execution
      expect(result.success).toBe(true);
      expect(result.externalMessageSent).toBe(true);
      expect(result.providerReference).toBeDefined();

      // 2. ANI-980 Invariant: Must NOT jump to EXTERNAL_VERIFIED without readback
      expect(result.evidenceMaturity).not.toBe('EXTERNAL_VERIFIED');
      expect(['PROVIDER_ACCEPTED', 'VERIFICATION_LIMITED']).toContain(result.evidenceMaturity);
      expect(result.verified).toBe(false);

      // 3. Must preserve provider reference & raw response
      expect(result.rawProviderResponse).toBeDefined();
      expect(result.statusMessage).toContain(result.providerReference!);
    });

    it('should record VERIFICATION_LIMITED for comment reply when readback is unavailable', async () => {
      const result = await InteractionExecutor.replyToComment({
        workspaceId,
        channel: 'INSTAGRAM',
        targetId: 'comment_insta_202',
        replyText: '문의주셔서 감사합니다! DM으로 안내해 드렸습니다 :)',
        intentMode: 'EXECUTE',
      });

      expect(result.success).toBe(true);
      expect(result.externalMessageSent).toBe(true);
      expect(result.evidenceMaturity).toBe('VERIFICATION_LIMITED');
      expect(result.verified).toBe(false);
    });

    it('should elevate to EXTERNAL_VERIFIED only when independent readback verifier explicitly certifies', async () => {
      const result = await InteractionExecutor.sendDirectMessage({
        workspaceId,
        channel: 'INSTAGRAM',
        targetId: 'customer_insta_303',
        replyText: '독립 리드백 검증 테스트 메시지',
        intentMode: 'EXECUTE',
        readbackVerifier: async () => ({
          isVerified: true,
          authoritativeId: 'meta_msg_readback_verified',
        }),
      });

      expect(result.success).toBe(true);
      expect(result.evidenceMaturity).toBe('EXTERNAL_VERIFIED');
      expect(result.verified).toBe(true);
    });
  });

  describe('Part 2: ANI-981 Reservation Canonical Runtime & Atomic Locking', () => {
    const slotId = '2026-09-10T14:00:00.000Z';

    it('should create confirmed reservation with unique bookingId and durable DB persistence', async () => {
      const res = await ReservationCanonicalService.createReservation({
        workspaceId,
        slotId,
        customerId: 'cust_001',
        customerName: '김민지',
        customerPhone: '010-1234-5678',
        serviceId: 'srv_eyebrow',
        serviceName: '1:1 맞춤 자연눈썹',
        depositKrw: 30000,
        totalAmountKrw: 150000,
        channelSource: 'INSTAGRAM_DM',
      });

      expect(res.bookingId).toMatch(/^bk_/);
      expect(res.status).toBe('CONFIRMED');
      expect(res.slotId).toBe(slotId);
      expect(res.customerName).toBe('김민지');
      expect(res.depositKrw).toBe(30000);
      expect(res.proofId).toBeDefined();
      expect(res.confirmedAt).toBeDefined();

      // Check durable DB persistence in reservations table
      const inDb = mockDbTables.reservations.find(r => r.id === res.bookingId);
      expect(inDb).toBeDefined();
      expect(inDb.status).toBe('CONFIRMED');
      expect(inDb.slot_id).toBe(slotId);
      expect(inDb.deposit_krw).toBe(30000);
    });

    it('should block double-booking with 0 collisions when 10 concurrent requests target the same slot', async () => {
      const concurrentAttempts = 10;
      const promises = Array.from({ length: concurrentAttempts }).map((_, idx) =>
        ReservationCanonicalService.createReservation({
          workspaceId,
          slotId,
          customerId: `cust_concurrent_${idx}`,
          customerName: `동시예약자_${idx}`,
          serviceId: 'srv_lash_lift',
          serviceName: '속눈썹 펌',
          totalAmountKrw: 50000,
          depositKrw: 20000,
        })
      );

      const settled = await Promise.allSettled(promises);

      const fulfilled = settled.filter(s => s.status === 'fulfilled');
      const rejected = settled.filter(s => s.status === 'rejected');

      // Invariant: Exactly 1 succeeds, all other 9 are rejected with SLOT_ALREADY_RESERVED
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(9);

      // Check error code on all rejected promises
      for (const rej of rejected) {
        if (rej.status === 'rejected') {
          const err = rej.reason as ReservationError;
          expect(err.message).toMatch(/SLOT_ALREADY_RESERVED|이미 예약/);
          expect(err.code).toBe('SLOT_ALREADY_RESERVED');
        }
      }

      // Check DB: Exactly 1 row for this slot in reservations table
      const confirmedRows = mockDbTables.reservations.filter(
        r => r.slot_id === slotId && r.status === 'CONFIRMED'
      );
      expect(confirmedRows.length).toBe(1);
    });

    it('should cancel reservation and successfully release the slot lock for re-booking', async () => {
      // 1. First booking
      const firstRes = await ReservationCanonicalService.createReservation({
        workspaceId,
        slotId,
        customerId: 'cust_original',
        customerName: '홍길동',
        serviceId: 'srv_lash_lift',
        serviceName: '속눈썹 펌',
        totalAmountKrw: 50000,
        depositKrw: 20000,
      });

      expect(firstRes.status).toBe('CONFIRMED');

      // Attempting to book again before cancel should fail
      await expect(
        ReservationCanonicalService.createReservation({
          workspaceId,
          slotId,
          customerId: 'cust_another',
          customerName: '이순신',
          serviceId: 'srv_lash_lift',
          serviceName: '속눈썹 펌',
          totalAmountKrw: 50000,
          depositKrw: 20000,
        })
      ).rejects.toThrow(/SLOT_ALREADY_RESERVED/);

      // 2. Cancel reservation
      const cancelRes = await ReservationCanonicalService.cancelReservation(
        firstRes.bookingId,
        '고객 사정으로 취소'
      );

      expect(cancelRes.status).toBe('CANCELLED');
      expect(cancelRes.cancelReason).toBe('고객 사정으로 취소');
      expect(cancelRes.cancelledAt).toBeDefined();

      // Check DB status updated to CANCELLED
      const dbRow = mockDbTables.reservations.find(r => r.id === firstRes.bookingId);
      expect(dbRow.status).toBe('CANCELLED');

      // 3. Re-booking the freed slot should now succeed!
      const secondRes = await ReservationCanonicalService.createReservation({
        workspaceId,
        slotId,
        customerId: 'cust_another',
        customerName: '이순신',
        serviceId: 'srv_lash_lift',
        serviceName: '속눈썹 펌',
        totalAmountKrw: 50000,
        depositKrw: 20000,
      });

      expect(secondRes.bookingId).not.toBe(firstRes.bookingId);
      expect(secondRes.status).toBe('CONFIRMED');
      expect(secondRes.customerName).toBe('이순신');
    });

    it('should reject invalid reservation parameters fail-closed', async () => {
      await expect(
        ReservationCanonicalService.createReservation({
          workspaceId: '',
          slotId: '',
          customerId: '',
        })
      ).rejects.toThrow(/INVALID_RESERVATION_PARAMS/);
    });

    it('should reject cancellation for non-existent booking fail-closed', async () => {
      await expect(
        ReservationCanonicalService.cancelReservation('bk_non_existent_999')
      ).rejects.toThrow(/RESERVATION_NOT_FOUND/);
    });
  });
});
