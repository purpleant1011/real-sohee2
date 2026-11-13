export interface TrialState {
  workspaceId: string;
  trialDurationHours: number;
  hoursRemaining: number;
  wowStatus: 'IN_PROGRESS' | 'DELIVERED' | 'EXPIRED_WARNING';
  hasDeliveredFirstOutcome: boolean;
  firstOutcomeReceiptId?: string;
  deliveredInHours?: number;
  startedAt: string;
}

export class TrialWowEngine {
  private trials = new Map<string, TrialState>();

  startTrial(params: { workspaceId: string; trialDurationHours?: number }): TrialState {
    const duration = params.trialDurationHours ?? 48;
    const trial: TrialState = {
      workspaceId: params.workspaceId,
      trialDurationHours: duration,
      hoursRemaining: duration,
      wowStatus: 'IN_PROGRESS',
      hasDeliveredFirstOutcome: false,
      startedAt: new Date().toISOString(),
    };
    this.trials.set(params.workspaceId, trial);
    return trial;
  }

  recordVerifiedOutcome(params: {
    workspaceId: string;
    receiptId: string;
    metricType: string;
    deliveredAtHour: number;
  }): TrialState {
    const trial = this.trials.get(params.workspaceId);
    if (!trial) {
      throw new Error(`Trial not found for workspace: ${params.workspaceId}`);
    }

    trial.hasDeliveredFirstOutcome = true;
    trial.wowStatus = 'DELIVERED';
    trial.firstOutcomeReceiptId = params.receiptId;
    trial.deliveredInHours = params.deliveredAtHour;
    return trial;
  }

  evaluateTrialStatus(workspaceId: string, elapsedHours: number): TrialState {
    const trial = this.trials.get(workspaceId);
    if (!trial) {
      throw new Error(`Trial not found for workspace: ${workspaceId}`);
    }

    trial.hoursRemaining = Math.max(0, trial.trialDurationHours - elapsedHours);
    if (!trial.hasDeliveredFirstOutcome && elapsedHours >= trial.trialDurationHours) {
      trial.wowStatus = 'EXPIRED_WARNING';
    }
    return trial;
  }
}
