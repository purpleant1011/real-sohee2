import { describe, expect, it } from 'vitest';
import { MeasurementFoundation } from '../measurement/measurement-foundation';
import { CrossChannelAttributionEngine, Touchpoint } from '../attribution/cross-channel-attribution-engine';
import { GrowthLearnerEngine, NextBestActionCandidate } from '../learning/growth-learner-engine';

describe('Wave 4 Attribution & Learning Engine', () => {
  describe('ANI-786: MeasurementFoundation', () => {
    it('ingests canonical events, drops duplicates, and maintains source health', () => {
      const mf = new MeasurementFoundation();

      // Check initial state
      expect(mf.getSourceHealth('GA4').status).toBe('UNKNOWN');

      const res1 = mf.ingestEvent({
        eventId: 'ev-1',
        workspaceId: 'ws-100',
        anonymousId: 'anon-1',
        eventType: 'PAGE_VIEW',
        valueKRW: 0,
        occurredAt: '2026-09-05T10:00:00Z',
        receivedAt: '2026-09-05T10:00:01Z',
        source: 'GA4',
        dedupeKey: 'dedupe-ga4-1',
      });
      expect(res1.accepted).toBe(true);
      expect(mf.getSourceHealth('GA4').status).toBe('HEALTHY');

      // Duplicate submission
      const resDup = mf.ingestEvent({
        eventId: 'ev-1-dup',
        workspaceId: 'ws-100',
        anonymousId: 'anon-1',
        eventType: 'PAGE_VIEW',
        valueKRW: 0,
        occurredAt: '2026-09-05T10:00:00Z',
        receivedAt: '2026-09-05T10:00:05Z',
        source: 'GA4',
        dedupeKey: 'dedupe-ga4-1',
      });
      expect(resDup.accepted).toBe(false);
      expect(resDup.reason).toBe('DUPLICATE_EVENT_DROPPED');
    });

    it('performs append-only reconciliation for refunds and updates net revenue', () => {
      const mf = new MeasurementFoundation();

      mf.ingestEvent({
        eventId: 'ev-purchase',
        workspaceId: 'ws-100',
        anonymousId: 'anon-cust',
        eventType: 'PURCHASE',
        valueKRW: 100_000,
        occurredAt: '2026-09-05T11:00:00Z',
        receivedAt: '2026-09-05T11:00:01Z',
        source: 'FIRST_PARTY_WEBHOOK',
        dedupeKey: 'order-1001',
      });

      expect(mf.getNetRevenueKRW('ws-100')).toBe(100_000);

      // Partial refund append-only
      mf.recordReconciliationRevision('ev-purchase', 'REFUND', 30_000, 'ws-100');

      expect(mf.getNetRevenueKRW('ws-100')).toBe(70_000);
      const events = mf.getEvents('ws-100');
      expect(events).toHaveLength(2);
      expect(events[1].isReconciliationRevision).toBe(true);
      expect(events[1].reconciliationRefEventId).toBe('ev-purchase');
    });
  });

  describe('ANI-772: CrossChannelAttributionEngine', () => {
    const touchpoints: Touchpoint[] = [
      { touchpointId: 'tp-1', channel: 'instagram', campaignId: 'camp-spring', isDirect: false, timestamp: '2026-09-01T10:00:00Z', pluginId: 'postiz-plugin' },
      { touchpointId: 'tp-2', channel: 'naver_search_ads', campaignId: 'camp-spring', isDirect: false, timestamp: '2026-09-02T12:00:00Z' },
      { touchpointId: 'tp-3', channel: 'direct', campaignId: 'camp-spring', isDirect: true, timestamp: '2026-09-03T15:00:00Z' },
    ];

    it('calculates FIRST_TOUCH attribution correctly', () => {
      const engine = new CrossChannelAttributionEngine();
      const shares = engine.calculateAttribution(100_000, 'FIRST_TOUCH', touchpoints);

      expect(shares).toHaveLength(1);
      expect(shares[0].channel).toBe('instagram');
      expect(shares[0].attributedRevenueKRW).toBe(100_000);
      expect(shares[0].sharePercentage).toBe(100);
    });

    it('calculates LAST_NON_DIRECT attribution correctly', () => {
      const engine = new CrossChannelAttributionEngine();
      const shares = engine.calculateAttribution(100_000, 'LAST_NON_DIRECT', touchpoints);

      expect(shares).toHaveLength(1);
      expect(shares[0].channel).toBe('naver_search_ads');
      expect(shares[0].attributedRevenueKRW).toBe(100_000);
    });

    it('calculates LINEAR attribution correctly', () => {
      const engine = new CrossChannelAttributionEngine();
      const shares = engine.calculateAttribution(90_000, 'LINEAR', touchpoints);

      expect(shares).toHaveLength(3);
      expect(shares[0].attributedRevenueKRW).toBe(30_000);
      expect(shares[1].attributedRevenueKRW).toBe(30_000);
      expect(shares[2].attributedRevenueKRW).toBe(30_000);
    });

    it('calculates POSITION_BASED attribution correctly (40/20/40)', () => {
      const engine = new CrossChannelAttributionEngine();
      const shares = engine.calculateAttribution(100_000, 'POSITION_BASED', touchpoints);

      expect(shares).toHaveLength(3);
      expect(shares[0].attributedRevenueKRW).toBe(40_000); // 40% First
      expect(shares[1].attributedRevenueKRW).toBe(20_000); // 20% Middle
      expect(shares[2].attributedRevenueKRW).toBe(40_000); // 40% Last
    });
  });

  describe('ANI-773: GrowthLearnerEngine', () => {
    it('stores and retrieves active learning memories based on validity window', () => {
      const learner = new GrowthLearnerEngine();

      learner.storeLearningMemory({
        memoryId: 'mem-1',
        workspaceId: 'ws-100',
        finding: '청라 지역 평일 오후 당일예약 CTA 반응률 3.2배 높음',
        supportingEvidence: 'camp-spring 120 conversations analyzed',
        affectedChannel: 'instagram',
        confidenceScore: 92,
        validFrom: '2026-01-01T00:00:00Z',
        expiresAt: '2026-12-31T23:59:59Z',
        recommendedRule: 'REUSE',
      });

      // Expired memory
      learner.storeLearningMemory({
        memoryId: 'mem-expired',
        workspaceId: 'ws-100',
        finding: '과거 만료된 규칙',
        supportingEvidence: 'old data',
        confidenceScore: 50,
        validFrom: '2025-01-01T00:00:00Z',
        expiresAt: '2025-12-31T23:59:59Z',
        recommendedRule: 'AVOID',
      });

      const active = learner.getActiveLearnings('ws-100');
      expect(active).toHaveLength(1);
      expect(active[0].memoryId).toBe('mem-1');
    });

    it('scores and ranks Next-Best-Action candidates deterministically using 8-dimension model', () => {
      const learner = new GrowthLearnerEngine();

      const candidateA: NextBestActionCandidate = {
        actionId: 'act-high-impact',
        title: '인스타그램 당일 예약 프로모션 스토리 발행',
        channel: 'instagram',
        description: '오후 시간대 예약 슬롯 마감 유도',
        expectedImpact: 90,
        confidence: 85,
        costEfficiency: 95,
        riskPenalty: 10,
        latencyScore: 90,
        reversibility: 80,
        measurementReadiness: 90,
        userPriority: 90,
      };

      const candidateB: NextBestActionCandidate = {
        actionId: 'act-high-risk',
        title: '신규 고위험 유료 키워드 대량 확장',
        channel: 'naver_search_ads',
        description: 'CPC가 높은 단어 입찰',
        expectedImpact: 60,
        confidence: 40,
        costEfficiency: 30,
        riskPenalty: 80, // Heavy risk deduction
        latencyScore: 50,
        reversibility: 40,
        measurementReadiness: 50,
        userPriority: 40,
      };

      const ranked = learner.scoreNextBestActions([candidateB, candidateA]);

      expect(ranked).toHaveLength(2);
      expect(ranked[0].candidate.actionId).toBe('act-high-impact');
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].candidate.actionId).toBe('act-high-risk');
      expect(ranked[1].rank).toBe(2);
      expect(ranked[0].compositeScore).toBeGreaterThan(ranked[1].compositeScore);
    });
  });
});
