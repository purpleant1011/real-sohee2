/**
 * SOHEE V0.91 · Operating Policy Manager (ANI-1403 / HF-53)
 * Pure domain functions for managing, validating, confirming, and evaluating operating policies.
 */

import {
  type OperatingPolicyRules,
  type OperatingPolicyVersion,
  type OperatingPolicyHandoffEvaluation,
  type OperatingPolicySpendEvaluation,
} from './types';

export type {
  OperatingPolicyRules,
  OperatingPolicyVersion,
  OperatingPolicyHandoffEvaluation,
  OperatingPolicySpendEvaluation,
};

export const DEFAULT_OPERATING_POLICY_RULES: OperatingPolicyRules = {
  publishApprovalLevel: 'always_require',
  requireApprovalBeforePublish: true,
  customerResponseAutomationLevel: 'draft_only',
  bookingPolicy: 'require_human_confirmation',
  maxDailyPublishCount: 2,
  allowedChannels: ['instagram', 'threads'],
  dailySpendLimitKrw: 10000,
  monthlySpendLimitKrw: 100000,
  maxCostPerActionKrw: 2000,
  emergencyStop: false,
  stopOnConsecutiveFailures: 3,
  handoffOnComplaint: true,
  handoffOnPriceInquiry: true,
  handoffOnUncertainty: true,
};

/**
 * Validate that operating policy rules meet safety constraints.
 */
