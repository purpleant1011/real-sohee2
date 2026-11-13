import { describe, it, expect, vi } from 'vitest';
import { UniversalCostMeteringEngine } from '../universal-cost-metering-engine';
import { WeeklyCreditCycleEngine } from '../weekly-credit-cycle-engine';
import {
  createEnergyLedger,
  reserveCreditsAtomic,
  settleCreditsAtomic,
  MemoryCreditReservationStore,
} from '../../runtime/agent-energy-ledger-engine';
import type { ResetPassRecord } from '@/types/autonomous-outcome-os';

describe('ANI-759 & ANI-779 Universal Cost Metering & Weekly Credit Economy', () => {
  describe('UniversalCostMeteringEngine (ANI-759)', () => {
    const metering = new UniversalCostMeteringEngine();

    it('accurately meters token and media usage to normalized KRW and credits', () => {
      const snapshot = metering.meterUsage({
        workspaceId: 'ws_001',
        runId: 'run_001',
        actionId: 'act_001',
        capabilityId: 'cap_gemini_content',
        provider: 'google',
        modelId: 'gemini-3.8-flash',
        inputTokens: 10_000, // 0.0015 USD
        outputTokens: 2_000,  // 0.0012 USD
        imageUnits: 2,        // 0.0040 USD
        browserDurationMs: 0,
      });

      expect(snapshot.rawProviderCostUsd).toBeGreaterThan(0.006);
      expect(snapshot.normalizedInternalCogsKrw).toBeGreaterThan(5);
      expect(snapshot.chargedCredits).toBeGreaterThanOrEqual(1);
    });

    it('correctly includes browser runtime duration into chargeable credits', () => {
      const snapshot = metering.meterUsage({
        workspaceId: 'ws_001',
        runId: 'run_001',
        actionId: 'act_browser',
        capabilityId: 'cap_naver_blog',
        provider: 'sohee-substrate',
        modelId: 'sohee-browser-worker',
        browserDurationMs: 120_000, // 2 minutes = 0.03 USD
      });

      expect(snapshot.browserDurationMs).toBe(120_000);
      expect(snapshot.rawProviderCostUsd).toBeGreaterThanOrEqual(0.035); // fixed fee + 2 min
      expect(snapshot.chargedCredits).toBeGreaterThanOrEqual(4);
    });

    it('calculates preflight reservation estimate with 15% safety buffer', () => {
      const estimate = metering.estimateReservationCredits({
        modelId: 'gemini-3.8-flash',
        estimatedInputTokens: 50_000,
        estimatedOutputTokens: 10_000,
      });
      expect(estimate).toBeGreaterThan(0);
    });
  });

  describe('WeeklyCreditCycleEngine (ANI-779)', () => {
    const cycleEngine = new WeeklyCreditCycleEngine();

    it('initializes a 7-day weekly cycle with exact nextResetAt and base allowance', () => {
      const now = new Date('2026-09-05T00:00:00Z').toISOString();
      const { cycle, baseGrant } = cycleEngine.startNewWeeklyCycle({
        workspaceId: 'ws_starter',
        entitlementId: 'ent_starter',
        planTier: 'TIER_150K_STARTER',
        cycleStartAt: now,
      });

      expect(cycle.weeklyAllowanceCredits).toBe(1500);
      expect(cycle.remainingBaseCredits).toBe(1500);
      expect(cycle.totalAvailableCredits).toBe(1500);
      expect(cycle.nextResetAt).toBe('2026-09-12T00:00:00.000Z');
      expect(baseGrant.expiresAt).toBe('2026-09-12T00:00:00.000Z');
    });

    it('preserves unexpired bonus credits across cycle advancement', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-08T00:00:00.000Z'));
      try {
        const existingBonus = [
          {
            grantId: 'bns_001',
            workspaceId: 'ws_001',
            grantType: 'ADMIN_BONUS' as const,
            initialCredits: 500,
            remainingCredits: 350,
            grantedAt: '2026-09-01T00:00:00Z',
            expiresAt: '2026-10-01T00:00:00Z',
            isExpired: false,
          },
        ];

        const { cycle } = cycleEngine.startNewWeeklyCycle({
          workspaceId: 'ws_001',
          entitlementId: 'ent_001',
          planTier: 'TIER_300K_GROWTH',
          existingBonusGrants: existingBonus,
        });

        expect(cycle.bonusRemainingCredits).toBe(350);
        expect(cycle.totalAvailableCredits).toBe(3500 + 350);

        vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
        const { cycle: expiredCycle } = cycleEngine.startNewWeeklyCycle({
          workspaceId: 'ws_001',
          entitlementId: 'ent_001',
          planTier: 'TIER_300K_GROWTH',
          existingBonusGrants: existingBonus,
        });
        expect(expiredCycle.bonusRemainingCredits).toBe(0);
        expect(expiredCycle.totalAvailableCredits).toBe(3500);
      } finally {
        vi.useRealTimers();
      }
    });

    it('redeems RESET_PASS and refills base bucket up to allowance with strictly 0 overfill', () => {
      const { cycle } = cycleEngine.startNewWeeklyCycle({
        workspaceId: 'ws_refill',
        entitlementId: 'ent_refill',
        planTier: 'TIER_150K_STARTER', // allowance 1500
      });

      // Simulate spending 1000 credits
      cycle.remainingBaseCredits = 500;
      cycle.totalAvailableCredits = 500;

      const pass: ResetPassRecord = {
        passId: 'pass_vip_999',
        workspaceId: 'ws_refill',
        passCode: 'RESET-VIP-2026',
        maxRefillCeilingCredits: 1500,
        actualRefilledCredits: 0,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        status: 'AVAILABLE',
      };

      const result = cycleEngine.redeemResetPass({
        pass,
        cycle,
        userId: 'usr_owner_1',
      });

      expect(result.success).toBe(true);
      expect(result.refilledAmount).toBe(1000); // 1500 - 500
      expect(result.updatedCycle.remainingBaseCredits).toBe(1500); // exactly allowance
      expect(result.updatedPass.status).toBe('REDEEMED');

      // Duplicate redemption attempt must fail
      const secondAttempt = cycleEngine.redeemResetPass({
        pass: result.updatedPass,
        cycle: result.updatedCycle,
        userId: 'usr_owner_1',
      });
      expect(secondAttempt.success).toBe(false);
      expect(secondAttempt.reason).toContain('REDEEMED');
    });

    it('deducts credits according to earliest expires_at first', () => {
      const grants = [
        {
          grantId: 'grant_weekly_base',
          workspaceId: 'ws_01',
          grantType: 'WEEKLY_BASE' as const,
          initialCredits: 1500,
          remainingCredits: 1500,
          grantedAt: new Date(Date.now() - 86400000).toISOString(),
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), // Expires in 7 days
          isExpired: false,
        },
        {
          grantId: 'grant_promo_urgent',
          workspaceId: 'ws_01',
          grantType: 'PROMOTION' as const,
          initialCredits: 200,
          remainingCredits: 200,
          grantedAt: new Date(Date.now() - 86400000).toISOString(),
          expiresAt: new Date(Date.now() + 2 * 86400000).toISOString(), // Expires in 2 days (Earlier!)
          isExpired: false,
        },
      ];

      // Deduct 300 credits: 200 from promo, 100 from weekly base
      const deduction = cycleEngine.deductCredits({
        grants,
        amountToDeduct: 300,
      });

      expect(deduction.deductedTotal).toBe(300);
      expect(deduction.shortfall).toBe(0);

      const promoGrant = deduction.updatedGrants.find((g) => g.grantId === 'grant_promo_urgent');
      const baseGrant = deduction.updatedGrants.find((g) => g.grantId === 'grant_weekly_base');

      expect(promoGrant?.remainingCredits).toBe(0); // Spent first!
      expect(baseGrant?.remainingCredits).toBe(1400); // 1500 - 100
    });
  });

  describe('Atomic Reservation & Settle Concurrency (ANI-759)', () => {
    it('prevents race condition and negative balance under concurrent reservations', async () => {
      const store = new MemoryCreditReservationStore();
      const ledger = createEnergyLedger('ws_concurrent', 'FREE_TASTE'); // 50 credits total

      // Attempt 20 concurrent reservations of 10 credits each (total 200 requested, only 50 available)
      const tasks = Array.from({ length: 20 }).map((_, i) =>
        reserveCreditsAtomic({
          ledger,
          amount: 10,
          runId: `run_${i}`,
          actionId: `act_${i}`,
          store,
        })
      );

      const results = await Promise.all(tasks);
      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      expect(successful.length).toBe(5); // 5 * 10 = 50
      expect(failed.length).toBe(15);
      expect(ledger.remainingAvailableEnergy).toBe(0);
      expect(ledger.remainingAvailableEnergy).toBeGreaterThanOrEqual(0); // Never negative!
    });

    it('blocks duplicate settle of the same reservation ID', async () => {
      const store = new MemoryCreditReservationStore();
      const ledger = createEnergyLedger('ws_dup', 'TIER_150K_STARTER');

      const resv = await reserveCreditsAtomic({
        ledger,
        amount: 50,
        runId: 'run_1',
        actionId: 'act_1',
        store,
      });

      expect(resv.success).toBe(true);

      // First settle: actual spent 40 (10 released)
      const firstSettle = await settleCreditsAtomic({
        ledger,
        reservationId: resv.reservationId,
        actualSpent: 40,
        store,
      });
      expect(firstSettle.success).toBe(true);
      expect(firstSettle.releasedUnused).toBe(10);
      expect(ledger.usedEnergyCurrentMonth).toBe(40);

      // Second settle: must be blocked
      const secondSettle = await settleCreditsAtomic({
        ledger,
        reservationId: resv.reservationId,
        actualSpent: 40,
        store,
      });
      expect(secondSettle.success).toBe(false);
      expect(secondSettle.reason).toContain('Duplicate settlement blocked');
      expect(ledger.usedEnergyCurrentMonth).toBe(40); // No double deduction!
    });
  });
});
