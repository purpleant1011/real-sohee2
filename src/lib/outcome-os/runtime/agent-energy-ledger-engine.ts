import type {
  AgentEnergyLedger,
  AgentEnergyPlanTier,
} from '@/types/autonomous-outcome-os';

export interface DurableCreditReservation {
  reservationId: string;
  workspaceId: string;
  runId: string;
  actionId: string;
  amountCredits: number;
  status: 'PENDING' | 'SETTLED' | 'RELEASED';
  createdAt: string;
  settledAt?: string;
  actualSettledCredits?: number;
}

export interface CreditReservationStore {
  saveReservation(resv: DurableCreditReservation): Promise<void>;
  getReservation(reservationId: string): Promise<DurableCreditReservation | null>;
  updateReservation(resv: DurableCreditReservation): Promise<void>;
}

export class MemoryCreditReservationStore implements CreditReservationStore {
  private store = new Map<string, DurableCreditReservation>();

  async saveReservation(resv: DurableCreditReservation): Promise<void> {
    this.store.set(resv.reservationId, { ...resv });
  }

  async getReservation(reservationId: string): Promise<DurableCreditReservation | null> {
    const found = this.store.get(reservationId);
    return found ? { ...found } : null;
  }

  async updateReservation(resv: DurableCreditReservation): Promise<void> {
    this.store.set(resv.reservationId, { ...resv });
  }
}

let globalReservationStore: CreditReservationStore = new MemoryCreditReservationStore();

export function setCreditReservationStore(store: CreditReservationStore): void {
  globalReservationStore = store;
}

const PLAN_MONTHLY_ENERGIES: Record<AgentEnergyPlanTier, number> = {
  FREE_TASTE: 50,
  TIER_150K_STARTER: 1500,
  TIER_300K_GROWTH: 3000,
  TIER_500K_PRO_SCALE: 5000,
};

export function createEnergyLedger(
  workspaceId: string,
  planTier: AgentEnergyPlanTier
): AgentEnergyLedger {
  const total = PLAN_MONTHLY_ENERGIES[planTier] || 1500;
  return {
    workspaceId,
    planTier,
    monthlyTotalEnergy: total,
    usedEnergyCurrentMonth: 0,
    reservedEnergyActiveRuns: 0,
    remainingAvailableEnergy: total,
    burnRatePercentage: 0,
    budgetAlertStage: 'NORMAL',
    forecastRunOutDays: 30,
    updatedAt: new Date().toISOString(),
  };
}

export function updateBudgetGuardrailStage(ledger: AgentEnergyLedger): void {
  const totalUsedOrReserved = ledger.usedEnergyCurrentMonth + ledger.reservedEnergyActiveRuns;
  const ratio = totalUsedOrReserved / ledger.monthlyTotalEnergy;
  ledger.burnRatePercentage = Math.round(ratio * 100);

  if (ratio >= 1.0) {
    ledger.budgetAlertStage = 'EXHAUSTED';
  } else if (ratio >= 0.95) {
    ledger.budgetAlertStage = 'STAGE_95_RESTRICT';
  } else if (ratio >= 0.85) {
    ledger.budgetAlertStage = 'STAGE_85_DEFER';
  } else if (ratio >= 0.70) {
    ledger.budgetAlertStage = 'STAGE_70_OPTIMIZE';
  } else {
    ledger.budgetAlertStage = 'NORMAL';
  }

  ledger.remainingAvailableEnergy = Math.max(0, ledger.monthlyTotalEnergy - totalUsedOrReserved);
  ledger.updatedAt = new Date().toISOString();
}

/**
 * Atomic Reservation Engine (ANI-759)
 * Prevents race conditions and negative balance under concurrency.
 */
