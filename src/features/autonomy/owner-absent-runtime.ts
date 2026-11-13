/**
 * Owner-Absent Server Runtime (ANI-901)
 * 
 * Core Invariants:
 * 1. Zero Owner Session Dependency: ownerSessionRequired = false. Operates 24/7 without active web browser sessions.
 * 2. Immutable Execution Context: Captures workspaceId, triggerId, goalId, charterId/version, harnessId, and policyEnvelope.
 * 3. Pre-flight Fail-Closed Gates:
 *    - Charter must be ACTIVE (not PAUSED/EXPIRED/REVOKED).
 *    - Global/Plugin Kill Switch must be OFF.
 *    - Workspace readiness must be HEALTHY.
 * 4. In-Envelope Inherited Approval: Actions within approved envelope execute autonomously without prompting the user.
 */

import type { A3AutonomyCharter, A3ActionEnvelope } from './types';
import { routeAutonomyAction, type ProposedAutonomyAction } from './exceptions';

export interface AutonomousRunContext {
  runId: string;
  workspaceId: string;
  triggerId: string;
  goalId: string;
  charterId: string;
  charterVersion: string;
  harnessId: string;
  agentBuild: string;
  policyEnvelope: A3ActionEnvelope;
  ownerSessionRequired: false;
  startedAt: string;
  status: 'INITIALIZED' | 'PREFLIGHT_PASSED' | 'EXECUTING' | 'VERIFIED' | 'FAILED' | 'BLOCKED_BY_GATE';
  blockReason?: string;
}

export interface OwnerAbsentRuntimeGateConfig {
  isGlobalKillSwitchActive: boolean;
  isPluginKillSwitchActive: boolean;
  isReadinessHealthy: boolean;
}

export class OwnerAbsentServerRuntime {
  /**
   * Initializes and preflights an autonomous run without requiring an owner session.
   */
  initializeAutonomousRun(params: {
    workspaceId: string;
    triggerId: string;
    goalId: string;
    charter: A3AutonomyCharter;
    harnessId: string;
    agentBuild: string;
    gateConfig: OwnerAbsentRuntimeGateConfig;
  }): AutonomousRunContext {
    const { workspaceId, triggerId, goalId, charter, harnessId, agentBuild, gateConfig } = params;
    const now = new Date().toISOString();
    const runId = `autorun_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const context: AutonomousRunContext = {
      runId,
      workspaceId,
      triggerId,
      goalId,
      charterId: charter.id,
      charterVersion: charter.version,
      harnessId,
      agentBuild,
      policyEnvelope: charter.envelope,
      ownerSessionRequired: false,
      startedAt: now,
      status: 'INITIALIZED',
    };

    // 1. Safety Gate: Kill switches
    if (gateConfig.isGlobalKillSwitchActive || gateConfig.isPluginKillSwitchActive) {
      context.status = 'BLOCKED_BY_GATE';
      context.blockReason = 'Emergency kill switch active. Autonomous execution halted.';
      return context;
    }

    // 2. Safety Gate: Workspace Readiness
    if (!gateConfig.isReadinessHealthy) {
      context.status = 'BLOCKED_BY_GATE';
      context.blockReason = 'Workspace connection/credentials readiness gate failed.';
      return context;
    }

    // 3. Safety Gate: Charter Status
    if (charter.status !== 'ACTIVE') {
      context.status = 'BLOCKED_BY_GATE';
      context.blockReason = `Autonomy Charter is ${charter.status}. Cannot spawn new runs.`;
      return context;
    }

    // Pre-flight passed!
    context.status = 'PREFLIGHT_PASSED';
    return context;
  }

  /**
   * Evaluates proposed action within run context.
   * If in envelope, grants inherited A3 approval.
   */
  evaluateRunAction(
    context: AutonomousRunContext,
    action: ProposedAutonomyAction,
    charter: A3AutonomyCharter
  ): {
    canProceed: boolean;
    approvalType: 'INHERITED_A3_APPROVAL' | 'MANUAL_OWNER_REQUIRED' | 'REJECTED';
    reason?: string;
  } {
    if (context.status !== 'PREFLIGHT_PASSED') {
      return {
        canProceed: false,
        approvalType: 'REJECTED',
        reason: `Cannot evaluate action on run with status: ${context.status}`,
      };
    }

    const routing = routeAutonomyAction(action, charter, context.policyEnvelope);

    if (routing.canExecuteAutonomous) {
      return {
        canProceed: true,
        approvalType: 'INHERITED_A3_APPROVAL',
      };
    }

    return {
      canProceed: false,
      approvalType: 'MANUAL_OWNER_REQUIRED',
      reason: routing.exception?.reason || routing.rejectionReason,
    };
  }
}
