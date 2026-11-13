import { NextBestActionRecommendation } from './types';

export interface VerifiedOutcomeRecord {
  outcomeId: string;
  workspaceId: string;
  isVerifiedProduction: boolean; // 프로덕션 실측 여부
  isDemoOrFallback: boolean; // 데모/폴백 여부 (배제 대상)
  channel: string;
  publishDayOfWeek: number; // 1 ~ 7
  publishHourKst: number; // 0 ~ 23
  topic: string;
  targetAudienceSegment: string;
  conversionsCount: number; // 실제 발생한 예약/전환 수
  revenueKrw: number;
}

export class VerifiedOutcomeLearner {
  private verifiedDataset: Map<string, VerifiedOutcomeRecord[]> = new Map();

  /**
   * 실제 검증된 성과만 수집 (데모/폴백 엄격 배제) (ANI-857)
   */
  ingestOutcomes(workspaceId: string, outcomes: VerifiedOutcomeRecord[]): {
    ingestedCount: number;
    rejectedNoiseCount: number;
  } {
    let ingestedCount = 0;
    let rejectedNoiseCount = 0;

    const list = this.verifiedDataset.get(workspaceId) || [];

    for (const item of outcomes) {
      // 데모이거나 프로덕션 실측이 아니면 엄격 배제 (Noise 0)
      if (item.isDemoOrFallback || !item.isVerifiedProduction) {
        rejectedNoiseCount++;
        continue;
      }

      list.push(item);
      ingestedCount++;
    }

    this.verifiedDataset.set(workspaceId, list);

    return { ingestedCount, rejectedNoiseCount };
  }

  /**
   * 학습된 실제 성과 기반 차세대 최적 액션(Next Best Action) 도출 (ANI-857 / ANI-1272)
   * V0.91 불변조건:
   * 1. 0건 검증 데이터 시 가짜 기본 전환율/신뢰도 생성 금지 (INSUFFICIENT_EVIDENCE)
   * 2. 실측 데이터 기반 추천 시 INFERRED 명시 및 confidenceBasis / stopCondition 필수 제공
   */
  generateNextBestAction(workspaceId: string): NextBestActionRecommendation {
    const dataset = this.verifiedDataset.get(workspaceId) || [];

    if (dataset.length === 0) {
      // V0.91 Canon: No Fabricated Metrics
      // 근거가 없을 때는 가짜 3.5%, 50%을 만들지 않고 INSUFFICIENT_EVIDENCE를 반환
      return {
        recommendationId: `rec_insufficient_${Date.now()}`,
        workspaceId,
        actionType: 'NONE_INSUFFICIENT_DATA',
        basedOnVerifiedOutcomesCount: 0,
        evidenceGrade: 'INSUFFICIENT_EVIDENCE',
        reasoning: '수집 및 검증된 실제 성과 데이터가 없어 추천을 추론할 수 없습니다. (근거 부족)',
        stopCondition: '실제 프로덕션 성과 1건 이상 관찰 시까지 추천 유예',
      };
    }

    // 최다 전환 성과 항목 탐색
    let bestItem = dataset[0];
    let totalConversions = 0;
    for (const item of dataset) {
      totalConversions += item.conversionsCount;
      if (item.revenueKrw > bestItem.revenueKrw) {
        bestItem = item;
      }
    }

    const avgConversionsPerRun = totalConversions / dataset.length;
    const recommendationId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const sampleConfidence = Math.min(90, Math.round(50 + Math.min(dataset.length, 8) * 5));

    return {
      recommendationId,
      workspaceId,
      actionType: `${bestItem.channel}_REPLICATE_BEST`,
      optimalPublishDayOfWeek: bestItem.publishDayOfWeek,
      optimalPublishHourKst: bestItem.publishHourKst,
      recommendedTopic: bestItem.topic,
      targetAudienceSegment: bestItem.targetAudienceSegment,
      predictedConversionRate: Number(avgConversionsPerRun.toFixed(2)),
      basedOnVerifiedOutcomesCount: dataset.length,
      confidence: sampleConfidence,
      evidenceGrade: 'INFERRED',
      confidenceBasis: `기존 ${dataset.length}건의 실제 프로덕션 성과 데이터 가중 평균 기반 추론 (최다 매출 주제: ${bestItem.topic})`,
      reasoning: `${bestItem.channel} 채널에서 '${bestItem.topic}' 주제로 ${bestItem.revenueKrw.toLocaleString()}원의 최고 매출이 검증되었습니다.`,
      stopCondition: '동일 채널 전환율 15% 이상 하락 또는 이상치 감지 시 재평가',
    };
  }
}
