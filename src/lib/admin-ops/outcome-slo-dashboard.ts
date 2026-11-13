/**
 * Outcome-based SLO Dashboard Service (ANI-879)
 * Execution / Readback / Schedule / Credit 4대 SLO 대시보드
 */

export interface SloMetric {
  name: 'EXECUTION_SUCCESS_RATE' | 'READBACK_ACCURACY' | 'SCHEDULE_ON_TIME' | 'CREDIT_RECONCILE_ACCURACY';
  targetPercent: number;
  currentPercent: number;
  isBreached: boolean;
  sampleCount: number;
}

export interface OutcomeSloReport {
  evaluatedAt: string;
  overallHealth: 'HEALTHY' | 'WARNING' | 'BREACHED';
  metrics: SloMetric[];
}

export class OutcomeSloDashboardService {
  evaluateSlo(metricsData: {
    totalExecutions: number;
    failedExecutions: number;
    totalReadbacks: number;
    mismatchedReadbacks: number;
    totalScheduledPublications: number;
    delayedPublications: number;
    totalCreditTransactions: number;
    unreconciledCreditsCount: number;
  }): OutcomeSloReport {
    const {
      totalExecutions,
      failedExecutions,
      totalReadbacks,
      mismatchedReadbacks,
      totalScheduledPublications,
      delayedPublications,
      totalCreditTransactions,
      unreconciledCreditsCount,
    } = metricsData;

    const execRate =
      totalExecutions > 0 ? ((totalExecutions - failedExecutions) / totalExecutions) * 100 : 100;
    const readbackRate =
      totalReadbacks > 0
        ? ((totalReadbacks - mismatchedReadbacks) / totalReadbacks) * 100
        : 100;
    const scheduleRate =
      totalScheduledPublications > 0
        ? ((totalScheduledPublications - delayedPublications) / totalScheduledPublications) * 100
        : 100;
    const creditRate =
      totalCreditTransactions > 0
        ? ((totalCreditTransactions - unreconciledCreditsCount) / totalCreditTransactions) * 100
        : 100;

    const metrics: SloMetric[] = [
      {
        name: 'EXECUTION_SUCCESS_RATE',
        targetPercent: 99.0,
        currentPercent: Number(execRate.toFixed(2)),
        isBreached: execRate < 99.0,
        sampleCount: totalExecutions,
      },
      {
        name: 'READBACK_ACCURACY',
        targetPercent: 99.5,
        currentPercent: Number(readbackRate.toFixed(2)),
        isBreached: readbackRate < 99.5,
        sampleCount: totalReadbacks,
      },
      {
        name: 'SCHEDULE_ON_TIME',
        targetPercent: 98.0,
        currentPercent: Number(scheduleRate.toFixed(2)),
        isBreached: scheduleRate < 98.0,
        sampleCount: totalScheduledPublications,
      },
      {
        name: 'CREDIT_RECONCILE_ACCURACY',
        targetPercent: 100.0,
        currentPercent: Number(creditRate.toFixed(2)),
        isBreached: creditRate < 100.0,
        sampleCount: totalCreditTransactions,
      },
    ];

    const hasBreached = metrics.some((m) => m.isBreached);
    const overallHealth = hasBreached ? 'BREACHED' : 'HEALTHY';

    return {
      evaluatedAt: new Date().toISOString(),
      overallHealth,
      metrics,
    };
  }
}
