/**
 * Admin Credit Operations Center (ANI-794)
 * 
 * Fleet-wide oversight for Weekly Cycles, Bonus allocations,
 * and RESET_PASS issuance with zero overfill invariants.
 * 
 * Invariants:
 * 1. All manual adjustments must be immutable append-only records (no in-place mutations).
 * 2. RESET_PASS refills strictly up to weekly allowance (Overfill 0).
 * 3. Abnormal credit burn (> threshold in window) triggers administrative alerts.
 */

import {
  WeeklyCreditCycleEngine,
  CreditBucketGrant
} from '../../outcome-os/commercial/weekly-credit-cycle-engine';
import {
  WeeklyCreditCycle,
  AgentEnergyPlanTier,
  ResetPassRecord
} from '@/types/autonomous-outcome-os';

export interface ManualCreditAdjustmentRecord {
  adjustmentId: string;
  workspaceId: string;
  adminActorId: string;
  amountCredits: number;
  reason: string;
  timestamp: string;
  appliedCycleSnapshot: WeeklyCreditCycle;
}

export interface AbnormalBurnAlert {
  workspaceId: string;
  burnedInWindow: number;
  threshold: number;
  detectedAt: string;
  severity: 'WARNING' | 'CRITICAL';
}

export class AdminCreditOperationsCenter {
  private cycles = new Map<string, WeeklyCreditCycle>();
  private grants = new Map<string, CreditBucketGrant[]>();
  private adjustments: ManualCreditAdjustmentRecord[] = [];
  private burnAlerts: AbnormalBurnAlert[] = [];

  constructor(private readonly creditEngine: WeeklyCreditCycleEngine) {}

  public initWorkspaceCycle(
    workspaceId: string,
    entitlementId: string,
    planTier: AgentEnergyPlanTier
  ): WeeklyCreditCycle {
    const { cycle, baseGrant } = this.creditEngine.startNewWeeklyCycle({
      workspaceId,
      entitlementId,
      planTier,
    });

    this.cycles.set(workspaceId, cycle);
    this.grants.set(workspaceId, [baseGrant]);
    return cycle;
  }

  public getWorkspaceCycle(workspaceId: string): WeeklyCreditCycle | undefined {
    return this.cycles.get(workspaceId);
  }

  public getWorkspaceGrants(workspaceId: string): readonly CreditBucketGrant[] {
    return this.grants.get(workspaceId) ?? [];
  }

  /**
   * Performs an immutable manual bonus adjustment.
   */
  public grantBonusCredits(
    workspaceId: string,
    amountCredits: number,
    expiresAtDays: number,
    reason: string,
    adminActorId: string
  ): ManualCreditAdjustmentRecord {
    if (amountCredits <= 0) {
      throw new Error('Bonus grant amount must be positive');
    }
    if (!reason || reason.trim().length === 0) {
      throw new Error('Reason is mandatory for manual credit adjustments');
    }

    const cycle = this.cycles.get(workspaceId);
    if (!cycle) {
      throw new Error(`Workspace ${workspaceId} has no active credit cycle`);
    }

    const currentGrants = this.grants.get(workspaceId) ?? [];
    const bonusGrant: CreditBucketGrant = {
      grantId: `grant_bonus_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      workspaceId,
      grantType: 'ADMIN_BONUS',
      initialCredits: amountCredits,
      remainingCredits: amountCredits,
      grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiresAtDays * 86400000).toISOString(),
      isExpired: false,
    };

    currentGrants.push(bonusGrant);
    this.grants.set(workspaceId, currentGrants);

    cycle.bonusRemainingCredits += amountCredits;
    cycle.totalAvailableCredits += amountCredits;

    const record: ManualCreditAdjustmentRecord = {
      adjustmentId: `adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      workspaceId,
      adminActorId,
      amountCredits,
      reason,
      timestamp: new Date().toISOString(),
      appliedCycleSnapshot: { ...cycle },
    };

    this.adjustments.push(record);
    return record;
  }

  /**
   * Deducts credits using FIFO order (earliest expiry first).
   */
  public deductCredits(workspaceId: string, amount: number): { success: boolean; shortfall: number } {
    const cycle = this.cycles.get(workspaceId);
    const grants = this.grants.get(workspaceId);
    if (!cycle || !grants) {
      return { success: false, shortfall: amount };
    }

    const result = this.creditEngine.deductCredits({
      grants,
      amountToDeduct: amount,
    });

    this.grants.set(workspaceId, result.updatedGrants);

    // Sync cycle remaining
    const remainingBase = result.updatedGrants
      .filter(g => g.grantType === 'WEEKLY_BASE' && !g.isExpired)
      .reduce((sum, g) => sum + g.remainingCredits, 0);

    const remainingBonus = result.updatedGrants
      .filter(g => g.grantType !== 'WEEKLY_BASE' && !g.isExpired)
      .reduce((sum, g) => sum + g.remainingCredits, 0);

    cycle.remainingBaseCredits = remainingBase;
    cycle.bonusRemainingCredits = remainingBonus;
    cycle.totalAvailableCredits = remainingBase + remainingBonus - cycle.reservedCredits;

    return {
      success: result.shortfall === 0,
      shortfall: result.shortfall,
    };
  }

