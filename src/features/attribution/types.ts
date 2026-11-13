/**
 * 성과 귀속(Attribution), 헬스 및 AI 학습기 SSOT Types
 * 
 * ANI-854: Results ↔ Attribution Drill-down
 * ANI-855: Measurement Health
 * ANI-856: Attribution Confidence
 * ANI-857: Verified Outcome Learner
 */

export interface MarketingSourceEvent {
  sourceEventId: string;
  channel: string;
  campaignName?: string;
  contentAssetId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  publishedAt: string;
  headline: string;
}

/**
 * ANI-854: 성과 드릴다운 엔드투엔드 계보
 */
export interface AttributionDrilldownPath {
  attributionId: string;
  sourceEvent: MarketingSourceEvent;
  lead: {
    customerId: string;
    channel: string;
    acquiredAt: string;
  };
  booking: {
    bookingId: string;
    serviceName: string;
    slotStartTime: string;
    status: string;
  };
  revenue: {
    revenueKrw: number;
    settledAt: string;
  };
  nextBestAction: {
    actionType: string;
    recommendedTarget: string;
    reasoning: string;
    expectedImpact: string;
  };
}

/**
 * ANI-855: 성과 파이프라인 헬스 지표
 */
export type DataSourceStatus = 'HEALTHY' | 'STALE' | 'DISCONNECTED' | 'DEGRADED';

export interface SourceHealthCheck {
  sourceName: 'GA4' | 'SEARCH_CONSOLE' | 'UTM_TRACKER' | 'BOOKING_CONNECTOR' | 'PAYMENT_GATEWAY';
  status: DataSourceStatus;
  lastEventReceivedAt: string;
  stalenessHours: number;
  coverageRatePercent: number; // 0 ~ 100%
  untrackedEventsCount: number;
  remedyAction?: string;
}

export interface MeasurementHealthSummary {
  workspaceId: string;
  overallStatus: DataSourceStatus;
  healthScore: number; // 0 ~ 100
  sources: SourceHealthCheck[];
  evaluatedAt: string;
}

/**
 * ANI-856: 귀속 신뢰도 지표
 */
export type ConfidenceGrade = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AttributionConfidenceReport {
  workspaceId: string;
  confidenceGrade: ConfidenceGrade;
  confidenceScore: number; // 0 ~ 100
  identityResolutionCoveragePercent: number; // 단일 식별자로 매핑된 비율
  missingSourcePercent: number; // 출처 불명(Direct / Unknown) 비율
  verifiedRevenuePercent: number; // 결제와 연계 확인된 매출 비율
  totalAttributedRevenueKrw: number;
  flaggedAnomalies: string[];
}

export type EvidenceGrade = 'VERIFIED' | 'INFERRED' | 'INSUFFICIENT_EVIDENCE' | 'NOT_OBSERVED';

/**
 * ANI-857 / ANI-1272: 검증된 결과 기반 AI 학습기 추천 항목 (No Fabricated Metrics SSOT)
 */
export interface NextBestActionRecommendation {
  recommendationId: string;
  workspaceId: string;
  actionType: string;
  optimalPublishDayOfWeek?: number; // 1(월) ~ 7(일)
  optimalPublishHourKst?: number; // 0 ~ 23
  recommendedTopic?: string;
  targetAudienceSegment?: string;
  predictedConversionRate?: number; // 근거 부족 시 undefined
  basedOnVerifiedOutcomesCount: number; // 학습에 반영된 실제 검증된 성과 수 (Demo 제외)
  confidence?: number; // 근거 부족 시 undefined
  evidenceGrade: EvidenceGrade; // 'VERIFIED' | 'INFERRED' | 'INSUFFICIENT_EVIDENCE' | 'NOT_OBSERVED'
  confidenceBasis?: string; // 신뢰도 및 산출 알고리즘/버전 근거
  reasoning?: string; // 추천 이유 또는 근거 부족 안내
  stopCondition?: string; // 중단/재평가 조건
}

