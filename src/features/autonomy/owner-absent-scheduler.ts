/**
 * Owner-Absent Scheduler & Durable Automation Runtime (ANI-1253)
 * 
 * Headless server automation runtime executing scheduled/event triggers
 * when the owner is away from the browser.
 */

import type { BackgroundWorkLedger } from './work-ledger';

export interface AutomationTrigger {
  triggerId: string;
  triggerType: 'SCHEDULE' | 'EVENT' | 'THRESHOLD' | 'MANUAL';
  workspaceId: string;
  workspaceStatus: 'ACTIVE' | 'PAUSED' | 'TRIAL';
  actionType: string;
  charterId?: string;
  charterVersion?: string;
}

export interface AutomationExecutionResult {
  summary: string;
  creditsConsumed: number;
  evidenceId: string;
}

export interface SchedulerRunResult {
  status: 'COMPLETED' | 'BLOCKED_WORKSPACE_PAUSED' | 'FAILED';
  runId?: string;
  summary?: string;
  error?: string;
}

export class OwnerAbsentScheduler {
  private workLedger: BackgroundWorkLedger;

  constructor(workLedger: BackgroundWorkLedger) {
    this.workLedger = workLedger;
  }

  /**
   * Executes scheduled background automation with paused-workspace guard and work ledger persistence.
   */
  async scheduleAndRun(
    trigger: AutomationTrigger,
    runner: () => Promise<AutomationExecutionResult>
  ): Promise<SchedulerRunResult> {
    // 1. Strict Paused Workspace Guard: 0 runs permitted when workspace is paused
    if (trigger.workspaceStatus === 'PAUSED') {
      return {
        status: 'BLOCKED_WORKSPACE_PAUSED',
        error: '일시정지된 워크스페이스에서는 신규 자동화 실행이 차단됩니다.',
      };
    }

    const runId = `run_absent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    try {
      // 2. Execute headless action
      const execution = await runner();

      // 3. Record verified provenance in BackgroundWorkLedger
      this.workLedger.record({
        workspaceId: trigger.workspaceId,
        triggerId: trigger.triggerId,
        triggerType: trigger.triggerType === 'EVENT'
          ? 'CHANNEL_EVENT'
          : trigger.triggerType === 'THRESHOLD'
          ? 'GOAL_SHORTFALL'
          : trigger.triggerType,
        goalId: `goal_auto_${trigger.triggerId}`,
        runId,
        actionId: `act_${runId}`,
        actionType: trigger.actionType,
        charterId: trigger.charterId || 'charter-v1',
        charterVersion: trigger.charterVersion || '1.0',
        summary: execution.summary,
        verificationState: 'EXTERNAL_VERIFIED',
        evidenceId: execution.evidenceId,
        creditsConsumed: execution.creditsConsumed,
      });

      return {
        status: 'COMPLETED',
        runId,
        summary: execution.summary,
      };
    } catch (err: any) {
      return {
        status: 'FAILED',
        runId,
        error: err?.message || '자동화 작업 수행 중 오류가 발생했습니다.',
      };
    }
  }
}
