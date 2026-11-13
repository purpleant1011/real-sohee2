import { describe, it, expect } from 'vitest';
import { AutonomyCharterController } from '../charter-control';
import { ResultUnknownReconcileQueue } from '../../agent-runtime/reconcile-queue';
import type { A3AutonomyCharter } from '../types';

describe('ANI-905: Pause·Resume·Kill Runtime with In-flight Safe Reconcile', () => {
  const charter: A3AutonomyCharter = {
    id: 'ch-01',
    version: '1.0.0',
    workspaceId: 'ws-gangnam',
    status: 'ACTIVE',
    envelope: {
      maxDailyBudgetKRW: 100000,
      maxCreditsPerAction: 300,
      allowedChannels: ['instagram'],
      requireExplicitApprovalRiskTier: 'R2_CRITICAL',
      quietHoursStartHour: 22,
      quietHoursEndHour: 8,
    },
    authorizedByOwnerId: 'owner-1',
    authorizedAt: '2026-09-01T00:00:00Z',
  };

  it('pauses new runs immediately while keeping in-flight count visible', () => {
    const controller = new AutonomyCharterController();
    controller.registerCharter(charter);

    controller.trackInFlight('ws-gangnam', {
      actionRunId: 'run-in-flight-01',
      workspaceId: 'ws-gangnam',
      status: 'PENDING_READBACK',
      providerAcceptedAt: '2026-09-06T10:00:00Z',
    });

    const status = controller.pauseAutonomy('ws-gangnam', 'Owner emergency stop');
    expect(status.isPaused).toBe(true);
    expect(status.charterStatus).toBe('PAUSED');
    expect(status.activeInFlightCount).toBe(1);
    expect(status.pauseReason).toBe('Owner emergency stop');
  });

  it('prohibits resuming if readiness check is unhealthy', () => {
    const controller = new AutonomyCharterController();
    controller.registerCharter({ ...charter, status: 'PAUSED' });

    expect(() => {
      controller.resumeAutonomy('ws-gangnam', false);
    }).toThrowError('Workspace readiness check failed');
  });

  it('resumes successfully when readiness check passes', () => {
    const controller = new AutonomyCharterController();
    controller.registerCharter({ ...charter, status: 'PAUSED' });

    const status = controller.resumeAutonomy('ws-gangnam', true);
    expect(status.isPaused).toBe(false);
    expect(status.charterStatus).toBe('ACTIVE');
  });

  it('flushes in-flight safe reconcile queue during pause without data loss', async () => {
    const controller = new AutonomyCharterController();
    controller.registerCharter(charter);

    const queue = new ResultUnknownReconcileQueue();
    queue.enqueue({
      actionRunId: 'run-99',
      workspaceId: 'ws-gangnam',
      idempotencyKey: 'idem-99',
      channel: 'instagram',
      expectedPayload: {},
      reservedCredits: 100,
    });

    const res = await controller.flushInFlightSafeReconcile('ws-gangnam', queue);
    expect(res.reconciledCount).toBe(1);
  });
});
