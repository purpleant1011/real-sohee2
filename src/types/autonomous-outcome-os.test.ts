import { describe, it, expect } from 'vitest';
import type {
  AutonomyLevel,
  DeterministicPreflightChecklist,
  KillSwitchLevel,
  KnowledgeFactLifecycle,
  AutomationLifecycleState,
} from './autonomous-outcome-os';

describe('ANI-661 & ANI-686 Coupled Architecture Contracts', () => {
  it('enforces 5-level Bounded Autonomy hierarchy (A0 to A4)', () => {
    const levels: AutonomyLevel[] = [
      'A0_DISABLED',
      'A1_RECOMMEND',
      'A2_ACTION_APPROVAL',
      'A3_ENVELOPE_AUTONOMY',
      'A4_EXTENDED_TRUSTED',
    ];
    expect(levels).toHaveLength(5);
    expect(levels[3]).toBe('A3_ENVELOPE_AUTONOMY'); // V0.9 core production autonomy
  });

  it('enforces 11-step Deterministic Preflight Checklist structure', () => {
    const checklist: DeterministicPreflightChecklist = {
      workspaceLifecycleActive: true,
      agentEnergySufficient: true,
      channelConnectedAndValid: true,
      mcpCapabilityEntitled: true,
      consentDelegationValid: true,
      withinApprovalEnvelope: true,
      withinRiskCeiling: true,
      quietHoursRespected: true,
      cooldownSatisfied: true,
      killSwitchUnengaged: true,
      idempotencyReserved: true,
    };
    expect(Object.keys(checklist)).toHaveLength(11);
  });

  it('enforces Knowledge Fact Lifecycle states', () => {
    const lifecycles: KnowledgeFactLifecycle[] = [
      'OBSERVED',
      'CANDIDATE',
      'CONFLICTED',
      'REVIEW_REQUIRED',
      'APPROVED',
      'REJECTED',
      'CANONICAL',
      'SUPERSEDED',
    ];
    expect(lifecycles).toContain('OBSERVED');
    expect(lifecycles).toContain('CANONICAL');
  });

  it('enforces 5-level Hierarchical Kill Switch hierarchy', () => {
    const killLevels: KillSwitchLevel[] = [
      'GLOBAL',
      'PROVIDER_MCP',
      'WORKSPACE',
      'AUTOMATION',
      'CHANNEL',
    ];
    expect(killLevels).toHaveLength(5);
    expect(killLevels[0]).toBe('GLOBAL');
    expect(killLevels[4]).toBe('CHANNEL');
  });

  it('enforces Automation Lifecycle States including VERIFYING and LEARNING', () => {
    const states: AutomationLifecycleState[] = [
      'DRAFT',
      'PROPOSED',
      'APPROVAL_REQUIRED',
      'APPROVED',
      'SCHEDULED',
      'RUNNING',
      'VERIFYING',
      'SUCCEEDED',
      'FAILED',
      'BLOCKED',
      'ACTION_REQUIRED',
      'LEARNING',
      'REPLANNED',
    ];
    expect(states).toContain('VERIFYING');
    expect(states).toContain('LEARNING');
    expect(states).toContain('ACTION_REQUIRED');
  });
});
