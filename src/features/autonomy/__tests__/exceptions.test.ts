import { describe, it, expect } from 'vitest';
import { routeAutonomyAction, type ProposedAutonomyAction } from '../exceptions';
import type { A3AutonomyCharter, A3ActionEnvelope } from '../types';

describe('ANI-902: Autonomous Exception Router', () => {
  const charter: A3AutonomyCharter = {
    id: 'charter_gangnam_01',
    version: '1.0.0',
    workspaceId: 'ws_gangnam_01',
    status: 'ACTIVE',
    envelope: {
      maxDailyBudgetKRW: 50000,
      maxCreditsPerAction: 300,
      allowedChannels: ['instagram', 'naver'],
      requireExplicitApprovalRiskTier: 'R2_CRITICAL',
      quietHoursStartHour: 22,
      quietHoursEndHour: 8,
    },
    authorizedByOwnerId: 'owner_choi',
    authorizedAt: '2026-09-01T00:00:00Z',
  };

  const envelope: A3ActionEnvelope = charter.envelope;

  const validAction: ProposedAutonomyAction = {
    id: 'act_daily_post',
    workspaceId: 'ws_gangnam_01',
    actionType: 'PUBLISH_CONTENT',
    channel: 'instagram',
    costCredits: 200,
    scheduledTimeHourKST: 14, // 2 PM KST
  };

  it('allows autonomous execution when action is fully inside the envelope', () => {
    const res = routeAutonomyAction(validAction, charter, envelope);
    expect(res.canExecuteAutonomous).toBe(true);
    expect(res.isEscalationRequired).toBe(false);
    expect(res.exception).toBeUndefined();
  });

  it('routes to BUDGET_INCREASE exception when action exceeds maxCreditsPerAction', () => {
    const res = routeAutonomyAction({ ...validAction, costCredits: 500 }, charter, envelope);
    expect(res.canExecuteAutonomous).toBe(false);
    expect(res.isEscalationRequired).toBe(true);
    expect(res.exception?.exceptionType).toBe('BUDGET_INCREASE');
    expect(res.exception?.reason).toContain('exceeds approved envelope limit of 300 credits');
  });

  it('routes to NEW_EXTERNAL_PERMISSION exception when target channel is unapproved', () => {
    const res = routeAutonomyAction({ ...validAction, channel: 'threads', requiredScope: 'threads_write' }, charter, envelope);
    expect(res.canExecuteAutonomous).toBe(false);
    expect(res.isEscalationRequired).toBe(true);
    expect(res.exception?.exceptionType).toBe('NEW_EXTERNAL_PERMISSION');
  });

  it('routes to PRIVACY_OR_DESTRUCTIVE exception when action is a destructive delete or contains PII', () => {
    const res1 = routeAutonomyAction({ ...validAction, isDestructiveDelete: true }, charter, envelope);
    expect(res1.isEscalationRequired).toBe(true);
    expect(res1.exception?.exceptionType).toBe('PRIVACY_OR_DESTRUCTIVE');

    const res2 = routeAutonomyAction({ ...validAction, containsCustomerPii: true }, charter, envelope);
    expect(res2.isEscalationRequired).toBe(true);
    expect(res2.exception?.exceptionType).toBe('PRIVACY_OR_DESTRUCTIVE');
  });

  it('routes to MASS_OR_SENSITIVE_MESSAGE exception when recipient count >= 100', () => {
    const res = routeAutonomyAction({ ...validAction, recipientCount: 250 }, charter, envelope);
    expect(res.isEscalationRequired).toBe(true);
    expect(res.exception?.exceptionType).toBe('MASS_OR_SENSITIVE_MESSAGE');
  });

  it('routes to OUT_OF_ENVELOPE exception when scheduled during quiet hours', () => {
    const res = routeAutonomyAction({ ...validAction, scheduledTimeHourKST: 23 }, charter, envelope);
    expect(res.isEscalationRequired).toBe(true);
    expect(res.exception?.exceptionType).toBe('OUT_OF_ENVELOPE');
    expect(res.exception?.reason).toContain('falls within quiet hours');
  });
});
