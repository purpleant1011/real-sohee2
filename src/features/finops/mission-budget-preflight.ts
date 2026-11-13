/**
 * Mission Budget Preflight & Credit Reserve Production Wiring (ANI-1274)
 * 
 * Invariants:
 * 1. Quote -> Entitlement/Budget Preflight -> Reserve -> Execute -> Settle/Release.
 * 2. Fail-Closed: Strictly blocks execution with INSUFFICIENT_CREDITS before calling any external provider.
 * 3. 100% Release on Failure: If execution fails, all reserved credits are released back.
 * 4. Hold on RESULT_UNKNOWN: If provider response is ambiguous or times out, hold reservation for reconcile without blind settle or refund.
 * 5. Idempotent Reservation: Same idempotency key cannot double-reserve.
 */

import { IntegratedFinOpsEngine, InsufficientCreditsError } from '@/lib/finops/integrated-finops-engine';

export interface MissionBudgetHandlers {
  getAvailableCredits: (workspaceId: string) => Promise<number>;
  reserveCredits: (
    workspaceId: string,
    actionRunId: string,
    amount: number,
    idempotencyKey: string
  ) => Promise<{ reservationId: string; amount: number; idempotencyKey: string }>;
  settleCredits: (
    reservationId: string,
    actualCost: number
  ) => Promise<{ settlementId: string; actualCost: number; status: 'SETTLED' }>;
  releaseCredits: (
    reservationId: string,
    amount: number
  ) => Promise<{ reservationId: string; releasedAmount: number; status: 'RELEASED' }>;
}

export interface BudgetExecutionParams<T> {
  workspaceId: string;
  actionRunId: string;
  requiredCredits: number;
  actualCost?: number;
  idempotencyKey: string;
  executeFn: () => Promise<T>;
}

export interface BudgetExecutionResult<T> {
  executionResult: T;
  settlement: any;
  isHeldForReconcile: boolean;
}

export class MissionBudgetPreflightService {
  private handlers: MissionBudgetHandlers;

  constructor(customHandlers?: Partial<MissionBudgetHandlers>) {
    this.handlers = {
      getAvailableCredits: customHandlers?.getAvailableCredits ?? (async (workspaceId: string) => {
        return IntegratedFinOpsEngine.getWorkspaceBalance(workspaceId);
      }),
      reserveCredits: customHandlers?.reserveCredits ?? (async (workspaceId, actionRunId, amount, idempotencyKey) => {
        const resv = await IntegratedFinOpsEngine.reserve(workspaceId, actionRunId, amount, {
          idempotencyKey,
        });
        return { reservationId: resv.reservation_id, amount: resv.amount, idempotencyKey };
      }),
      settleCredits: customHandlers?.settleCredits ?? (async (reservationId, actualCost) => {
        const stl = await IntegratedFinOpsEngine.settle(reservationId, actualCost);
        return { settlementId: stl.settlement_id, actualCost: stl.actual_cost, status: 'SETTLED' };
      }),
      releaseCredits: customHandlers?.releaseCredits ?? (async (reservationId, amount) => {
        const rel = await IntegratedFinOpsEngine.release(reservationId, 'Execution failure rollback');
        return { reservationId: rel.reservation_id, releasedAmount: rel.released_amount, status: 'RELEASED' };
      }),
    };
  }

  /**
   * Orchestrates the 5-step closed-loop FinOps transaction for any mission action.
   */
  async executeWithBudgetPreflight<T>(
    params: BudgetExecutionParams<T>
  ): Promise<BudgetExecutionResult<T>> {
    const { workspaceId, actionRunId, requiredCredits, actualCost, idempotencyKey, executeFn } = params;

    // 1. Preflight Check: verify available balance before reserving or calling provider
    const available = await this.handlers.getAvailableCredits(workspaceId);
    if (available < requiredCredits) {
      throw new InsufficientCreditsError(
        `가용 크레딧 부족 (필요: ${requiredCredits}, 현재 가용: ${available}). 실행이 사전 차단되었습니다.`,
        requiredCredits,
        available
      );
    }

    // 2. Reserve credits in durable ledger
    const reservation = await this.handlers.reserveCredits(
      workspaceId,
      actionRunId,
      requiredCredits,
      idempotencyKey
    );

    let executionResult: T;
    try {
      // 3. Execute external side-effect or model generation
      executionResult = await executeFn();
    } catch (err) {
      // 4. On failure: Release 100% reserved credits immediately
      await this.handlers.releaseCredits(reservation.reservationId, requiredCredits);
      throw err;
    }

    // 5. Check if result is ambiguous (RESULT_UNKNOWN)
    if (
      executionResult &&
      typeof executionResult === 'object' &&
      (executionResult as any).status === 'RESULT_UNKNOWN'
    ) {
      // Hold reservation for reconciliation. Do NOT blindly settle or release.
      return {
        executionResult,
        settlement: null,
        isHeldForReconcile: true,
      };
    }

    // 6. Settle actual cost
    const costToSettle = actualCost !== undefined ? actualCost : requiredCredits;
    const settlement = await this.handlers.settleCredits(reservation.reservationId, costToSettle);

    return {
      executionResult,
      settlement,
      isHeldForReconcile: false,
    };
  }
}
