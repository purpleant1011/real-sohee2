/**
 * Autonomous Exception Router (ANI-902)
 * 
 * Core Invariants:
 * 1. Owner Escalation Minimization: Do NOT ask for approval on every action.
 * 2. Strict 5-Pillar Exception Routing: Escalation occurs ONLY when an action breaches the 5 canonical boundaries:
 *    - BUDGET_INCREASE
 *    - NEW_EXTERNAL_PERMISSION
 *    - PRIVACY_OR_DESTRUCTIVE
 *    - MASS_OR_SENSITIVE_MESSAGE
 *    - OUT_OF_ENVELOPE
 * 3. Execution Blockade: When an exception triggers, execution is blocked immediately and queued for Owner Escalation.
 */

import type { A3AutonomyCharter, A3ActionEnvelope } from './types';

export type AutonomyExceptionType =
  | 'BUDGET_INCREASE'
  | 'NEW_EXTERNAL_PERMISSION'
  | 'PRIVACY_OR_DESTRUCTIVE'
  | 'MASS_OR_SENSITIVE_MESSAGE'
  | 'OUT_OF_ENVELOPE';

export interface AutonomyExceptionRecord {
  id: string;
  workspaceId: string;
  charterId: string;
  charterVersion: string;
  actionId: string;
  exceptionType: AutonomyExceptionType;
  occurredAt: string;
  reason: string;
  actionPayloadSummary: string;
  status: 'PENDING_OWNER_REVIEW' | 'APPROVED_BY_OWNER' | 'REJECTED_BY_OWNER';
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface ProposedAutonomyAction {
  id: string;
  workspaceId: string;
  actionType: 'PUBLISH_CONTENT' | 'SPEND_BUDGET' | 'DELETE_RESOURCE' | 'BULK_MESSAGE' | 'ACCESS_DATA';
  channel: string;
  requiredScope?: string;
  costCredits: number;
  recipientCount?: number;
  isDestructiveDelete?: boolean;
  containsCustomerPii?: boolean;
  scheduledTimeHourKST: number;
}

export interface AutonomyRoutingResult {
  isEscalationRequired: boolean;
  canExecuteAutonomous: boolean;
  exception?: AutonomyExceptionRecord;
  rejectionReason?: string;
}

export function routeAutonomyAction(
  action: ProposedAutonomyAction,
  charter: A3AutonomyCharter,
  envelope: A3ActionEnvelope
): AutonomyRoutingResult {
  const now = new Date().toISOString();

  // 1. Check Charter Status
  if (charter.status !== 'ACTIVE') {
    return {
      isEscalationRequired: false,
      canExecuteAutonomous: false,
      rejectionReason: `Charter is currently ${charter.status}. Autonomous execution blocked.`,
    };
  }

  // 2. Exception Pillar 1: BUDGET_INCREASE
  if (action.costCredits > envelope.maxCreditsPerAction) {
    return {
      isEscalationRequired: true,
      canExecuteAutonomous: false,
      exception: {
        id: `exc_budget_${action.id}`,
        workspaceId: action.workspaceId,
        charterId: charter.id,
        charterVersion: charter.version,
        actionId: action.id,
        exceptionType: 'BUDGET_INCREASE',
        occurredAt: now,
        reason: `Action cost ${action.costCredits} credits exceeds approved envelope limit of ${envelope.maxCreditsPerAction} credits.`,
        actionPayloadSummary: `Action ${action.actionType} requires budget expansion.`,
        status: 'PENDING_OWNER_REVIEW',
      },
    };
  }

  // 3. Exception Pillar 2: NEW_EXTERNAL_PERMISSION
  if (action.requiredScope && !envelope.allowedChannels.includes(action.channel)) {
    return {
      isEscalationRequired: true,
      canExecuteAutonomous: false,
      exception: {
        id: `exc_perm_${action.id}`,
        workspaceId: action.workspaceId,
        charterId: charter.id,
        charterVersion: charter.version,
        actionId: action.id,
        exceptionType: 'NEW_EXTERNAL_PERMISSION',
        occurredAt: now,
        reason: `Target channel '${action.channel}' is not in approved channels [${envelope.allowedChannels.join(', ')}].`,
        actionPayloadSummary: `Action requires new permission for ${action.channel}.`,
        status: 'PENDING_OWNER_REVIEW',
      },
    };
  }

  // 4. Exception Pillar 3: PRIVACY_OR_DESTRUCTIVE
  if (action.isDestructiveDelete || action.containsCustomerPii) {
    const detail = action.isDestructiveDelete ? 'Destructive deletion request' : 'Contains unmasked customer PII';
    return {
      isEscalationRequired: true,
      canExecuteAutonomous: false,
      exception: {
        id: `exc_privacy_${action.id}`,
        workspaceId: action.workspaceId,
        charterId: charter.id,
        charterVersion: charter.version,
        actionId: action.id,
        exceptionType: 'PRIVACY_OR_DESTRUCTIVE',
        occurredAt: now,
        reason: `${detail} violates autonomous safety invariants. Explicit owner sign-off mandatory.`,
        actionPayloadSummary: detail,
        status: 'PENDING_OWNER_REVIEW',
      },
    };
  }

  // 5. Exception Pillar 4: MASS_OR_SENSITIVE_MESSAGE
  if (action.recipientCount && action.recipientCount >= 100) {
    return {
      isEscalationRequired: true,
      canExecuteAutonomous: false,
      exception: {
        id: `exc_mass_${action.id}`,
        workspaceId: action.workspaceId,
        charterId: charter.id,
        charterVersion: charter.version,
        actionId: action.id,
        exceptionType: 'MASS_OR_SENSITIVE_MESSAGE',
        occurredAt: now,
        reason: `Recipient volume (${action.recipientCount}) reaches mass message threshold (>= 100).`,
        actionPayloadSummary: `Mass outreach to ${action.recipientCount} recipients.`,
        status: 'PENDING_OWNER_REVIEW',
      },
    };
  }

  // 6. Exception Pillar 5: OUT_OF_ENVELOPE (Quiet Hours breach)
  const isQuietHours =
    action.scheduledTimeHourKST >= envelope.quietHoursStartHour ||
    action.scheduledTimeHourKST < envelope.quietHoursEndHour;

  if (isQuietHours) {
    return {
      isEscalationRequired: true,
      canExecuteAutonomous: false,
      exception: {
        id: `exc_envelope_${action.id}`,
        workspaceId: action.workspaceId,
        charterId: charter.id,
        charterVersion: charter.version,
        actionId: action.id,
        exceptionType: 'OUT_OF_ENVELOPE',
        occurredAt: now,
        reason: `Execution at ${action.scheduledTimeHourKST}:00 KST falls within quiet hours (${envelope.quietHoursStartHour}:00-${envelope.quietHoursEndHour}:00 KST).`,
        actionPayloadSummary: `Off-hours execution request.`,
        status: 'PENDING_OWNER_REVIEW',
      },
    };
  }

  // All 5 boundaries satisfied: In-envelope autonomous execution approved!
  return {
    isEscalationRequired: false,
    canExecuteAutonomous: true,
  };
}
