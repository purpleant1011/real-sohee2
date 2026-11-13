import type {
  AgentEnergyPlanTier,
  WeeklyCreditCycle,
  CreditGrantType,
  ResetPassRecord,
} from '@/types/autonomous-outcome-os';

export interface CreditBucketGrant {
  grantId: string;
  workspaceId: string;
  grantType: CreditGrantType;
  initialCredits: number;
  remainingCredits: number;
  grantedAt: string;
  expiresAt: string;
  isExpired: boolean;
}

export const PLAN_WEEKLY_ALLOWANCES: Record<AgentEnergyPlanTier, number> = {
  FREE_TASTE: 50, // One-time, no weekly reset
  TIER_150K_STARTER: 1500,
  TIER_300K_GROWTH: 3500,
  TIER_500K_PRO_SCALE: 6500,
};

export class WeeklyCreditCycleEngine {
  /**
   * Initializes or advances a 7-day weekly credit cycle (ANI-779)
   * Invariant: Exactly-once grant per cycle; unused weekly base credit expires at cycle boundary.
   */
  startNewWeeklyCycle(params: {
    workspaceId: string;
    entitlementId: string;
    planTier: AgentEnergyPlanTier;
    cycleStartAt?: string;
    existingBonusGrants?: CreditBucketGrant[];
  }): {
    cycle: WeeklyCreditCycle;
    baseGrant: CreditBucketGrant;
  } {
    const { workspaceId, entitlementId, planTier, existingBonusGrants = [] } = params;
    const startMs = params.cycleStartAt ? new Date(params.cycleStartAt).getTime() : Date.now();
    const cycleStartAt = new Date(startMs).toISOString();
    const nextResetAt = new Date(startMs + 7 * 86400000).toISOString();

    const allowance = PLAN_WEEKLY_ALLOWANCES[planTier] || 1500;
    const cycleId = `cycle_${workspaceId}_${Math.floor(startMs / 1000)}`;

    const baseGrantId = `grant_base_${cycleId}`;
    const baseGrant: CreditBucketGrant = {
      grantId: baseGrantId,
      workspaceId,
      grantType: 'WEEKLY_BASE',
      initialCredits: allowance,
      remainingCredits: allowance,
      grantedAt: cycleStartAt,
      expiresAt: nextResetAt,
      isExpired: false,
    };

    // Calculate active bonus credits (only unexpired ones)
    const activeBonusCredits = existingBonusGrants
      .filter((g) => !g.isExpired && new Date(g.expiresAt).getTime() > Date.now())
      .reduce((sum, g) => sum + g.remainingCredits, 0);

    const cycle: WeeklyCreditCycle = {
      cycleId,
      workspaceId,
      entitlementId,
      planTier,
      cycleStartAt,
      nextResetAt,
      weeklyAllowanceCredits: allowance,
      usedBaseCredits: 0,
      usedBonusCredits: 0,
      reservedCredits: 0,
      remainingBaseCredits: allowance,
      bonusRemainingCredits: activeBonusCredits,
      totalAvailableCredits: allowance + activeBonusCredits,
      cycleStatus: 'ACTIVE',
    };

    return { cycle, baseGrant };
  }

  /**
   * Redeems a RESET_PASS (ANI-779)
   * Refills the current weekly base bucket up to the plan allowance.
   * Invariant: Overfill is strictly 0. Cannot exceed plan allowance. Single-use only.
   */
  redeemResetPass(params: {
    pass: ResetPassRecord;
    cycle: WeeklyCreditCycle;
    userId: string;
  }): {
    success: boolean;
    refilledAmount: number;
    updatedPass: ResetPassRecord;
    updatedCycle: WeeklyCreditCycle;
    reason?: string;
  } {
    const { pass, cycle, userId } = params;

    // 1. Pass status & expiry check
    if (pass.status !== 'AVAILABLE') {
      return {
        success: false,
        refilledAmount: 0,
        updatedPass: pass,
        updatedCycle: cycle,
        reason: `RESET_PASS [${pass.passId}] is already ${pass.status}.`,
      };
    }

    if (new Date(pass.expiresAt).getTime() <= Date.now()) {
      const expiredPass: ResetPassRecord = { ...pass, status: 'EXPIRED' };
      return {
        success: false,
        refilledAmount: 0,
        updatedPass: expiredPass,
        updatedCycle: cycle,
        reason: `RESET_PASS [${pass.passId}] has expired.`,
      };
    }

    // 2. Calculate refill delta (Allowance - RemainingBase)
    const currentBase = cycle.remainingBaseCredits;
    const allowance = cycle.weeklyAllowanceCredits;
    const refillDelta = Math.max(0, allowance - currentBase);

    if (refillDelta === 0) {
      return {
        success: false,
        refilledAmount: 0,
        updatedPass: pass,
        updatedCycle: cycle,
        reason: 'Weekly credit base is already full. Refill unnecessary (overfill prohibited).',
      };
    }

    // 3. Apply refill (Overfill strictly zero)
    const updatedCycle: WeeklyCreditCycle = {
      ...cycle,
      remainingBaseCredits: allowance,
      totalAvailableCredits: allowance + cycle.bonusRemainingCredits - cycle.reservedCredits,
    };

    const updatedPass: ResetPassRecord = {
      ...pass,
      actualRefilledCredits: refillDelta,
      redeemedAt: new Date().toISOString(),
      redeemedByUserId: userId,
      status: 'REDEEMED',
    };

    return {
      success: true,
      refilledAmount: refillDelta,
      updatedPass,
      updatedCycle,
    };
  }

  /**
   * Spend Credits according to Authoritative Rule: earliest expires_at first (ANI-779)
   */
  deductCredits(params: {
    grants: CreditBucketGrant[];
    amountToDeduct: number;
  }): {
    deductedTotal: number;
    updatedGrants: CreditBucketGrant[];
    shortfall: number;
  } {
    const { grants, amountToDeduct } = params;

    // Filter active grants and sort by earliest expires_at first
    const activeGrants = grants
      .filter((g) => !g.isExpired && new Date(g.expiresAt).getTime() > Date.now() && g.remainingCredits > 0)
      .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());

    let remainingNeeded = amountToDeduct;
    const updatedGrants = grants.map((g) => ({ ...g }));

    for (const grant of activeGrants) {
      if (remainingNeeded <= 0) break;

      const target = updatedGrants.find((g) => g.grantId === grant.grantId);
      if (!target) continue;

      const deduction = Math.min(target.remainingCredits, remainingNeeded);
      target.remainingCredits -= deduction;
      remainingNeeded -= deduction;
    }

    return {
      deductedTotal: amountToDeduct - remainingNeeded,
      updatedGrants,
      shortfall: remainingNeeded,
    };
  }
}
