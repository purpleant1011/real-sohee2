import { describe, it, expect } from 'vitest';
import { ResultsAttributionDrilldownService } from '@/features/attribution/results-attribution-drilldown';
import { MeasurementHealthService } from '@/features/attribution/measurement-health';
import { AttributionConfidenceCalculator } from '@/features/attribution/attribution-confidence';
import { VerifiedOutcomeLearner } from '@/features/attribution/verified-outcome-learner';

describe('V0.9 Wave 4: Attribution & Learning Core Tests', () => {
  // ANI-854: Results ↔ Attribution Drill-down
  it('ANI-854: ResultsAttributionDrilldownService connects source event to lead, booking, revenue, and next action', () => {
    const service = new ResultsAttributionDrilldownService();
    const wsId = 'ws_attr_1';

    const path = service.createDrilldownPath({
      workspaceId: wsId,
      sourceEvent: {
        sourceEventId: 'evt_ig_fall_01',
        channel: 'INSTAGRAM_FEED',
        headline: '가을 시그니처 베이지 염색',
        publishedAt: '2026-09-01T10:00:00Z',
        utmSource: 'instagram',
        utmCampaign: 'fall_hair_2026',
      },
      lead: {
        customerId: 'cust_lead_01',
        channel: 'INSTAGRAM_DM',
        acquiredAt: '2026-09-01T11:30:00Z',
      },
      booking: {
        bookingId: 'book_lead_01',
        serviceName: '시그니처 베이지 염색',
        slotStartTime: '2026-09-03T15:00:00Z',
        status: 'VISITED',
      },
      revenue: {
        revenueKrw: 120000,
        settledAt: '2026-09-03T16:30:00Z',
      },
    });

    expect(path.attributionId).toBeDefined();
    expect(path.nextBestAction.actionType).toBe('SIMILAR_CONTENT_SCALE_UP');

    const retrieved = service.getDrilldown(path.attributionId);
    expect(retrieved?.revenue.revenueKrw).toBe(120000);
  });

  // ANI-855: Measurement Health
  it('ANI-855: MeasurementHealthService evaluates 5 data sources freshness and coverage', () => {
    const healthService = new MeasurementHealthService();
    const wsId = 'ws_health_1';

    const report = healthService.evaluateHealth({
      workspaceId: wsId,
      sourceMetrics: [
        {
          sourceName: 'GA4',
          lastEventReceivedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2시간 전
          coverageRatePercent: 95,
          untrackedEventsCount: 2,
        },
        {
          sourceName: 'UTM_TRACKER',
          lastEventReceivedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
          coverageRatePercent: 92,
          untrackedEventsCount: 5,
        },
        {
          sourceName: 'BOOKING_CONNECTOR',
          lastEventReceivedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          coverageRatePercent: 98,
          untrackedEventsCount: 0,
        },
      ],
    });

    expect(report.overallStatus).toBe('HEALTHY');
    expect(report.healthScore).toBeGreaterThanOrEqual(90);
  });

  // ANI-856: Attribution Confidence
  it('ANI-856: AttributionConfidenceCalculator generates confidence scores and grades based on identity coverage and missing source', () => {
    const calculator = new AttributionConfidenceCalculator();

    // 높은 품질 케이스
    const highReport = calculator.calculateConfidence({
      workspaceId: 'ws_conf_1',
      totalEventsCount: 100,
      resolvedCustomerCount: 90,
      unresolvedEventCount: 10,
      directOrMissingSourceCount: 5,
      totalAttributedRevenueKrw: 1000000,
      verifiedPaymentRevenueKrw: 980000,
    });

    expect(highReport.confidenceGrade).toBe('HIGH');
    expect(highReport.confidenceScore).toBeGreaterThanOrEqual(80);

    // 출처 불명이 많고 식별되지 않은 낮은 품질 케이스
    const lowReport = calculator.calculateConfidence({
      workspaceId: 'ws_conf_2',
      totalEventsCount: 100,
      resolvedCustomerCount: 30,
      unresolvedEventCount: 70,
      directOrMissingSourceCount: 60,
      totalAttributedRevenueKrw: 500000,
      verifiedPaymentRevenueKrw: 200000,
    });

    expect(lowReport.confidenceGrade).toBe('LOW');
    expect(lowReport.flaggedAnomalies.length).toBeGreaterThan(0);
  });

  // ANI-857: Verified Outcome Learner
  it('ANI-857: VerifiedOutcomeLearner strictly excludes demo/mock noise and trains only on verified real outcomes', () => {
    const learner = new VerifiedOutcomeLearner();
    const wsId = 'ws_learn_1';

    // 성과 데이터 수집 (데모 2건, 실제 3건)
    const ingestResult = learner.ingestOutcomes(wsId, [
      {
        outcomeId: 'out_demo_1',
        workspaceId: wsId,
        isVerifiedProduction: true,
        isDemoOrFallback: true, // 데모 데이터 -> 배제 대상
        channel: 'INSTAGRAM_FEED',
        publishDayOfWeek: 1,
        publishHourKst: 10,
        topic: '모의 테스트 콘텐츠',
        targetAudienceSegment: '신규',
        conversionsCount: 1,
        revenueKrw: 50000,
      },
      {
        outcomeId: 'out_real_1',
        workspaceId: wsId,
        isVerifiedProduction: true,
        isDemoOrFallback: false, // 실제 검증 데이터
        channel: 'INSTAGRAM_FEED',
        publishDayOfWeek: 3, // 수요일
        publishHourKst: 18, // 18시
        topic: '가을 시그니처 펌 스타일',
        targetAudienceSegment: '재방문 고객',
        conversionsCount: 5,
        revenueKrw: 450000,
      },
      {
        outcomeId: 'out_real_2',
        workspaceId: wsId,
        isVerifiedProduction: true,
        isDemoOrFallback: false, // 실제 검증 데이터
        channel: 'NAVER_BLOG',
        publishDayOfWeek: 4, // 목요일
        publishHourKst: 11, // 11시
        topic: '복구 클리닉 전후 비교',
        targetAudienceSegment: '탈색 손상모 타겟',
        conversionsCount: 8,
        revenueKrw: 800000,
      },
    ]);

    expect(ingestResult.ingestedCount).toBe(2);
    expect(ingestResult.rejectedNoiseCount).toBe(1);

    // 차세대 최적 액션 도출
    const nba = learner.generateNextBestAction(wsId);
    expect(nba.basedOnVerifiedOutcomesCount).toBe(2);
    // 가장 매출이 높았던 네이버 블로그 복구 클리닉 패턴 기반 추천 확인
    expect(nba.actionType).toBe('NAVER_BLOG_REPLICATE_BEST');
    expect(nba.recommendedTopic).toBe('복구 클리닉 전후 비교');
    expect(nba.optimalPublishDayOfWeek).toBe(4);
  });
});
