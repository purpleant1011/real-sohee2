import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntegratedFinOpsEngine, InsufficientCreditsError } from '@/lib/finops/integrated-finops-engine';
import { PersistenceError } from '@/lib/errors/persistence-error';

// In-Memory mock database tables matching Supabase tables
type MockRow = Record<string, any>;

const mockDbTables = {
  ai_credit_ledgers: new Map<string, MockRow>(), // workspace_id -> row
  external_ad_spend_ledgers: new Map<string, MockRow>(), // spend_ledger_id -> row
  finops_reservations: new Map<string, MockRow>(), // reservation_id -> row
  finops_settlements: new Map<string, MockRow>(), // settlement_id -> row
};

let mockShouldFailDb = false;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => {
    if (mockShouldFailDb) {
      throw new Error('Supabase DB connection refused / timeout');
    }

    return {
      from: (tableName: string) => {
        if (tableName === 'ai_credit_ledgers') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((col: string, val: any) => ({
                maybeSingle: vi.fn(async () => {
                  if (mockShouldFailDb) return { data: null, error: { message: 'DB read error' } };
                  const row = mockDbTables.ai_credit_ledgers.get(val);
                  return { data: row ? { ...row } : null, error: null };
                }),
                single: vi.fn(async () => {
                  if (mockShouldFailDb) return { data: null, error: { message: 'DB read error' } };
                  const row = mockDbTables.ai_credit_ledgers.get(val);
                  if (!row) return { data: null, error: { message: 'Not found' } };
                  return { data: { ...row }, error: null };
                }),
              })),
            })),
            upsert: vi.fn(async (row: MockRow) => {
              if (mockShouldFailDb) return { error: { message: 'DB upsert failure' } };
              mockDbTables.ai_credit_ledgers.set(row.workspace_id, { ...row });
              return { error: null };
            }),
            update: vi.fn((patch: MockRow) => ({
              eq: vi.fn(async (col: string, val: any) => {
                if (mockShouldFailDb) return { error: { message: 'DB update failure' } };
                const existing = mockDbTables.ai_credit_ledgers.get(val) || {};
                mockDbTables.ai_credit_ledgers.set(val, { ...existing, ...patch });
                return { error: null };
              }),
            })),
          };
        }

        if (tableName === 'finops_reservations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((col: string, val: any) => ({
                maybeSingle: vi.fn(async () => {
                  if (mockShouldFailDb) return { data: null, error: { message: 'DB read error' } };
                  const row = mockDbTables.finops_reservations.get(val);
                  return { data: row ? { ...row } : null, error: null };
                }),
                single: vi.fn(async () => {
                  if (mockShouldFailDb) return { data: null, error: { message: 'DB read error' } };
                  const row = mockDbTables.finops_reservations.get(val);
                  if (!row) return { data: null, error: { message: 'Not found' } };
                  return { data: { ...row }, error: null };
                }),
              })),
            })),
            insert: vi.fn(async (row: MockRow) => {
              if (mockShouldFailDb) return { error: { message: 'DB insert failure' } };
              mockDbTables.finops_reservations.set(row.reservation_id, { ...row });
              return { error: null };
            }),
            update: vi.fn((patch: MockRow) => ({
              eq: vi.fn(async (col: string, val: any) => {
                if (mockShouldFailDb) return { error: { message: 'DB update failure' } };
                const existing = mockDbTables.finops_reservations.get(val) || {};
                mockDbTables.finops_reservations.set(val, { ...existing, ...patch });
                return { error: null };
              }),
            })),
          };
        }

        if (tableName === 'finops_settlements') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((col: string, val: any) => ({
                maybeSingle: vi.fn(async () => {
                  if (mockShouldFailDb) return { data: null, error: { message: 'DB read error' } };
                  const row = mockDbTables.finops_settlements.get(val);
                  return { data: row ? { ...row } : null, error: null };
                }),
              })),
            })),
            insert: vi.fn(async (row: MockRow) => {
              if (mockShouldFailDb) return { error: { message: 'DB insert failure' } };
              mockDbTables.finops_settlements.set(row.settlement_id, { ...row });
              return { error: null };
            }),
          };
        }

        if (tableName === 'external_ad_spend_ledgers') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((col: string, val: any) => ({
                maybeSingle: vi.fn(async () => {
                  if (mockShouldFailDb) return { data: null, error: { message: 'DB read error' } };
                  const row = Array.from(mockDbTables.external_ad_spend_ledgers.values()).find(
                    (r) => r[col] === val
                  );
                  return { data: row ? { ...row } : null, error: null };
                }),
              })),
            })),
            upsert: vi.fn(async (row: MockRow) => {
              if (mockShouldFailDb) return { error: { message: 'DB upsert failure' } };
              const key = row.spend_ledger_id || `${row.workspace_id}_${row.channel}_${row.ad_account_id}`;
              mockDbTables.external_ad_spend_ledgers.set(key, { ...row, spend_ledger_id: key });
              return { error: null };
            }),
          };
        }

        return {};
      },
    };
  }),
}));

