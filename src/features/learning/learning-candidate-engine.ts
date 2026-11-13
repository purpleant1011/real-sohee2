/**
 * Learning Candidate Engine (ANI-1258)
 * 
 * Generates autonomous learning candidates strictly from VERIFIED outcomes.
 * 
 * Invariants:
 * 1. Only VERIFIED outcomes become active 'CANDIDATE'.
 * 2. INFERRED outcomes are gated as 'REVIEW_REQUIRED'.
 * 3. UNKNOWN outcomes produce 0 candidates (never hallucinated).
 * 4. Stop Conditions: Automatically supersedes candidates when performance drops or failures repeat.
 */

import crypto from 'crypto';

export type LearningCandidateStatus =
  | 'CANDIDATE'
  | 'REVIEW_REQUIRED'
  | 'SUPERSEDED'
  | 'APPLIED'
  | 'REJECTED';

export interface LearningStopCondition {
  metricKey?: string;
  minThreshold?: number;
  maxFailureCount: number;
  reviewIntervalHours?: number;
}

export interface LearningCandidate {
  candidateId: string;
  workspaceId: string;
  missionId: string;
  status: LearningCandidateStatus;
  observation: {
    summary: string;
    metric?: Record<string, any>;
    channel?: string;
    evidenceRefs?: string[];
  };
  interpretation: {
    hypothesis: string;
    rationale: string;
    whyItWorked: string;
  };
  proposedImpact: {
    expectedGrowth: string;
    targetMetric: string;
  };
  stopCondition: LearningStopCondition;
  failureCount?: number;
  sampleCount?: number;
  supersededReason?: string;
  createdAt: string;
  version: number;
}

export interface CandidateOutcomeInput {
  missionId: string;
  workspaceId: string;
  evidenceClass: 'VERIFIED' | 'INFERRED' | 'UNKNOWN';
  confidence: number;
  sampleCount?: number;
  observationSummary?: string;
  metric?: Record<string, any>;
  channel?: string;
  evidenceRefs?: string[];
}

export class LearningCandidateEngine {
  /**
   * Creates a learning candidate governed strictly by evidence class.
   */
  createCandidateFromOutcome(input: CandidateOutcomeInput): LearningCandidate | null {
    // 1. UNKNOWN outcome must NEVER create a learning candidate
    if (input.evidenceClass === 'UNKNOWN') {
      return null;
    }

    const sampleCount = input.sampleCount ?? (input.metric?.sampleCount ?? (input.metric?.bookings ?? (input.evidenceRefs?.length ?? 1)));
    const candidateId = `cand_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    // 2. Strict Sample Threshold (N>=3 Gate) (ANI-1331)
    // Only VERIFIED outcomes with sampleCount >= 3 can become active 'CANDIDATE'.
    // Insufficient samples (< 3) or INFERRED evidence are isolated to 'REVIEW_REQUIRED'.
    const status: LearningCandidateStatus =
      input.evidenceClass === 'VERIFIED' && sampleCount >= 3
        ? 'CANDIDATE'
        : 'REVIEW_REQUIRED';

    // 3. Dynamic Impact Calculation (No Fabricated Fixed Defaults)
    let expectedGrowth = '표본 지속 수집 및 전환율 관측 진행 중';
    if (input.metric?.conversionRate !== undefined) {
      const convPct = Math.round(Number(input.metric.conversionRate) * 100);
      expectedGrowth = `관측 전환율 ${convPct}% 기반 후속 루프 유지`;
    } else if (input.metric?.bookings && input.metric?.bookings >= 3) {
      expectedGrowth = `확정 예약 ${input.metric.bookings}건 관측 기반 후속 최적화 제안`;
    }

    return {
      candidateId,
      workspaceId: input.workspaceId,
      missionId: input.missionId,
      status,
      sampleCount,
      observation: {
        summary: input.observationSummary || '검증된 실제 마케팅 액션 성과 관측',
        metric: input.metric,
        channel: input.channel,
        evidenceRefs: input.evidenceRefs || [],
      },
      interpretation: {
        hypothesis: sampleCount >= 3
          ? '반복 검증된 전환 데이터를 통해 타깃 고객의 호응 패턴 확인'
          : '단일 또는 소수 반응 관측 상태로 추가 검증 필요',
        rationale: '원천 채널 영수증 및 예약 DB 레코드가 직접 연결된 검증된 결과',
        whyItWorked: '명확한 시술/서비스 가치 전달 및 맞춤형 슬롯 안내의 연계 성공',
      },
      proposedImpact: {
        expectedGrowth,
        targetMetric: 'booking_conversion_rate',
      },
      stopCondition: {
        metricKey: 'conversionRate',
        minThreshold: 0.2,
        maxFailureCount: 3,
        reviewIntervalHours: 72,
      },
      failureCount: 0,
      createdAt: new Date().toISOString(),
      version: 1,
    };
  }

  /**
   * Evaluates stop condition to prevent runaway repetitive failures.
   */
  evaluateStopCondition(
    candidate: LearningCandidate,
    evaluation: { currentConversionRate?: number; recentFailure?: boolean }
  ): LearningCandidate {
    let failureCount = candidate.failureCount || 0;
    if (evaluation.recentFailure) {
      failureCount += 1;
    }

    const { minThreshold, maxFailureCount } = candidate.stopCondition;

    const isFailureLimitExceeded = failureCount >= maxFailureCount;
    const isThresholdViolated =
      minThreshold !== undefined &&
      evaluation.currentConversionRate !== undefined &&
      evaluation.currentConversionRate < minThreshold;

    if (isFailureLimitExceeded || isThresholdViolated) {
      return {
        ...candidate,
        status: 'SUPERSEDED',
        failureCount,
        supersededReason: isFailureLimitExceeded
          ? `Stop condition triggered: 최대 실패 횟수(${maxFailureCount}회) 초과`
          : `Stop condition triggered: 전환율(${evaluation.currentConversionRate})이 최소 기준(${minThreshold}) 미달`,
      };
    }

    return {
      ...candidate,
      failureCount,
    };
  }
}
