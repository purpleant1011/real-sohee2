import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createWorkProposal,
  resolveUnifiedApproval,
  evaluateAutonomyLevel,
} from '../runtime/proposal-and-approval-engine';
import {
  transitionAutomationState,
  calculateNextRunTime,
} from '../runtime/automation-state-machine';
import {
  getAgentBuild,
  validateStructuredPlanSchema,
} from '../runtime/gemini-planner-registry';
import {
  evaluateDeterministicPreflight,
  engageKillSwitch,
  isKillSwitchEngaged,
} from '../runtime/deterministic-executor-gateway';
import {
  verifyExternalActionReadback,
} from '../runtime/external-verification-engine';
import {
  createEnergyLedger,
  reserveEnergy,
  settleEnergy,
} from '../runtime/agent-energy-ledger-engine';
import type {
  ApprovalEnvelope,
  AutomationDefinition,
  DeterministicPreflightChecklist,
} from '@/types/autonomous-outcome-os';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    }),
  })),
}));

describe('Milestone 2: Autonomous Runtime & MCP Capability (ANI-665 ~ ANI-673, ANI-690 ~ ANI-693)', () => {
  const mockWorkspaceId = 'ws_runtime_test_101';

  describe('ANI-665 & ANI-666: Proposals & Unified Approval Envelope (A0 to A4)', () => {
    it('creates decision-ready Work Proposal with risk ceiling and expected energy', () => {
      const proposal = createWorkProposal({
        workspaceId: mockWorkspaceId,
        goalId: 'goal_booking_september',
        title: '인스타그램 피드 & 스레드 3일 연속 예약 유치 자동화',
        rationale: '주중 14시-17시 예약 빈자리 40% 발생',
        allowedChannels: ['instagram', 'threads'],
        estimatedAgentEnergy: 250,
        maxDiscountPercentAllowed: 10,
      });

      expect(proposal.proposalId).toMatch(/^prop_/);
      expect(proposal.status).toBe('PROPOSED');
      expect(proposal.proposedEnvelope.maxDiscountPercentAllowed).toBe(10);
      expect(proposal.estimatedAgentEnergy).toBe(250);
    });

    it('enforces 100% parity: UI Inbox approval and Secondary Chat approval yield identical ApprovalEnvelope', () => {
      const proposal = createWorkProposal({
        workspaceId: mockWorkspaceId,
        goalId: 'goal_booking_september',
        title: '인스타 3일 자동화',
        rationale: '빈자리 채우기',
        allowedChannels: ['instagram'],
        estimatedAgentEnergy: 100,
        maxDiscountPercentAllowed: 10,
      });

      const envelopeFromUI = resolveUnifiedApproval({
        proposal,
        approvedByUserId: 'user_boss_kim',
        surface: 'UI_PROPOSAL_INBOX',
      });

      const envelopeFromChat = resolveUnifiedApproval({
        proposal,
        approvedByUserId: 'user_boss_kim',
        surface: 'SECONDARY_CHAT_DRAWER',
      });

      expect(envelopeFromUI.autonomyLevel).toBe('A3_ENVELOPE_AUTONOMY');
      expect(envelopeFromChat.autonomyLevel).toBe('A3_ENVELOPE_AUTONOMY');
      expect(envelopeFromUI.allowedChannels).toEqual(envelopeFromChat.allowedChannels);
      expect(envelopeFromUI.maxDiscountPercentAllowed).toBe(envelopeFromChat.maxDiscountPercentAllowed);
      expect(envelopeFromUI.maxPostsPerDay).toBe(envelopeFromChat.maxPostsPerDay);
    });

    it('allows autonomous execution within A3 Approval Envelope without prompting owner', () => {
      const envelope: ApprovalEnvelope = {
        envelopeId: 'env_123',
        workspaceId: mockWorkspaceId,
        title: '30일 인스타 자율운영',
        autonomyLevel: 'A3_ENVELOPE_AUTONOMY',
        validFrom: new Date(Date.now() - 1000).toISOString(),
        validUntil: new Date(Date.now() + 86400000 * 30).toISOString(),
        allowedChannels: ['instagram'],
        maxPostsPerDay: 2,
        maxDiscountPercentAllowed: 10,
        dmPolicy: 'AUTONOMOUS',
        maxAgentEnergyCap: 500,
        riskCeiling: 'R1_MODERATE',
        prohibitedActions: ['DELETE_ACCOUNT'],
        approvedByUserId: 'user_boss_kim',
        approvedVia: 'UI_PROPOSAL_INBOX',
        approvedAt: new Date().toISOString(),
      };

      const evalResult = evaluateAutonomyLevel(envelope, {
        channel: 'instagram',
        dailyPostCountSoFar: 1,
        requestedDiscountPercent: 10,
        actionRiskTier: 'R1_MODERATE',
      });

      expect(evalResult.allowed).toBe(true);
      expect(evalResult.requiresOwnerTouch).toBe(false);
    });

    it('blocks actions that violate Approval Envelope boundaries', () => {
      const envelope: ApprovalEnvelope = {
        envelopeId: 'env_123',
        workspaceId: mockWorkspaceId,
        title: '30일 인스타 자율운영',
        autonomyLevel: 'A3_ENVELOPE_AUTONOMY',
        validFrom: new Date(Date.now() - 1000).toISOString(),
        validUntil: new Date(Date.now() + 86400000 * 30).toISOString(),
        allowedChannels: ['instagram'],
        maxPostsPerDay: 2,
        maxDiscountPercentAllowed: 10,
        dmPolicy: 'AUTONOMOUS',
        maxAgentEnergyCap: 500,
        riskCeiling: 'R1_MODERATE',
        prohibitedActions: ['DELETE_ACCOUNT'],
        approvedByUserId: 'user_boss_kim',
        approvedVia: 'UI_PROPOSAL_INBOX',
        approvedAt: new Date().toISOString(),
      };

      // 15% discount violates 10% ceiling
      const discountViolation = evaluateAutonomyLevel(envelope, {
        channel: 'instagram',
        dailyPostCountSoFar: 1,
        requestedDiscountPercent: 15,
        actionRiskTier: 'R1_MODERATE',
      });
      expect(discountViolation.allowed).toBe(false);
      expect(discountViolation.reason).toContain('할인율 상한');

      // 3rd post violates max 2/day
      const postCountViolation = evaluateAutonomyLevel(envelope, {
        channel: 'instagram',
        dailyPostCountSoFar: 2,
        requestedDiscountPercent: 5,
        actionRiskTier: 'R1_MODERATE',
      });
      expect(postCountViolation.allowed).toBe(false);
      expect(postCountViolation.reason).toContain('일일 발행 한도');
    });
  });

  describe('ANI-667 & ANI-668: Automation State Machine & Always-On Scheduler', () => {
    it('strictly validates automation lifecycle state transitions', () => {
      expect(transitionAutomationState('DRAFT', 'APPROVED').valid).toBe(true);
      expect(transitionAutomationState('APPROVED', 'SCHEDULED').valid).toBe(true);
      expect(transitionAutomationState('SCHEDULED', 'RUNNING').valid).toBe(true);
      expect(transitionAutomationState('RUNNING', 'VERIFYING').valid).toBe(true);
      expect(transitionAutomationState('VERIFYING', 'SUCCEEDED').valid).toBe(true);

      // Disallowed jump: DRAFT cannot go directly to RUNNING
      expect(transitionAutomationState('DRAFT', 'RUNNING').valid).toBe(false);
    });

    it('calculates next execution time for recurring cron schedules', () => {
      const now = new Date('2026-09-04T09:00:00Z');
      const nextRun = calculateNextRunTime('0 14 * * *', now); // 14:00 daily
      expect(nextRun.toISOString()).toContain('T14:00:00');
    });
  });

  describe('ANI-669 & ANI-691: Gemini 3.8 Flash Planner Registry', () => {
    it('fetches registered Agent Build with gemini-3.8-flash as primary high-frequency planner', () => {
      const build = getAgentBuild('v0.9.0-gemini-flash-prod');
      expect(build.primaryPlannerModel).toBe('gemini-3.8-flash');
      expect(build.thinkingBudget).toBe('medium');
      expect(build.isCanaryActive).toBe(true);
    });

    it('validates structured plan schema and rejects plans with hallucinated tools', () => {
      const validPlan = {
        goalId: 'goal_01',
        harnessVersionId: 'harness_v1_abc',
        missions: [
          {
            id: 'm1',
            objective: '오후 빈자리 인스타그램 피드 포스팅',
            actions: [
              {
                tool: 'mcp_publish_live',
                risk_tier: 'R2_CRITICAL',
                expected_cost: 15,
              },
            ],
          },
        ],
      };
      expect(validateStructuredPlanSchema(validPlan).valid).toBe(true);

      const invalidPlan = {
        goalId: 'goal_01',
        missions: [
          {
            id: 'm1',
            actions: [{ tool: 'hallucinated_magic_hack', risk_tier: 'R0_LOW' }],
          },
        ],
      };
      expect(validateStructuredPlanSchema(invalidPlan).valid).toBe(false);
    });
  });

  describe('ANI-670, ANI-671, ANI-693: Deterministic Preflight & Hierarchical Kill Switch', () => {
    it('executes 11-step Preflight and allows execution only when all 11 pass', () => {
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

      const result = evaluateDeterministicPreflight(checklist);
      expect(result.allowed).toBe(true);
    });

    it('fails closed when any single check in the 11 steps fails', () => {
      const checklist: DeterministicPreflightChecklist = {
        workspaceLifecycleActive: true,
        agentEnergySufficient: false, // Energy depleted!
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

      const result = evaluateDeterministicPreflight(checklist);
      expect(result.allowed).toBe(false);
      expect(result.failedCheck).toBe('agentEnergySufficient');
    });

    it('enforces 5-level Hierarchical Kill Switch (GLOBAL down to CHANNEL)', () => {
      engageKillSwitch('PROVIDER_MCP', 'meta_publishing', 'Meta API 장애 발생');
      expect(isKillSwitchEngaged('PROVIDER_MCP', 'meta_publishing')).toBe(true);
      expect(isKillSwitchEngaged('CHANNEL', 'naver_blog')).toBe(false);
    });
  });

  describe('ANI-672: External Verification & Read-After-Write Receipt', () => {
    it('confirms VERIFIED only after authoritative read-after-write check succeeds', async () => {
      const verification = await verifyExternalActionReadback({
        workspaceId: mockWorkspaceId,
        providerResult: { status: 200, temporaryPostId: 'meta_post_temp_99' },
        readbackChecker: async () => ({
          isLive: true,
          permalink: 'https://instagram.com/p/C_sample_real_post',
          authoritativeId: 'ig_media_real_99',
        }),
      });

      expect(verification.isVerified).toBe(true);
      expect(verification.receipt).toBeDefined();
      expect(verification.receipt?.externalUrl).toContain('instagram.com/p/');
    });

    it('marks as RESULT_UNKNOWN and blocks duplicate retry if readback fails after write', async () => {
      const verification = await verifyExternalActionReadback({
        workspaceId: mockWorkspaceId,
        providerResult: { status: 200, temporaryPostId: 'meta_post_temp_99' },
        readbackChecker: async () => ({ isLive: false }),
      });

      expect(verification.isVerified).toBe(false);
      expect(verification.status).toBe('RESULT_UNKNOWN_RECONCILE_REQUIRED');
      expect(verification.allowImmediateRetry).toBe(false); // Zero duplicate writes!
    });
  });

  describe('ANI-673 & ANI-692: Agent Energy Ledger & FinOps Guardrails', () => {
    it('reserves and settles energy units cleanly and tracks guardrails', () => {
      const ledger = createEnergyLedger(mockWorkspaceId, 'TIER_300K_GROWTH');
      expect(ledger.monthlyTotalEnergy).toBe(3000);
      expect(ledger.remainingAvailableEnergy).toBe(3000);

      const reservation = reserveEnergy(ledger, 200);
      expect(reservation.success).toBe(true);
      expect(ledger.reservedEnergyActiveRuns).toBe(200);
      expect(ledger.remainingAvailableEnergy).toBe(2800);

      settleEnergy(ledger, reservation.reservationId, 180);
      expect(ledger.reservedEnergyActiveRuns).toBe(0);
      expect(ledger.usedEnergyCurrentMonth).toBe(180);
      expect(ledger.remainingAvailableEnergy).toBe(2820);
    });

    it('triggers budget guardrail stages at 70%, 85%, and 95%', () => {
      const ledger = createEnergyLedger(mockWorkspaceId, 'TIER_150K_STARTER'); // 1500 units
      ledger.usedEnergyCurrentMonth = 1100; // ~73%
      reserveEnergy(ledger, 10);
      expect(ledger.budgetAlertStage).toBe('STAGE_70_OPTIMIZE');

      ledger.usedEnergyCurrentMonth = 1300; // ~86%
      reserveEnergy(ledger, 10);
      expect(ledger.budgetAlertStage).toBe('STAGE_85_DEFER');

      ledger.usedEnergyCurrentMonth = 1450; // ~96%
      reserveEnergy(ledger, 10);
      expect(ledger.budgetAlertStage).toBe('STAGE_95_RESTRICT');
    });
  });
});
