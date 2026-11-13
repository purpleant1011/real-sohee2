import {
  AttributionConfidenceReport,
  ConfidenceGrade,
} from './types';

export interface ConfidenceCalculationParams {
  workspaceId: string;
  totalEventsCount: number;
  resolvedCustomerCount: number;
  unresolvedEventCount: number;
  directOrMissingSourceCount: number;
  totalAttributedRevenueKrw: number;
  verifiedPaymentRevenueKrw: number;
}

export class AttributionConfidenceCalculator {
  /**
   * 성과 귀속 데이터 품질 및 신뢰도 점수 산출 (ANI-856)
   */
  calculateConfidence(params: ConfidenceCalculationParams): AttributionConfidenceReport {
    const {
      workspaceId,
      totalEventsCount,
      resolvedCustomerCount,
      unresolvedEventCount,
      directOrMissingSourceCount,
      totalAttributedRevenueKrw,
      verifiedPaymentRevenueKrw,
    } = params;

    const anomalies: string[] = [];

    // 1. Identity Resolution Coverage 계산
    const totalIdentEvents = resolvedCustomerCount + unresolvedEventCount;
    const identityResolutionCoveragePercent =
      totalIdentEvents > 0 ? Math.round((resolvedCustomerCount / totalIdentEvents) * 100) : 100;

    // 2. Missing Source (Direct/Unknown) 비율 계산
    const missingSourcePercent =
      totalEventsCount > 0 ? Math.round((directOrMissingSourceCount / totalEventsCount) * 100) : 0;

    // 3. 결제 검증된 매출 비율
    const verifiedRevenuePercent =
      totalAttributedRevenueKrw > 0
        ? Math.min(100, Math.round((verifiedPaymentRevenueKrw / totalAttributedRevenueKrw) * 100))
        : 100;

    // 4. 종합 신뢰도 점수 계산 (0 ~ 100)
    // 가중치: Identity Coverage(40%) + Source Completeness(30%) + Verified Revenue(30%)
    const sourceCompleteness = Math.max(0, 100 - missingSourcePercent);
    const rawScore =
      identityResolutionCoveragePercent * 0.4 +
      sourceCompleteness * 0.3 +
      verifiedRevenuePercent * 0.3;
    const confidenceScore = Math.round(rawScore);

    // 5. 등급 부여
    let confidenceGrade: ConfidenceGrade = 'HIGH';
    if (confidenceScore < 60) {
      confidenceGrade = 'LOW';
      anomalies.push('귀속 신뢰도가 낮습니다: 고객 식별 누락 또는 출처 불명 유입이 절반 이상입니다.');
    } else if (confidenceScore < 80) {
      confidenceGrade = 'MEDIUM';
      anomalies.push('귀속 신뢰도가 보통입니다: 일부 채널의 UTM 태깅 누락이 감지되었습니다.');
    }

    if (missingSourcePercent > 30) {
      anomalies.push(`직접 유입/출처 불명 비율이 ${missingSourcePercent}%로 높습니다.`);
    }

    return {
      workspaceId,
      confidenceGrade,
      confidenceScore,
      identityResolutionCoveragePercent,
      missingSourcePercent,
      verifiedRevenuePercent,
      totalAttributedRevenueKrw,
      flaggedAnomalies: anomalies,
    };
  }
}
