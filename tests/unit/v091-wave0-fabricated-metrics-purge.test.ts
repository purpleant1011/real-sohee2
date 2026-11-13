import { describe, it, expect } from 'vitest';
import { VerifiedOutcomeLearner } from '@/features/attribution/verified-outcome-learner';
import { MissionContractRegistry, validateMissionContract } from '@/features/agent-os/mission-contract-registry';
import { BookingLifecycleEngine } from '@/features/crm/booking-lifecycle';

describe('V0.91 Wave 0 · ANI-1272 Legacy In-Memory & Fabricated Default Purge', () => {
  describe('VerifiedOutcomeLearner (No Fabricated Metrics / Honest Evidence Tiers)', () => {
    it('returns INSUFFICIENT_EVIDENCE when verified dataset is 0, without fabricating conversion/confidence', () => {
      const learner = new VerifiedOutcomeLearner();
      const wsId = 'ws_zero_data';

      const nba = learner.generateNextBestAction(wsId);

      // Invariant: No fabricated 3.5% or 50% confidence when 0 verified data
      expect(nba.basedOnVerifiedOutcomesCount).toBe(0);
      expect(nba.evidenceGrade).toBe('INSUFFICIENT_EVIDENCE');
      expect(nba.predictedConversionRate).toBeUndefined();
      expect(nba.confidence).toBeUndefined();
      expect(nba.reasoning).toContain('근거');
      expect(nba.stopCondition).toBeDefined();
    });

    it('returns INFERRED with explicit confidenceBasis and source outcome when real data exists', () => {
      const learner = new VerifiedOutcomeLearner();
      const wsId = 'ws_real_data';

      learner.ingestOutcomes(wsId, [
        {
          outcomeId: 'out_real_1',
          workspaceId: wsId,
          isVerifiedProduction: true,
          isDemoOrFallback: false,
          channel: 'INSTAGRAM_FEED',
          publishDayOfWeek: 3,
          publishHourKst: 14,
          topic: '자연눈썹 시술 전후 비교',
          targetAudienceSegment: '신규 고객',
          conversionsCount: 4,
          revenueKrw: 600000,
        },
      ]);

      const nba = learner.generateNextBestAction(wsId);

      expect(nba.basedOnVerifiedOutcomesCount).toBe(1);
      expect(nba.evidenceGrade).toBe('INFERRED');
      expect(nba.confidenceBasis).toBeDefined();
      expect(nba.confidenceBasis).toContain('자연눈썹');
      expect(nba.predictedConversionRate).toBeGreaterThan(0);
      expect(nba.confidence).toBeGreaterThan(0);
      expect(nba.stopCondition).toBeDefined();
    });
  });

  describe('MissionContractRegistry (Test/Pure Domain Isolation)', () => {
    it('validates contract rules deterministically without serving as production business SSOT', () => {
      const registry = new MissionContractRegistry();
      const validation = validateMissionContract({
        missionId: 'm_test_1',
        workspaceId: 'ws_test',
        version: 1,
        title: '테스트 미션',
        businessGoal: '예약 유치',
        targetOutcome: '신규 예약 5건',
        stage: 'PLAN',
        status: 'ACTIVE',
        requiredPluginIds: ['meta-connector'],
        estimatedCreditCost: 50,
        safetyRules: ['비용 한도 준수'],
        correlationId: 'corr_test_1',
      });

      expect(validation.isValid).toBe(true);
      expect(registry.isTestOrDomainOnly).toBe(true);
    });
  });

  describe('BookingLifecycleEngine (In-Memory Guard & Conflict Clarity)', () => {
    it('marks in-memory engine as pure domain calculator requiring DB-authoritative reconciliation', () => {
      const engine = new BookingLifecycleEngine();
      expect(engine.isDomainOnly).toBe(true);
    });
  });
});