export function validateOperatingPolicyRules(rules: Partial<OperatingPolicyRules>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (rules.maxDailyPublishCount !== undefined && (rules.maxDailyPublishCount < 1 || rules.maxDailyPublishCount > 20)) {
    errors.push('일일 발행 한도는 1회에서 20회 사이여야 합니다.');
  }

  if (rules.dailySpendLimitKrw !== undefined && rules.dailySpendLimitKrw < 0) {
    errors.push('일일 지출 한도는 0원 이상이어야 합니다.');
  }

  if (rules.monthlySpendLimitKrw !== undefined && rules.monthlySpendLimitKrw < 0) {
    errors.push('월간 지출 한도는 0원 이상이어야 합니다.');
  }

  if (rules.dailySpendLimitKrw !== undefined && rules.monthlySpendLimitKrw !== undefined) {
    if (rules.dailySpendLimitKrw > rules.monthlySpendLimitKrw) {
      errors.push('일일 지출 한도는 월간 지출 한도를 초과할 수 없습니다.');
    }
  }

  if (rules.maxCostPerActionKrw !== undefined && rules.maxCostPerActionKrw < 0) {
    errors.push('액션당 최대 비용은 0원 이상이어야 합니다.');
  }

  if (rules.allowedChannels !== undefined) {
    if (!Array.isArray(rules.allowedChannels) || rules.allowedChannels.length === 0) {
      errors.push('최소 하나 이상의 허용 채널이 지정되어야 합니다.');
    }
    const validChannels = ['instagram', 'threads', 'naver_blog', 'kakao_channel'];
    for (const ch of rules.allowedChannels) {
      if (!validChannels.includes(ch)) {
        errors.push(`지원되지 않는 채널입니다: ${ch}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Creates a new DRAFT operating policy.
 * Note: DRAFT status alone NEVER satisfies OPERATING_POLICY_CONFIRMED (ANI-1403 contract).
 */
export function createOperatingPolicyDraft(params: {
  workspaceId: string;
  rules?: Partial<OperatingPolicyRules>;
  baseVersionNumber?: number;
}): OperatingPolicyVersion {
  const mergedRules: OperatingPolicyRules = {
    ...DEFAULT_OPERATING_POLICY_RULES,
    ...(params.rules || {}),
  };

  // Sync boolean flag with publishApprovalLevel
  if (params.rules?.publishApprovalLevel) {
    mergedRules.requireApprovalBeforePublish = params.rules.publishApprovalLevel !== 'full_auto';
  } else if (params.rules?.requireApprovalBeforePublish !== undefined) {
    mergedRules.publishApprovalLevel = params.rules.requireApprovalBeforePublish ? 'always_require' : 'conditional_auto';
  }

  const validation = validateOperatingPolicyRules(mergedRules);
  if (!validation.valid) {
    throw new Error(`운영 정책 유효성 검사 실패: ${validation.errors.join(', ')}`);
  }

  const now = new Date().toISOString();
  const nextVersion = (params.baseVersionNumber || 0) + 1;

  return {
    id: `draft_policy_${Date.now()}`,
    workspaceId: params.workspaceId,
    ruleKey: `operating_policy_v${nextVersion}`,
    versionNumber: nextVersion,
    status: 'draft',
    rules: Object.freeze({ ...mergedRules }),
    confirmedByUserId: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Confirms a draft or proposed policy rules, transforming it into an immutable active version.
 * Requires an explicit user ID (Agent/system-only confirm is strictly prohibited by ANI-1403).
 */
export function confirmOperatingPolicy(params: {
  workspaceId: string;
  rules?: Partial<OperatingPolicyRules>;
  draft?: OperatingPolicyVersion;
  userId: string;
  currentVersionNumber?: number;
}): OperatingPolicyVersion {
  if (!params.userId || typeof params.userId !== 'string' || params.userId.trim() === '') {
    throw new Error('AUTHZ_CONFIRM_USER_REQUIRED: 운영 정책 확정은 반드시 사람 사용자의 승인이 필요합니다 (Agent 단독 확정 금지).');
  }

  let targetRules: OperatingPolicyRules;
  let versionNum: number;

  if (params.draft) {
    if (params.draft.workspaceId !== params.workspaceId) {
      throw new Error('CROSS_TENANT_POLICY_DENIED: 다른 워크스페이스의 정책 초안은 확정할 수 없습니다.');
    }
    targetRules = params.draft.rules;
    versionNum = params.draft.versionNumber;
  } else {
    targetRules = {
      ...DEFAULT_OPERATING_POLICY_RULES,
      ...(params.rules || {}),
    };
    versionNum = (params.currentVersionNumber || 0) + 1;
  }

  // Ensure requireApprovalBeforePublish and publishApprovalLevel are aligned
  if (params.rules?.publishApprovalLevel) {
    targetRules.requireApprovalBeforePublish = targetRules.publishApprovalLevel !== 'full_auto';
  }

  const validation = validateOperatingPolicyRules(targetRules);
  if (!validation.valid) {
    throw new Error(`운영 정책 유효성 검사 실패: ${validation.errors.join(', ')}`);
  }

  const now = new Date().toISOString();

  // Return immutable snapshot
  return Object.freeze({
    id: `policy_${Date.now()}_v${versionNum}`,
    workspaceId: params.workspaceId,
    ruleKey: `approval_policy_v${versionNum}`,
    versionNumber: versionNum,
    status: 'active',
    rules: Object.freeze({ ...targetRules }),
    confirmedByUserId: params.userId,
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Evaluates whether human handoff is triggered for customer interactions.
 */
export function evaluateHandoffRequired(
  rules: OperatingPolicyRules,
  context: {
    isComplaint?: boolean;
    isPriceInquiry?: boolean;
    modelConfidence?: number;
  }
): OperatingPolicyHandoffEvaluation {
  if (rules.handoffOnComplaint && context.isComplaint) {
    return {
      requiresHandoff: true,
      triggerReason: 'complaint',
      message: '고객 불만/컴플레인 감지로 인해 운영 정책에 따라 원장님/관리자에게 인계합니다.',
    };
  }

  if (rules.handoffOnPriceInquiry && context.isPriceInquiry) {
    return {
      requiresHandoff: true,
      triggerReason: 'price_inquiry',
      message: '가격 및 견적 문의는 정책에 따라 관리자가 직접 상담하도록 인계합니다.',
    };
  }

  if (rules.handoffOnUncertainty && context.modelConfidence !== undefined && context.modelConfidence < 0.8) {
    return {
      requiresHandoff: true,
      triggerReason: 'model_uncertainty',
      message: '응답 신뢰도 부족(< 80%)으로 인해 안전을 위해 사람에게 인계합니다.',
    };
  }

  return {
    requiresHandoff: false,
    message: '정책 기준을 충족하여 자동 처리를 계속합니다.',
  };
}

/**
 * Evaluates cost and spend limits before executing paid operations.
 * Fails closed if limits are exceeded.
 */
export function evaluateSpendLimit(
  rules: OperatingPolicyRules,
  params: {
    proposedCostKrw: number;
    currentDaySpendKrw: number;
    currentMonthSpendKrw?: number;
  }
): OperatingPolicySpendEvaluation {
  const { proposedCostKrw, currentDaySpendKrw, currentMonthSpendKrw = 0 } = params;

  if (proposedCostKrw > rules.maxCostPerActionKrw) {
    return {
      allowed: false,
      errorCode: 'PER_ACTION_COST_EXCEEDED',
      message: `단일 작업 비용(${proposedCostKrw.toLocaleString()}원)이 액션당 한도(${rules.maxCostPerActionKrw.toLocaleString()}원)를 초과하여 차단되었습니다.`,
      currentDaySpendKrw,
      proposedCostKrw,
      dailyLimitKrw: rules.dailySpendLimitKrw,
    };
  }

  if (currentDaySpendKrw + proposedCostKrw > rules.dailySpendLimitKrw) {
    return {
      allowed: false,
      errorCode: 'DAILY_SPEND_LIMIT_EXCEEDED',
      message: `금일 누적 비용(${(currentDaySpendKrw + proposedCostKrw).toLocaleString()}원)이 일일 지출 한도(${rules.dailySpendLimitKrw.toLocaleString()}원)를 초과하여 차단되었습니다.`,
      currentDaySpendKrw,
      proposedCostKrw,
      dailyLimitKrw: rules.dailySpendLimitKrw,
    };
  }

  if (currentMonthSpendKrw + proposedCostKrw > rules.monthlySpendLimitKrw) {
    return {
      allowed: false,
      errorCode: 'MONTHLY_SPEND_LIMIT_EXCEEDED',
      message: `당월 누적 비용(${(currentMonthSpendKrw + proposedCostKrw).toLocaleString()}원)이 월간 지출 한도(${rules.monthlySpendLimitKrw.toLocaleString()}원)를 초과하여 차단되었습니다.`,
      currentDaySpendKrw,
      proposedCostKrw,
      dailyLimitKrw: rules.dailySpendLimitKrw,
    };
  }

  return {
    allowed: true,
    message: '지출 한도 기준을 만족합니다.',
    currentDaySpendKrw,
    proposedCostKrw,
    dailyLimitKrw: rules.dailySpendLimitKrw,
  };
}
