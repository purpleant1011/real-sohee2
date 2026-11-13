import {
  WeeklyCreditSummary,
  OfficialCreditUnit,
  OFFICIAL_CREDIT_UNIT,
  CREDIT_SCHEMA_VERSION,
  SoheePlanTier,
} from './types';
import { PLAN_WEEKLY_ALLOWANCES } from '@/lib/outcome-os/commercial/weekly-credit-cycle-engine';

/**
 * KST 기준 다음 월요일 오전 09:00:00 (UTC 일요일 24:00:00 = 월요일 00:00:00 UTC) 계산 SSOT (ANI-840)
 */
export function getNextMonday9amKst(referenceDate: Date = new Date()): Date {
  // KST = UTC + 9 hours
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstTime = new Date(referenceDate.getTime() + kstOffsetMs);

  const dayOfWeek = kstTime.getUTCDay(); // 0: 일, 1: 월, ..., 6: 토
  const hours = kstTime.getUTCHours();
  const minutes = kstTime.getUTCMinutes();
  const seconds = kstTime.getUTCSeconds();

  // 다음 월요일까지 필요한 일 수
  // 만약 현재 월요일(1)이고 09:00 이전이라면 오늘 09:00이 대상
  let daysToAdd = (8 - dayOfWeek) % 7;
  if (dayOfWeek === 1 && (hours < 9 || (hours === 9 && minutes === 0 && seconds === 0))) {
    daysToAdd = 0;
  } else if (daysToAdd === 0) {
    daysToAdd = 7;
  }

  const targetKst = new Date(kstTime);
  targetKst.setUTCDate(targetKst.getUTCDate() + daysToAdd);
  targetKst.setUTCHours(9, 0, 0, 0);

  // KST -> UTC로 변환
  return new Date(targetKst.getTime() - kstOffsetMs);
}

export class WeeklyCreditManager {
  /**
   * ANI-820, ANI-825: 주간 크레딧 요약 데이터 모델 빌드
   */
  buildWeeklyCreditSummary(params: {
    workspaceId: string;
    planTier: SoheePlanTier;
    baseCredits: number;
    bonusCredits: number;
    reservedCredits: number;
    settledCredits: number;
    referenceDate?: Date;
    recentUsageHistory?: Array<{ date: string; creditsUsed: number; actionCount: number }>;
  }): WeeklyCreditSummary {
    const {
      workspaceId,
      planTier,
      baseCredits,
      bonusCredits,
      reservedCredits,
      settledCredits,
      referenceDate = new Date(),
      recentUsageHistory = [],
    } = params;

    const totalCapacity = (PLAN_WEEKLY_ALLOWANCES[planTier] || 1500) + bonusCredits;
    const availableCredits = Math.max(0, baseCredits + bonusCredits - reservedCredits);

    const burnRatePercentage =
      totalCapacity > 0
        ? Math.min(100, Math.round((settledCredits / totalCapacity) * 100))
        : 100;

    const nextResetDate = getNextMonday9amKst(referenceDate);
    const msRemaining = Math.max(0, nextResetDate.getTime() - referenceDate.getTime());
    const daysRemainingInCycle = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

    // ANI-825: Zero Credit Semantics
    const isZero = availableCredits <= 0;
    const primaryCtaText = isZero ? '소희 크레딧 충전하기' : '작업 실행하기';
    const primaryCtaUrl = isZero ? '/app/account/credits' : '/app/content-hub';

    return {
      workspaceId,
      unit: OFFICIAL_CREDIT_UNIT,
      schemaVersion: CREDIT_SCHEMA_VERSION,
      baseCredits,
      bonusCredits,
      reservedCredits,
      settledCredits,
      availableCredits,
      totalCapacity,
      burnRatePercentage,
      nextResetAt: nextResetDate.toISOString(),
      daysRemainingInCycle,
      usageHistory7d: recentUsageHistory,
      zeroCreditStatus: {
        isZero,
        primaryCtaText,
        primaryCtaUrl,
        canExecuteBillableAction: !isZero,
      },
    };
  }

  /**
   * ANI-840: 주간 주기 리셋 실행 (미사용 Base 크레딧 소멸, 신규 주간 배정)
   */
  executeWeeklyReset(params: {
    workspaceId: string;
    planTier: SoheePlanTier;
    currentBaseCredits: number;
    currentBonusCredits: number;
    currentReservedCredits: number;
  }): {
    expiredBaseCredits: number;
    newBaseCredits: number;
    bonusCreditsPreserved: number;
    resetTimestamp: string;
  } {
    const { planTier, currentBaseCredits, currentBonusCredits } = params;
    const newAllowance = PLAN_WEEKLY_ALLOWANCES[planTier] || 1500;
    const expiredBaseCredits = currentBaseCredits; // 미사용분 만료

    return {
      expiredBaseCredits,
      newBaseCredits: newAllowance,
      bonusCreditsPreserved: currentBonusCredits, // 보너스는 만료되지 않음
      resetTimestamp: new Date().toISOString(),
    };
  }
}
