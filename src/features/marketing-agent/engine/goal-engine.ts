import { BusinessGoal, GoalType, GoalPeriod } from "../types";

export interface CreateGoalInput {
  workspaceId: string;
  title: string;
  type: GoalType;
  period: GoalPeriod;
  targetValue: number;
  currentMeasuredValue: number;
  unit: string;
  startDate: string;
  endDate: string;
  rationale: string;
}

export function calculateGoalProgress(
  target: number,
  current: number,
  startDateStr: string,
  endDateStr: string,
  now: Date = new Date()
): {
  gap: number;
  progressPercent: number;
  remainingDays: number;
  remainingHours: number;
  isExpired: boolean;
} {
  const gap = Math.max(0, target - current);
  const progressPercent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  
  const end = new Date(endDateStr);
  const diffMs = end.getTime() - now.getTime();
  const isExpired = diffMs <= 0;
  
  const remainingDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  const remainingHours = Math.max(0, Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));

  return { gap, progressPercent, remainingDays, remainingHours, isExpired };
}

export function createBusinessGoal(input: CreateGoalInput, now: Date = new Date()): BusinessGoal {
  const { gap, progressPercent, remainingDays, remainingHours } = calculateGoalProgress(
    input.targetValue,
    input.currentMeasuredValue,
    input.startDate,
    input.endDate,
    now
  );

  return {
    id: "goal-" + Math.random().toString(36).substring(2, 9),
    workspaceId: input.workspaceId,
    title: input.title,
    type: input.type,
    period: input.period,
    targetValue: input.targetValue,
    currentValue: {
      value: input.currentMeasuredValue,
      provenance: "measured",
      sourceDescription: "매장 예약/매출 실측 데이터",
      measuredAt: now.toISOString(),
    },
    unit: input.unit,
    startDate: input.startDate,
    endDate: input.endDate,
    status: progressPercent >= 100 ? "achieved" : "active",
    remainingDays,
    remainingHours,
    gap,
    progressPercent,
    rationale: input.rationale,
  };
}
