import { getActionDefinition, ActionRiskLevel } from './action-catalog';
import { AgentControlPlaneService } from './agent-control-state';

export interface WorkspaceSafetyState {
  workspaceId: string;
  globalKillSwitchActive: boolean;
  pausedAt?: string;
  pausedBy?: string;
  channelKillSwitches: Record<string, boolean>;
  allowedDestinationsOnly: boolean;
}

export interface CreditBudgetState {
  workspaceId: string;
  totalMonthlyLimit: number;
  totalWeeklyLimit: number;
  totalDailyLimit: number;
  usedMonthly: number;
  usedWeekly: number;
  usedDaily: number;
}

export interface PreflightCheckResult {
  allowed: boolean;
  reason?: string;
  riskLevel: ActionRiskLevel;
  creditCost: number;
  isKillSwitched?: boolean;
  isCreditDepleted?: boolean;
}

export class SafetyAndCreditEngine {
  private safetyStates = new Map<string, WorkspaceSafetyState>();
  private creditStates = new Map<string, CreditBudgetState>();
  private idempotencyLedger = new Map<string, {
    actionType: string;
    result: Record<string, unknown>;
    executedAt: string;
    executionCount: number;
  }>();

  async getSafetyState(workspaceId: string): Promise<WorkspaceSafetyState> {
    // Sync with authoritative AgentControlPlaneService
    let serverControl;
    try { serverControl = await AgentControlPlaneService.getControlState(workspaceId); } catch { serverControl = null; }
    if (!this.safetyStates.has(workspaceId)) {
      this.safetyStates.set(workspaceId, {
        workspaceId,
        globalKillSwitchActive: serverControl?.killSwitchActive ?? true,
        channelKillSwitches: {},
        allowedDestinationsOnly: true,
      });
    }
    const state = this.safetyStates.get(workspaceId)!;
    state.globalKillSwitchActive = !serverControl || serverControl.killSwitchActive || serverControl.actualMode !== 'RUNNING';
    return state;
  }

  async setGlobalKillSwitch(workspaceId: string, active: boolean, operatorId: string): Promise<WorkspaceSafetyState> {
    await AgentControlPlaneService.toggleKillSwitch(workspaceId, active, operatorId);
    const state = await this.getSafetyState(workspaceId);
    state.pausedAt = active ? new Date().toISOString() : undefined;
    state.pausedBy = active ? operatorId : undefined;
    this.safetyStates.set(workspaceId, state);
    return state;
  }

  getCreditState(workspaceId: string): CreditBudgetState {
    if (!this.creditStates.has(workspaceId)) {
      this.creditStates.set(workspaceId, {
        workspaceId,
        totalMonthlyLimit: 1000,
        totalWeeklyLimit: 250,
        totalDailyLimit: 50,
        usedMonthly: 0,
        usedWeekly: 0,
        usedDaily: 0,
      });
    }
    return this.creditStates.get(workspaceId)!;
  }

  setCreditBudget(workspaceId: string, limits: Partial<CreditBudgetState>): CreditBudgetState {
    const state = this.getCreditState(workspaceId);
    Object.assign(state, limits);
    this.creditStates.set(workspaceId, state);
    return state;
  }

  async preflightCheck(input: {
    workspaceId: string;
    actionType: string;
    channelKey?: string;
    isRevenueCritical?: boolean;
  }): Promise<PreflightCheckResult> {
    const { workspaceId, actionType, channelKey, isRevenueCritical } = input;
    const safety = await this.getSafetyState(workspaceId);
    const credits = this.getCreditState(workspaceId);
    const actionDef = getActionDefinition(actionType);

    const riskLevel: ActionRiskLevel = actionDef ? actionDef.riskLevel : 'YELLOW';
    const creditCost = actionDef ? actionDef.creditCost : 5;

    // 1. Authoritative Global Kill Switch Check
    if (safety.globalKillSwitchActive) {
      return {
        allowed: false,
        reason: '소희 업무가 일시정지 상태입니다 (Global Kill Switch / Server Control 활성화).',
        riskLevel,
        creditCost,
        isKillSwitched: true,
      };
    }

    // 2. Channel Kill Switch Check
    if (channelKey && safety.channelKillSwitches[channelKey]) {
      return {
        allowed: false,
        reason: `${channelKey} 채널 업무가 비활성화되어 있습니다.`,
        riskLevel,
        creditCost,
        isKillSwitched: true,
      };
    }

    // 3. Credit Guardian Check
    const remainingDaily = credits.totalDailyLimit - credits.usedDaily;
    if (remainingDaily < creditCost) {
      const remainingWeekly = credits.totalWeeklyLimit - credits.usedWeekly;
      if (isRevenueCritical && remainingWeekly >= creditCost) {
        return {
          allowed: true,
          riskLevel,
          creditCost,
        };
      }

      return {
        allowed: false,
        reason: `일일 크레딧 예산 초과 (잔여: ${remainingDaily}, 필요: ${creditCost}). 저우선 업무는 차단되고 사장님 보고가 필요합니다.`,
        riskLevel,
        creditCost,
        isCreditDepleted: true,
      };
    }

    return {
      allowed: true,
      riskLevel,
      creditCost,
    };
  }

  async executeWithIdempotency<T extends Record<string, unknown>>(
    idempotencyKey: string,
    actionType: string,
    executor: () => Promise<T>
  ): Promise<{ result: T; executionCount: number; isDuplicateReplay: boolean }> {
    const existing = this.idempotencyLedger.get(idempotencyKey);
    if (existing) {
      existing.executionCount += 1;
      return {
        result: existing.result as T,
        executionCount: existing.executionCount,
        isDuplicateReplay: true,
      };
    }

    const result = await executor();
    this.idempotencyLedger.set(idempotencyKey, {
      actionType,
      result,
      executedAt: new Date().toISOString(),
      executionCount: 1,
    });

    return {
      result,
      executionCount: 1,
      isDuplicateReplay: false,
    };
  }

  recordCreditUsage(workspaceId: string, amount: number): void {
    const state = this.getCreditState(workspaceId);
    state.usedDaily += amount;
    state.usedWeekly += amount;
    state.usedMonthly += amount;
    this.creditStates.set(workspaceId, state);
  }
}
