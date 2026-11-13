import {
  ActionCostQuote,
  TripartiteCostPolicy,
  SoheePlanTier,
  OFFICIAL_CREDIT_UNIT,
} from './types';

/**
 * 기본 표준 액션별 소희 크레딧 단가표 (SSOT)
 */
export const STANDARD_ACTION_CREDIT_COSTS: Record<string, { cost: number; durationMs: number }> = {
  INSTAGRAM_POST_GENERATE: { cost: 100, durationMs: 4500 },
  NAVER_BLOG_LONG_GENERATE: { cost: 250, durationMs: 8000 },
  CARROT_LOCAL_FEED_GENERATE: { cost: 80, durationMs: 3000 },
  THREADS_SHORT_GENERATE: { cost: 50, durationMs: 2500 },
  IMAGE_STUDIO_HD_RENDER: { cost: 150, durationMs: 12000 },
  LOOKBOOK_SCRAPE_HARNESS: { cost: 120, durationMs: 6000 },
  SNS_DIRECT_PUBLISH: { cost: 50, durationMs: 3500 },
  AUTONOMOUS_OPPORTUNITY_DETECT: { cost: 30, durationMs: 1500 },
};

export class ActionCostQuoteEngine {
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 15 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Action Cost Quote 생성 (ANI-824)
   */
  createQuote(params: {
    workspaceId: string;
    actionType: string;
    customCredits?: number;
    customDurationMs?: number;
    ttlMs?: number;
  }): ActionCostQuote {
    const { workspaceId, actionType, customCredits, customDurationMs, ttlMs } = params;
    const standard = STANDARD_ACTION_CREDIT_COSTS[actionType] || { cost: 100, durationMs: 5000 };

    const requiredCredits = customCredits !== undefined ? customCredits : standard.cost;
    const estimatedDurationMs = customDurationMs !== undefined ? customDurationMs : standard.durationMs;
    const now = Date.now();
    const durationTtl = ttlMs || this.defaultTtlMs;

    const quoteId = `quote_${now}_${Math.random().toString(36).slice(2, 9)}`;

    return {
      quoteId,
      workspaceId,
      actionType,
      requiredCredits,
      estimatedDurationMs,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + durationTtl).toISOString(),
      isExpired: false,
      tripartiteClassification: 'SOHEE_CREDIT',
    };
  }

  /**
   * 견적 유효성 및 잔액 사전 검사 (ANI-824, ANI-825)
   */
  validateAndCheckAffordability(
    quote: ActionCostQuote,
    availableCredits: number
  ): {
    isValid: boolean;
    canAfford: boolean;
    reason?: string;
    deficitCredits?: number;
  } {
    const isExpired = new Date(quote.expiresAt).getTime() <= Date.now();
    if (isExpired) {
      return {
        isValid: false,
        canAfford: false,
        reason: `견적이 만료되었습니다. 새로 발행해주세요. (quoteId: ${quote.quoteId})`,
      };
    }

    if (availableCredits < quote.requiredCredits) {
      return {
        isValid: true,
        canAfford: false,
        reason: `사용 가능한 소희 크레딧이 부족합니다. (필요: ${quote.requiredCredits}, 보유: ${availableCredits})`,
        deficitCredits: quote.requiredCredits - availableCredits,
      };
    }

    return {
      isValid: true,
      canAfford: true,
    };
  }
}

/**
 * ANI-823: 3대 정책 팩토리
 */
export function createTripartiteCostPolicy(planTier: SoheePlanTier): TripartiteCostPolicy {
  switch (planTier) {
    case 'TIER_500K_PRO_SCALE':
      return {
        policyVersion: 2,
        entitlement: {
          planTier,
          featuresEnabled: ['AUTONOMOUS_MARKETING', 'MULTI_CHANNEL', 'LOOKBOOK_CRAWLER', 'DEDICATED_SLA'],
          maxConcurrentActionRuns: 10,
          supportSlaHours: 1,
        },
        soheeCredit: {
          unit: OFFICIAL_CREDIT_UNIT,
          weeklyAllowance: 6500,
          ratePerActionRun: 1.0,
          overageAllowed: false,
        },
        externalAdSpend: {
          isDirectlyBilledByPlatform: true,
          adAccountLinked: true,
          budgetCapKrw: 5000000,
          platformFeeRate: 0,
        },
      };

    case 'TIER_300K_GROWTH':
      return {
        policyVersion: 2,
        entitlement: {
          planTier,
          featuresEnabled: ['AUTONOMOUS_MARKETING', 'MULTI_CHANNEL', 'LOOKBOOK_CRAWLER'],
          maxConcurrentActionRuns: 5,
          supportSlaHours: 4,
        },
        soheeCredit: {
          unit: OFFICIAL_CREDIT_UNIT,
          weeklyAllowance: 3500,
          ratePerActionRun: 1.0,
          overageAllowed: false,
        },
        externalAdSpend: {
          isDirectlyBilledByPlatform: true,
          adAccountLinked: true,
          budgetCapKrw: 2000000,
          platformFeeRate: 0,
        },
      };

    case 'TIER_150K_STARTER':
      return {
        policyVersion: 2,
        entitlement: {
          planTier,
          featuresEnabled: ['AUTONOMOUS_MARKETING', 'INSTAGRAM_PUBLISH'],
          maxConcurrentActionRuns: 2,
          supportSlaHours: 24,
        },
        soheeCredit: {
          unit: OFFICIAL_CREDIT_UNIT,
          weeklyAllowance: 1500,
          ratePerActionRun: 1.0,
          overageAllowed: false,
        },
        externalAdSpend: {
          isDirectlyBilledByPlatform: true,
          adAccountLinked: false,
          budgetCapKrw: 500000,
          platformFeeRate: 0,
        },
      };

    case 'FREE_TASTE':
    default:
      return {
        policyVersion: 2,
        entitlement: {
          planTier: 'FREE_TASTE',
          featuresEnabled: ['SINGLE_RUN_EXPERIENCE'],
          maxConcurrentActionRuns: 1,
          supportSlaHours: 72,
        },
        soheeCredit: {
          unit: OFFICIAL_CREDIT_UNIT,
          weeklyAllowance: 50,
          ratePerActionRun: 1.0,
          overageAllowed: false,
        },
        externalAdSpend: {
          isDirectlyBilledByPlatform: true,
          adAccountLinked: false,
          budgetCapKrw: 0,
          platformFeeRate: 0,
        },
      };
  }
}
