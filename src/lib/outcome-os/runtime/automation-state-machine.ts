import type { AutomationLifecycleState } from '@/types/autonomous-outcome-os';

const VALID_TRANSITIONS: Record<AutomationLifecycleState, AutomationLifecycleState[]> = {
  DRAFT: ['PROPOSED', 'APPROVAL_REQUIRED', 'APPROVED'],
  PROPOSED: ['APPROVAL_REQUIRED', 'APPROVED', 'DRAFT'],
  APPROVAL_REQUIRED: ['APPROVED', 'DRAFT', 'BLOCKED'],
  APPROVED: ['SCHEDULED', 'BLOCKED'],
  SCHEDULED: ['RUNNING', 'BLOCKED', 'ACTION_REQUIRED'],
  RUNNING: ['VERIFYING', 'FAILED', 'BLOCKED', 'ACTION_REQUIRED'],
  VERIFYING: ['SUCCEEDED', 'FAILED', 'ACTION_REQUIRED'],
  SUCCEEDED: ['LEARNING', 'SCHEDULED'],
  FAILED: ['SCHEDULED', 'BLOCKED', 'ACTION_REQUIRED'],
  BLOCKED: ['APPROVAL_REQUIRED', 'SCHEDULED', 'DRAFT'],
  ACTION_REQUIRED: ['RUNNING', 'SCHEDULED', 'BLOCKED'],
  LEARNING: ['REPLANNED', 'SCHEDULED'],
  REPLANNED: ['APPROVED', 'SCHEDULED'],
};

export function transitionAutomationState(
  from: AutomationLifecycleState,
  to: AutomationLifecycleState
): { valid: boolean; from: AutomationLifecycleState; to: AutomationLifecycleState; error?: string } {
  const allowed = VALID_TRANSITIONS[from] || [];
  if (allowed.includes(to)) {
    return { valid: true, from, to };
  }
  return {
    valid: false,
    from,
    to,
    error: `유효하지 않은 상태 전이입니다: ${from} -> ${to}`,
  };
}

export function calculateNextRunTime(cronExpression: string, referenceTime = new Date()): Date {
  // Simple deterministic daily cron parser for common patterns (e.g. '0 14 * * *')
  const parts = cronExpression.trim().split(/\s+/);
  const targetMinute = parseInt(parts[0], 10) || 0;
  const targetHour = parseInt(parts[1], 10) || 0;

  const next = new Date(referenceTime.getTime());
  next.setUTCHours(targetHour, targetMinute, 0, 0);

  if (next.getTime() <= referenceTime.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}

export const AutomationStateMachine = {
  transitionState: transitionAutomationState,
  calculateNextRunTime,
  evaluateScheduleNextRuns(
    instances: Array<{
      instanceId: string;
      workspaceId: string;
      automationId: string;
      currentState: AutomationLifecycleState;
      scheduledAt?: string | null;
      nextRunAt?: string | null;
    }>,
    referenceTime = new Date()
  ) {
    return instances.filter((inst) => {
      if (inst.currentState !== 'SCHEDULED') return false;
      const runTime = inst.nextRunAt || inst.scheduledAt;
      if (!runTime) return false;
      return new Date(runTime).getTime() <= referenceTime.getTime();
    });
  },
};
