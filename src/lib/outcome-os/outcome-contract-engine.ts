import type { ObservationStatus } from '@/lib/mission-os/mission-contract';
import type {
  GoalContract,
  GoalMetricType,
  VerifiedOutcomeReceipt,
} from '@/types/autonomous-outcome-os';

export interface CreateGoalParams {
  workspaceId: string;
  title: string;
  metricType: GoalMetricType;
  targetQuantity: number;
  periodDays?: number;
  priorityScore?: number;
}

export interface ExtendedOutcomeReceipt extends VerifiedOutcomeReceipt {
  factKind: 'MEASURED' | 'CALCULATED' | 'ESTIMATED';
}

export interface WVAOMetricResult {
  workspaceId: string;
  weeklyVerifiedOutcomesCount: number | null;
  observationStatus: ObservationStatus;
  totalEnergySpent: number;
  falseSuccessRate: number | null;
  measuredReceiptsCount: number;
  excludedEstimatedCount: number;
  calculatedAt: string;
}

export function createGoalContract(params: CreateGoalParams): GoalContract {
  const { workspaceId, title, metricType, targetQuantity, periodDays = 30, priorityScore = 80 } = params;

  const now = new Date();
  const endDate = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);

  return {
    goalId: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    title,
    metricType,
    targetQuantity,
    currentProgress: 0,
    periodStart: now.toISOString(),
    periodEnd: endDate.toISOString(),
    priorityScore,
    status: 'ACTIVE',
  };
}

export function resolveVerifiedOutcome(receipt: ExtendedOutcomeReceipt): {
  isVerified: boolean;
  acceptedForNorthStar: boolean;
  metricDelta: number;
  reason?: string;
} {
  // Invariant: ESTIMATED metrics are NEVER counted as verified autonomous outcomes
  if (receipt.factKind === 'ESTIMATED') {
    return {
      isVerified: false,
      acceptedForNorthStar: false,
      metricDelta: 0,
      reason: 'ESTIMATED metrics cannot be accepted into Weekly Verified Autonomous Outcomes',
    };
  }

  if (!receipt.evidenceSourceId.trim() || !Number.isFinite(receipt.deltaAchieved)) {
    return {
      isVerified: false,
      acceptedForNorthStar: false,
      metricDelta: 0,
      reason: 'A finite outcome and evidence source are required',
    };
  }

  // 가시성·방문·후기는 중간 지표이며 문의·확정 예약으로 환산하지 않는다.
  const acceptedForNorthStar = receipt.metricType === 'INQUIRY_COUNT' || receipt.metricType === 'BOOKING_COUNT';
  return {
    isVerified: true,
    acceptedForNorthStar,
    metricDelta: acceptedForNorthStar ? receipt.deltaAchieved : 0,
  };
}

export function calculateWVAO(
  workspaceId: string,
  receipts: ExtendedOutcomeReceipt[],
  periodDays = 7
): WVAOMetricResult {
  if (!Number.isFinite(periodDays) || periodDays <= 0) {
    throw new RangeError('Outcome observation period must be finite and positive');
  }
  let weeklyVerifiedOutcomesCount = 0;
  let totalEnergySpent = 0;
  let measuredReceiptsCount = 0;
  let excludedEstimatedCount = 0;

  const now = Date.now();
  const periodStart = now - periodDays * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();

  for (const receipt of receipts) {
    // 비용·중복 판정 전에 소속을 확인해 다른 가게의 동일 ID도 섞이지 않게 한다.
    if (!workspaceId.trim() || receipt.workspaceId !== workspaceId) continue;
    const verifiedAt = Date.parse(receipt.verifiedAt);
    if (!Number.isFinite(verifiedAt) || verifiedAt < periodStart || verifiedAt > now || seen.has(receipt.receiptId)) {
      continue;
    }
    seen.add(receipt.receiptId);
    totalEnergySpent += receipt.costInAgentEnergy;

    if (receipt.factKind === 'ESTIMATED') {
      excludedEstimatedCount += 1;
      continue;
    }

    const outcome = resolveVerifiedOutcome(receipt);
    if (!outcome.acceptedForNorthStar) continue;
    weeklyVerifiedOutcomesCount += outcome.metricDelta;
    measuredReceiptsCount += 1;
  }

  return {
    workspaceId,
    weeklyVerifiedOutcomesCount: measuredReceiptsCount === 0
      ? null
      : weeklyVerifiedOutcomesCount,
    observationStatus: measuredReceiptsCount === 0
      ? 'NOT_OBSERVED'
      : weeklyVerifiedOutcomesCount === 0
        ? 'VERIFIED_ZERO'
        : 'OBSERVED',
    totalEnergySpent,
    // 성공 오판율은 독립적인 사람/도메인 검증 없이 0으로 단정하지 않는다.
    falseSuccessRate: null,
    measuredReceiptsCount,
    excludedEstimatedCount,
    calculatedAt: new Date().toISOString(),
  };
}