describe('Task 4.1: Durable FinOps Dual Ledger & Real Settlement (ANI-952, ANI-968, ANI-969)', () => {
  const TEST_WORKSPACE = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbTables.ai_credit_ledgers.clear();
    mockDbTables.external_ad_spend_ledgers.clear();
    mockDbTables.finops_reservations.clear();
    mockDbTables.finops_settlements.clear();
    mockShouldFailDb = false;
    IntegratedFinOpsEngine.clearMemoryCacheForTesting();
  });

  describe('1. Zero / Insufficient Credit Fail-Closed Gate', () => {
    it('strictly prohibits provider execution when available credit is 0, throwing INSUFFICIENT_CREDITS', async () => {
      // Workspace has 0 credit
      await expect(
        IntegratedFinOpsEngine.reserve(TEST_WORKSPACE, 'act_failclosed_01', 10)
      ).rejects.toThrow(/INSUFFICIENT_CREDITS/);

      // Verify no reservation created in DB
      expect(mockDbTables.finops_reservations.size).toBe(0);
    });

    it('strictly prohibits execution when available credit (balance - reserved) is less than required amount', async () => {
      // Grant 10 credits
      await IntegratedFinOpsEngine.grantCredits({
        workspaceId: TEST_WORKSPACE,
        amount: 10,
        reason: '초기 크레딧',
        idempotencyKey: 'idemp_grant_10',
      });

      // Reserve 10 credits -> available becomes 0
      const resv1 = await IntegratedFinOpsEngine.reserve(TEST_WORKSPACE, 'act_run_take_all', 10);
      expect(resv1.status).toBe('RESERVED');

      // Next reservation must fail closed with INSUFFICIENT_CREDITS
      await expect(
        IntegratedFinOpsEngine.reserve(TEST_WORKSPACE, 'act_run_blocked', 5)
      ).rejects.toThrow(/INSUFFICIENT_CREDITS/);

      // Only 1 reservation in DB
      expect(mockDbTables.finops_reservations.size).toBe(1);
    });
  });

  describe('2. Normal Lifecycle & Conservation Invariant (reserve -> settle)', () => {
    it('preserves initial_balance == current_balance + settled_total + reserved_total invariant across quote -> reserve -> settle', async () => {
      // Step 1: Initial grant of 100 credits
      await IntegratedFinOpsEngine.grantCredits({
        workspaceId: TEST_WORKSPACE,
        amount: 100,
        reason: '월간 크레딧 충전',
        idempotencyKey: 'idemp_initial_100',
      });

      let inv = await IntegratedFinOpsEngine.verifyConservationInvariant(TEST_WORKSPACE);
      expect(inv.isValid).toBe(true);
      expect(inv.initialBalance).toBe(100);
      expect(inv.currentBalance).toBe(100);
      expect(inv.settledTotal).toBe(0);
      expect(inv.reservedTotal).toBe(0);

      // Step 2: Reserve 25 credits
      const resv = await IntegratedFinOpsEngine.reserve(TEST_WORKSPACE, 'act_normal_publish', 25);
      expect(resv.status).toBe('RESERVED');
      expect(resv.amount).toBe(25);

      inv = await IntegratedFinOpsEngine.verifyConservationInvariant(TEST_WORKSPACE);
      expect(inv.isValid).toBe(true);
      expect(inv.initialBalance).toBe(100);
      expect(inv.currentBalance).toBe(75); // 100 - 25
      expect(inv.settledTotal).toBe(0);
      expect(inv.reservedTotal).toBe(25);

      // Step 3: Settle with actual cost 20 (releasing 5 unused credits back)
      const settlement = await IntegratedFinOpsEngine.settle(resv.reservationId, 20);
      expect(settlement.status).toBe('SETTLED');
      expect(settlement.actualCost).toBe(20);
      expect(settlement.releasedAmount).toBe(5);

      inv = await IntegratedFinOpsEngine.verifyConservationInvariant(TEST_WORKSPACE);
      expect(inv.isValid).toBe(true);
      expect(inv.initialBalance).toBe(100);
      expect(inv.currentBalance).toBe(80); // 75 + 5 released back
      expect(inv.settledTotal).toBe(20);
      expect(inv.reservedTotal).toBe(0);

      // DB checks
      expect(mockDbTables.finops_reservations.get(resv.reservationId)?.status).toBe('SETTLED');
      expect(mockDbTables.finops_settlements.get(settlement.settlementId)?.actual_cost).toBe(20);
    });
  });

  describe('3. Failure Lifecycle & Full Release (reserve -> release)', () => {
    it('restores 100% of reserved credits and maintains conservation invariant on release', async () => {
      await IntegratedFinOpsEngine.grantCredits({
        workspaceId: TEST_WORKSPACE,
        amount: 50,
        reason: '테스트 충전',
        idempotencyKey: 'idemp_grant_50',
      });

      const resv = await IntegratedFinOpsEngine.reserve(TEST_WORKSPACE, 'act_fail_run', 30);
      expect(resv.status).toBe('RESERVED');

      let inv = await IntegratedFinOpsEngine.verifyConservationInvariant(TEST_WORKSPACE);
      expect(inv.isValid).toBe(true);
      expect(inv.currentBalance).toBe(20);
      expect(inv.reservedTotal).toBe(30);

      // Release reservation due to provider failure
      const releaseReceipt = await IntegratedFinOpsEngine.release(resv.reservationId, 'Provider timeout');
      expect(releaseReceipt.status).toBe('RELEASED');
      expect(releaseReceipt.releasedAmount).toBe(30);

      inv = await IntegratedFinOpsEngine.verifyConservationInvariant(TEST_WORKSPACE);
      expect(inv.isValid).toBe(true);
      expect(inv.currentBalance).toBe(50); // Fully restored
      expect(inv.settledTotal).toBe(0);
      expect(inv.reservedTotal).toBe(0);

      // DB check
      expect(mockDbTables.finops_reservations.get(resv.reservationId)?.status).toBe('RELEASED');
    });
  });

  describe('4. External Ad Spend Ledger Segregation (Dual Ledger)', () => {
    it('records external ad spend in KRW without mutating internal AI credit balances', async () => {
      await IntegratedFinOpsEngine.grantCredits({
        workspaceId: TEST_WORKSPACE,
        amount: 80,
        reason: 'AI 크레딧',
        idempotencyKey: 'idemp_grant_80',
      });

      // Record external ad spend
      const adSpend = await IntegratedFinOpsEngine.recordAdSpend(TEST_WORKSPACE, 45000, {
        adAccountId: 'act_meta_888',
        channel: 'META_ADS',
        budgetLimitKrw: 100000,
      });

      expect(adSpend.spent_krw).toBe(45000);
      expect(adSpend.channel).toBe('META_ADS');
      expect(adSpend.budget_limit_krw).toBe(100000);

      // Verify AI credit balance is completely untouched
      const creditLedger = await IntegratedFinOpsEngine.getAiCreditLedger(TEST_WORKSPACE);
      expect(creditLedger.balance).toBe(80);
      expect(creditLedger.reserved).toBe(0);

      // Record additional ad spend
      const adSpend2 = await IntegratedFinOpsEngine.recordAdSpend(TEST_WORKSPACE, 25000, {
        adAccountId: 'act_meta_888',
        channel: 'META_ADS',
      });

      expect(adSpend2.spent_krw).toBe(70000); // 45000 + 25000
    });
  });

  describe('5. Durable Persistence Across Process / Worker Restart (Memory Reset)', () => {
    it('restores state from Supabase DB tables after memory cache is completely wiped', async () => {
      // Step 1: Initial grant and reserve
      await IntegratedFinOpsEngine.grantCredits({
        workspaceId: TEST_WORKSPACE,
        amount: 200,
        reason: '영속화 테스트',
        idempotencyKey: 'idemp_persist_200',
      });

      const resv = await IntegratedFinOpsEngine.reserve(TEST_WORKSPACE, 'act_durable_run', 50);
      expect(resv.status).toBe('RESERVED');

      // Verify data is stored in mock DB tables
      expect(mockDbTables.ai_credit_ledgers.has(TEST_WORKSPACE)).toBe(true);
      expect(mockDbTables.finops_reservations.has(resv.reservationId)).toBe(true);

      // Step 2: Simulate process crash / worker reboot -> wipe all in-memory state
      IntegratedFinOpsEngine.clearMemoryCacheForTesting();

      // Step 3: Now fetch ledger after reboot -> must restore accurately from DB
      const restoredLedger = await IntegratedFinOpsEngine.getAiCreditLedger(TEST_WORKSPACE);
      expect(restoredLedger.balance).toBe(200);
      expect(restoredLedger.reserved).toBe(50);
      expect(restoredLedger.availableCredit).toBe(150);

      // Step 4: Settle the restored reservation without prior in-memory cache
      const settlement = await IntegratedFinOpsEngine.settle(resv.reservationId, 40);
      expect(settlement.status).toBe('SETTLED');
      expect(settlement.actualCost).toBe(40);
      expect(settlement.releasedAmount).toBe(10);

      // Step 5: Verify conservation invariant on restored state
      const inv = await IntegratedFinOpsEngine.verifyConservationInvariant(TEST_WORKSPACE);
      expect(inv.isValid).toBe(true);
      expect(inv.initialBalance).toBe(200);
      expect(inv.currentBalance).toBe(160); // 150 + 10
      expect(inv.settledTotal).toBe(40);
      expect(inv.reservedTotal).toBe(0);
    });
  });

  describe('6. Fail-Closed Semantics on Database Failure', () => {
    it('throws PersistenceError and does not alter memory state when DB write fails during reserve', async () => {
      await IntegratedFinOpsEngine.grantCredits({
        workspaceId: TEST_WORKSPACE,
        amount: 50,
        reason: '정상 충전',
        idempotencyKey: 'idemp_fail_db_prep',
      });

      // Simulate database failure
      mockShouldFailDb = true;

      await expect(
        IntegratedFinOpsEngine.reserve(TEST_WORKSPACE, 'act_fail_db_run', 20)
      ).rejects.toThrow(PersistenceError);

      // DB recover
      mockShouldFailDb = false;

      // Ensure balance and reserved were not corrupted
      const ledger = await IntegratedFinOpsEngine.getAiCreditLedger(TEST_WORKSPACE);
      expect(ledger.balance).toBe(50);
      expect(ledger.reserved).toBe(0);
      expect(ledger.availableCredit).toBe(50);
    });
  });
});