export async function reserveCreditsAtomic(params: {
  ledger: AgentEnergyLedger;
  amount: number;
  runId: string;
  actionId: string;
  store?: CreditReservationStore;
}): Promise<{ success: boolean; reservationId: string; reason?: string }> {
  const { ledger, amount, runId, actionId } = params;
  const store = params.store || globalReservationStore;

  if (amount <= 0) {
    return { success: false, reservationId: '', reason: '예약 크레딧 수량은 0보다 커야 합니다.' };
  }

  // Atomic check-and-reserve
  if (ledger.remainingAvailableEnergy < amount) {
    return {
      success: false,
      reservationId: '',
      reason: `크레딧 잔여량 부족 (필요: ${amount}, 잔여: ${ledger.remainingAvailableEnergy})`,
    };
  }

  // Synchronously lock and reserve immediately to eliminate async gap during concurrency
  ledger.reservedEnergyActiveRuns += amount;
  updateBudgetGuardrailStage(ledger);

  const reservationId = `resv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record: DurableCreditReservation = {
    reservationId,
    workspaceId: ledger.workspaceId,
    runId,
    actionId,
    amountCredits: amount,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };

  try {
    await store.saveReservation(record);
  } catch (err) {
    // Rollback on store failure
    ledger.reservedEnergyActiveRuns = Math.max(0, ledger.reservedEnergyActiveRuns - amount);
    updateBudgetGuardrailStage(ledger);
    throw err;
  }

  return {
    success: true,
    reservationId,
  };
}


/**
 * Atomic Settle Engine (ANI-759)
 * Settles actual usage, releases unused reservations, and defends against duplicate settles.
 */
export async function settleCreditsAtomic(params: {
  ledger: AgentEnergyLedger;
  reservationId: string;
  actualSpent: number;
  store?: CreditReservationStore;
}): Promise<{ success: boolean; settledAmount: number; releasedUnused: number; reason?: string }> {
  const { ledger, reservationId, actualSpent } = params;
  const store = params.store || globalReservationStore;

  const resv = await store.getReservation(reservationId);
  if (!resv) {
    // Unreserved settlement (fallback with warning)
    ledger.usedEnergyCurrentMonth += actualSpent;
    updateBudgetGuardrailStage(ledger);
    return { success: true, settledAmount: actualSpent, releasedUnused: 0 };
  }

  // Duplicate Settle Protection: If already settled, do NOT re-deduct
  if (resv.status === 'SETTLED') {
    return {
      success: false,
      settledAmount: resv.actualSettledCredits ?? 0,
      releasedUnused: 0,
      reason: `Reservation [${reservationId}] is already settled. Duplicate settlement blocked.`,
    };
  }

  const reserved = resv.amountCredits;
  const releasedUnused = Math.max(0, reserved - actualSpent);

  ledger.reservedEnergyActiveRuns = Math.max(0, ledger.reservedEnergyActiveRuns - reserved);
  ledger.usedEnergyCurrentMonth += actualSpent;
  updateBudgetGuardrailStage(ledger);

  resv.status = 'SETTLED';
  resv.actualSettledCredits = actualSpent;
  resv.settledAt = new Date().toISOString();
  await store.updateReservation(resv);

  return {
    success: true,
    settledAmount: actualSpent,
    releasedUnused,
  };
}

// Synchronous legacy wrappers for backwards compatibility
export function reserveEnergy(
  ledger: AgentEnergyLedger,
  amount: number
): { success: boolean; reservationId: string; reason?: string } {
  if (ledger.remainingAvailableEnergy < amount) {
    return {
      success: false,
      reservationId: '',
      reason: `Agent Energy 잔여량 부족 (필요: ${amount}, 잔여: ${ledger.remainingAvailableEnergy})`,
    };
  }

  const reservationId = `resv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  ledger.reservedEnergyActiveRuns += amount;
  updateBudgetGuardrailStage(ledger);

  return {
    success: true,
    reservationId,
  };
}

export function settleEnergy(
  ledger: AgentEnergyLedger,
  reservationId: string,
  actualSpent: number
): void {
  ledger.usedEnergyCurrentMonth += actualSpent;
  ledger.reservedEnergyActiveRuns = 0;
  updateBudgetGuardrailStage(ledger);
}
