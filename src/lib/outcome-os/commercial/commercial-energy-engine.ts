import type { AgentEnergyLedger, AgentEnergyPlanTier } from '@/types/autonomous-outcome-os';

export type PlanTier = AgentEnergyPlanTier;

export const COMMERCIAL_TIERS: Record<AgentEnergyPlanTier, { priceKrw: number; monthlyEnergy: number }> = {
  FREE_TASTE: { priceKrw: 0, monthlyEnergy: 50 },
  TIER_150K_STARTER: { priceKrw: 150000, monthlyEnergy: 1500 },
  TIER_300K_GROWTH: { priceKrw: 300000, monthlyEnergy: 3000 },
  TIER_500K_PRO_SCALE: { priceKrw: 500000, monthlyEnergy: 5000 },
};

export class CommercialEnergyEngine {
  private ledgers = new Map<string, AgentEnergyLedger>();
  private processedTransactions = new Set<string>();

  static createSubscription(params: { workspaceId: string; tier: AgentEnergyPlanTier }) {
    const tierInfo = COMMERCIAL_TIERS[params.tier];
    return {
      workspaceId: params.workspaceId,
      tier: params.tier,
      monthlyTotalEnergy: tierInfo.monthlyEnergy,
      priceKrw: tierInfo.priceKrw,
      subscribedAt: new Date().toISOString(),
    };
  }

  initLedger(workspaceId: string, tier: AgentEnergyPlanTier): AgentEnergyLedger {
    const tierInfo = COMMERCIAL_TIERS[tier];
    const ledger: AgentEnergyLedger = {
      workspaceId,
      planTier: tier,
      monthlyTotalEnergy: tierInfo.monthlyEnergy,
      usedEnergyCurrentMonth: 0,
      reservedEnergyActiveRuns: 0,
      remainingAvailableEnergy: tierInfo.monthlyEnergy,
      burnRatePercentage: 0,
      budgetAlertStage: 'NORMAL',
      forecastRunOutDays: 30,
      updatedAt: new Date().toISOString(),
    };
    this.ledgers.set(workspaceId, ledger);
    return ledger;
  }

  getLedger(workspaceId: string): AgentEnergyLedger | undefined {
    return this.ledgers.get(workspaceId);
  }

  processTopUp(params: {
    workspaceId: string;
    transactionId: string;
    packCount: number;
    paidAmountKrw: number;
  }): { success: boolean; addedEnergy: number; ledger: AgentEnergyLedger; message?: string } {
    const ledger = this.ledgers.get(params.workspaceId);
    if (!ledger) {
      throw new Error(`Ledger not found for workspace: ${params.workspaceId}`);
    }

    if (this.processedTransactions.has(params.transactionId)) {
      return {
        success: false,
        addedEnergy: 0,
        ledger,
        message: `Duplicate transaction rejected: ${params.transactionId}`,
      };
    }

    const addedEnergy = params.packCount * 1000;
    ledger.monthlyTotalEnergy += addedEnergy;
    ledger.remainingAvailableEnergy += addedEnergy;
    ledger.updatedAt = new Date().toISOString();

    this.processedTransactions.add(params.transactionId);

    return {
      success: true,
      addedEnergy,
      ledger,
    };
  }
}
