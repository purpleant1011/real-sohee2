import { describe, it, expect } from 'vitest';
import {
  compileWorkspaceHarness,
  createDefaultHarnessInput,
} from '../harness-compiler';
import {
  ingestObservedFact,
  promoteCandidateFact,
} from '../knowledge-promotion-engine';
import {
  createGoalContract,
  calculateWVAO,
} from '../outcome-contract-engine';
import {
  calculateHarnessDiff,
  detectImpactedAutomations,
} from '../admin-harness-registry';
import type {
  VerifiedOutcomeReceipt,
  AutomationDefinition,
} from '@/types/autonomous-outcome-os';

describe('Milestone 1: Knowledge Harness & Outcome Model (ANI-662 ~ ANI-664, ANI-689)', () => {
  const mockWorkspaceId = 'ws_test_gangnam_beauty';

  describe('ANI-662: Workspace Knowledge Harness Compiler & Versioning', () => {
    it('compiles raw business inputs into an immutable versioned Knowledge Harness', () => {
      const input = createDefaultHarnessInput(mockWorkspaceId, {
        businessName: '강남 바이름 뷰티살롱',
        operatingHours: '10:00 - 20:00',
        brandTone: 'WARM_POLITE',
        maxDiscountPercent: 10,
      });

      const harness = compileWorkspaceHarness(input, 1);

      expect(harness.workspaceId).toBe(mockWorkspaceId);
      expect(harness.versionNo).toBe(1);
      expect(harness.harnessVersionId).toMatch(/^harness_v1_[a-f0-9]{8}$/);
      expect(harness.isActive).toBe(true);
      expect(harness.businessIdentity.businessName).toBe('강남 바이름 뷰티살롱');
      expect(harness.brandVoice.tone).toBe('WARM_POLITE');
      expect(harness.policies.maxDiscountPercent).toBe(10);
      expect(Object.isFrozen(harness)).toBe(true);
    });

    it('increments version and generates distinct hash when policies or facts change', () => {
      const input1 = createDefaultHarnessInput(mockWorkspaceId, { maxDiscountPercent: 10 });
      const harness1 = compileWorkspaceHarness(input1, 1);

      const input2 = createDefaultHarnessInput(mockWorkspaceId, { maxDiscountPercent: 15 });
      const harness2 = compileWorkspaceHarness(input2, 2);

      expect(harness2.versionNo).toBe(2);
      expect(harness2.harnessVersionId).not.toBe(harness1.harnessVersionId);
      expect(harness2.policies.maxDiscountPercent).toBe(15);
    });
  });

  describe('ANI-663: Knowledge Promotion & Conflict Engine', () => {
    it('isolates new external observation as CANDIDATE and never overwrites CANONICAL directly', () => {
      const existingCanonicalFacts: Record<string, string> = {
        'operating_hours': '10:00 - 20:00',
      };

      // External web scraping observes contradictory operating hours
      const transition = ingestObservedFact({
        workspaceId: mockWorkspaceId,
        factKey: 'operating_hours',
        observedValue: '11:00 - 22:00',
        provenance: {
          sourceId: 'web_scrape_naver_map',
          sourceType: 'WEB_INSPECTION',
          extractedAt: new Date().toISOString(),
          confidenceScore: 0.75,
        },
        currentCanonicalValue: existingCanonicalFacts['operating_hours'],
      });

      expect(transition.lifecycle).toBe('CONFLICTED');
      expect(transition.requiresReview).toBe(true);
      expect(transition.canonicalUnchanged).toBe(true);
    });

    it('requires explicit owner/admin approval to promote conflicting fact to CANONICAL', () => {
      const approved = promoteCandidateFact({
        workspaceId: mockWorkspaceId,
        factKey: 'operating_hours',
        proposedValue: '11:00 - 22:00',
        decision: 'APPROVE',
        reviewedBy: 'usr_owner_kim',
      });

      expect(approved.lifecycle).toBe('CANONICAL');
      expect(approved.effectiveValue).toBe('11:00 - 22:00');
      expect(approved.triggerRecompile).toBe(true);
    });

    it('rejects candidate observation gracefully when dismissed', () => {
      const rejected = promoteCandidateFact({
        workspaceId: mockWorkspaceId,
        factKey: 'operating_hours',
        proposedValue: '09:00 - 24:00',
        decision: 'REJECT',
        reviewedBy: 'usr_owner_kim',
      });

      expect(rejected.lifecycle).toBe('REJECTED');
      expect(rejected.triggerRecompile).toBe(false);
    });
  });

  describe('ANI-664: Goal & Outcome Contract Engine (WVAO North Star)', () => {
    it('creates structured Goal Contracts with target outcome metrics', () => {
      const goal = createGoalContract({
        workspaceId: mockWorkspaceId,
        title: '9월 평일 낮 시간대 예약 증대',
        metricType: 'BOOKING_COUNT',
        targetQuantity: 30,
        periodDays: 30,
        priorityScore: 90,
      });

      expect(goal.metricType).toBe('BOOKING_COUNT');
      expect(goal.targetQuantity).toBe(30);
      expect(goal.status).toBe('ACTIVE');
    });

    it('strictly separates MEASURED outcomes from ESTIMATED metrics in North Star calculation', () => {
      const receipts: Array<VerifiedOutcomeReceipt & { factKind: 'MEASURED' | 'CALCULATED' | 'ESTIMATED' }> = [
        {
          workspaceId: mockWorkspaceId,
          receiptId: 'rcpt_01',
          goalId: 'goal_booking',
          automationRunId: 'run_101',
          metricType: 'BOOKING_COUNT',
          deltaAchieved: 3,
          evidenceSourceId: 'instagram_dm_reservation_verified',
          verifiedAt: new Date().toISOString(),
          costInAgentEnergy: 120,
          factKind: 'MEASURED',
        },
        {
          workspaceId: mockWorkspaceId,
          receiptId: 'rcpt_02',
          goalId: 'goal_inquiry',
          automationRunId: 'run_102',
          metricType: 'INQUIRY_COUNT',
          deltaAchieved: 5,
          evidenceSourceId: 'threads_comment_inquiry_readback',
          verifiedAt: new Date().toISOString(),
          costInAgentEnergy: 80,
          factKind: 'MEASURED',
        },
        {
          workspaceId: mockWorkspaceId,
          receiptId: 'rcpt_03',
          goalId: 'goal_reach',
          automationRunId: 'run_103',
          metricType: 'BRAND_AWARENESS_ENGAGEMENT',
          deltaAchieved: 1500,
          evidenceSourceId: 'estimated_algorithmic_reach_projection',
          verifiedAt: new Date().toISOString(),
          costInAgentEnergy: 40,
          factKind: 'ESTIMATED', // Must NOT count towards verified autonomous outcomes!
        },
      ];

      const wvao = calculateWVAO(mockWorkspaceId, receipts, 7);

      expect(wvao.weeklyVerifiedOutcomesCount).toBe(8); // 3 bookings + 5 inquiries (1500 estimated excluded)
      expect(wvao.totalEnergySpent).toBe(240);
      expect(wvao.falseSuccessRate).toBeNull();
      expect(wvao.observationStatus).toBe('OBSERVED');
      expect(wvao.measuredReceiptsCount).toBe(2);
      expect(wvao.excludedEstimatedCount).toBe(1);
    });
  });

  describe('ANI-689: Admin Harness & Automation Registry', () => {
    it('computes structured diff between Harness versions', () => {
      const harnessV1 = compileWorkspaceHarness(
        createDefaultHarnessInput(mockWorkspaceId, { maxDiscountPercent: 10, brandTone: 'WARM_POLITE' }),
        1
      );
      const harnessV2 = compileWorkspaceHarness(
        createDefaultHarnessInput(mockWorkspaceId, { maxDiscountPercent: 15, brandTone: 'CALM_PROFESSIONAL' }),
        2
      );

      const diff = calculateHarnessDiff(harnessV1, harnessV2);

      expect(diff.hasChanges).toBe(true);
      expect(diff.changedPolicyKeys).toContain('maxDiscountPercent');
      expect(diff.changedVoiceKeys).toContain('tone');
    });

    it('identifies impacted automations when policy rules change', () => {
      const automations: Partial<AutomationDefinition>[] = [
        {
          automationId: 'auto_insta_promo',
          targetChannels: ['instagram'],
          harnessVersionId: 'harness_v1_old',
          currentState: 'SCHEDULED',
        },
      ];

      const diff = {
        hasChanges: true,
        changedPolicyKeys: ['maxDiscountPercent'],
        changedVoiceKeys: [],
      };

      const impacted = detectImpactedAutomations(diff, automations as AutomationDefinition[]);

      expect(impacted).toHaveLength(1);
      expect(impacted[0].automationId).toBe('auto_insta_promo');
      expect(impacted[0].recommendedAction).toBe('REEVALUATE_AND_REPLAN');
    });
  });
});
