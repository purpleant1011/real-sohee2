import { describe, it, expect } from 'vitest';
import { OwnerAbsentServerRuntime } from '../owner-absent-runtime';
import type { A3AutonomyCharter } from '../types';

describe('ANI-901: Owner-Absent Server Runtime', () => {
  const charter: A3AutonomyCharter = {
    id: 'ch-gangnam',
    version: '2.0.0',
    workspaceId: 'ws-gangnam',
    status: 'ACTIVE',
    envelope: {
      maxDailyBudgetKRW: 100000,
      maxCreditsPerAction: 300,
      allowedChannels: ['instagram', 'naver'],
      requireExplicitApprovalRiskTier: 'R2_CRITICAL',
      quietHoursStartHour: 22,
      quietHoursEndHour: 8,
    },
    authorizedByOwnerId: 'owner-gangnam',
    authorizedAt: '2026-09-01T00:00:00Z',
  };

  const healthyGate = {
    isGlobalKillSwitchActive: false,
    isPluginKillSwitchActive: false,
    isReadinessHealthy: true,
  };

  it('spawns autonomous run with ownerSessionRequired=false and passes preflight', () => {
    const runtime = new OwnerAbsentServerRuntime();
    const ctx = runtime.initializeAutonomousRun({
      workspaceId: 'ws-gangnam',
      triggerId: 'trig-cron-01',
      goalId: 'goal-weekly-sales',
      charter,
      harnessId: 'harn-gangnam-skin',
      agentBuild: 'v0.9.4-build101',
      gateConfig: healthyGate,
    });

    expect(ctx.ownerSessionRequired).toBe(false);
    expect(ctx.status).toBe('PREFLIGHT_PASSED');
    expect(ctx.runId).toBeDefined();

    // Evaluate in-envelope action -> INHERITED_A3_APPROVAL
    const evalRes = runtime.evaluateRunAction(
      ctx,
      {
        id: 'act-1',
        workspaceId: 'ws-gangnam',
        actionType: 'PUBLISH_CONTENT',
        channel: 'instagram',
        costCredits: 200,
        scheduledTimeHourKST: 15,
      },
      charter
    );

    expect(evalRes.canProceed).toBe(true);
    expect(evalRes.approvalType).toBe('INHERITED_A3_APPROVAL');
  });

  it('blocks run immediately if Kill Switch is active', () => {
    const runtime = new OwnerAbsentServerRuntime();
    const ctx = runtime.initializeAutonomousRun({
      workspaceId: 'ws-gangnam',
      triggerId: 'trig-cron-01',
      goalId: 'goal-weekly-sales',
      charter,
      harnessId: 'harn-1',
      agentBuild: 'v0.9.4',
      gateConfig: { ...healthyGate, isGlobalKillSwitchActive: true },
    });

    expect(ctx.status).toBe('BLOCKED_BY_GATE');
    expect(ctx.blockReason).toContain('kill switch active');
  });

  it('blocks run if charter is PAUSED', () => {
    const runtime = new OwnerAbsentServerRuntime();
    const ctx = runtime.initializeAutonomousRun({
      workspaceId: 'ws-gangnam',
      triggerId: 'trig-cron-01',
      goalId: 'goal-weekly-sales',
      charter: { ...charter, status: 'PAUSED' },
      harnessId: 'harn-1',
      agentBuild: 'v0.9.4',
      gateConfig: healthyGate,
    });

    expect(ctx.status).toBe('BLOCKED_BY_GATE');
    expect(ctx.blockReason).toContain('Charter is PAUSED');
  });
});