  /**
   * Applies RESET_PASS with strict Overfill 0 enforcement.
   */
  public applyResetPass(
    workspaceId: string,
    passId: string,
    adminActorId: string,
    reason: string
  ): WeeklyCreditCycle {
    const cycle = this.cycles.get(workspaceId);
    if (!cycle) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    const pass: ResetPassRecord = {
      passId,
      workspaceId,
      passCode: `PASS-${passId}`,
      maxRefillCeilingCredits: cycle.weeklyAllowanceCredits,
      actualRefilledCredits: 0,
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      status: 'AVAILABLE',
    };

    const refillRes = this.creditEngine.redeemResetPass({
      pass,
      cycle,
      userId: adminActorId,
    });

    if (!refillRes.success) {
      throw new Error(`Reset pass failed: ${refillRes.reason}`);
    }

    // Invariant: Base credits cannot exceed weekly allowance
    if (refillRes.updatedCycle.remainingBaseCredits > refillRes.updatedCycle.weeklyAllowanceCredits) {
      throw new Error(
        `CRITICAL INVARIANT VIOLATION: Overfill detected! ${refillRes.updatedCycle.remainingBaseCredits} > ${refillRes.updatedCycle.weeklyAllowanceCredits}`
      );
    }

    this.cycles.set(workspaceId, refillRes.updatedCycle);

    // Update the base grant remaining credits
    const grants = this.grants.get(workspaceId) ?? [];
    for (const g of grants) {
      if (g.grantType === 'WEEKLY_BASE') {
        g.remainingCredits = refillRes.updatedCycle.remainingBaseCredits;
      }
    }
    this.grants.set(workspaceId, grants);

    this.adjustments.push({
      adjustmentId: `adj-resetpass-${Date.now()}`,
      workspaceId,
      adminActorId,
      amountCredits: refillRes.refilledAmount,
      reason: `RESET_PASS applied: ${reason}`,
      timestamp: new Date().toISOString(),
      appliedCycleSnapshot: refillRes.updatedCycle,
    });

    return refillRes.updatedCycle;
  }

  /**
   * Scans workspace for abnormal burn rate.
   */
  public checkAbnormalBurn(
    workspaceId: string,
    burnedCreditsInWindow: number,
    threshold: number
  ): AbnormalBurnAlert | null {
    if (burnedCreditsInWindow > threshold) {
      const alert: AbnormalBurnAlert = {
        workspaceId,
        burnedInWindow: burnedCreditsInWindow,
        threshold,
        detectedAt: new Date().toISOString(),
        severity: burnedCreditsInWindow > threshold * 2 ? 'CRITICAL' : 'WARNING',
      };
      this.burnAlerts.push(alert);
      return alert;
    }
    return null;
  }

  public getAdjustments(): readonly ManualCreditAdjustmentRecord[] {
    return [...this.adjustments];
  }

  public getBurnAlerts(): readonly AbnormalBurnAlert[] {
    return [...this.burnAlerts];
  }

  public getFleetMetrics(): {
    totalWorkspaces: number;
    totalWeeklyAllowance: number;
    totalRemainingCredits: number;
    totalReservedCredits: number;
    totalSettledCredits: number;
    abnormalBurnAlertsCount: number;
  } {
    const allCycles = Array.from(this.cycles.values());
    const totalWeeklyAllowance = allCycles.reduce((sum, c) => sum + (c.weeklyAllowanceCredits || 0), 0);
    const totalRemainingCredits = allCycles.reduce((sum, c) => sum + (c.remainingBaseCredits || 0) + (c.bonusRemainingCredits || 0), 0);
    const totalReservedCredits = allCycles.reduce((sum, c) => sum + (c.reservedCredits || 0), 0);
    const totalSettledCredits = allCycles.reduce((sum, c) => sum + (c.usedBaseCredits || 0) + (c.usedBonusCredits || 0), 0);

    return {
      totalWorkspaces: allCycles.length,
      totalWeeklyAllowance,
      totalRemainingCredits,
      totalReservedCredits,
      totalSettledCredits,
      abnormalBurnAlertsCount: this.burnAlerts.length,
    };
  }
}
