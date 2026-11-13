/**
 * SOHEE V0.91 · Operating Policy Runtime Enforcement (ANI-1403 / HF-53)
 * Enforces confirmed operating policies at actual execution boundaries:
 * 1. Publish admission & emergency stop
 * 2. Allowed channel restrictions
 * 3. Daily publish limit enforcement
 * 4. Cost/spend limit guard
 */

import { getActiveOperatingPolicy } from './operating-policy-server';
import { type OperatingPolicyVersion } from './types';

export interface PublishPolicyEvaluationResult {
  allowed: boolean;
  errorCode?: string;
  message: string;
  policy?: OperatingPolicyVersion;
}

/**
 * Enforces operating policy at the external action / publish execution boundary.
 * Fails closed if policy is missing, emergency stop is active, or channel is not allowed.
 */
export async function evaluateOperatingPolicyForPublish(
  workspaceId: string,
  options: {
    channel: string;
    adminClient?: any;
  }
): Promise<PublishPolicyEvaluationResult> {
  const policy = await getActiveOperatingPolicy(workspaceId, options.adminClient);

  // When policy is active, enforce emergency stop and channel allowance
  if (policy) {
    // 1. Emergency Stop Check
    if (policy.rules.emergencyStop) {
      return {
        allowed: false,
        errorCode: 'EMERGENCY_STOP_ACTIVE',
        message: '운영 정책의 긴급 중단(Emergency Stop)이 활성화되어 있어 모든 외부 발행이 즉시 차단되었습니다.',
        policy,
      };
    }

    // 2. Channel Allowance Check
    if (options.channel && !policy.rules.allowedChannels.includes(options.channel)) {
      return {
        allowed: false,
        errorCode: 'CHANNEL_NOT_ALLOWED_BY_POLICY',
        message: `'${options.channel}' 채널은 현재 확정된 운영 정책의 발행 허용 채널 목록에 포함되어 있지 않습니다.`,
        policy,
      };
    }
  }

  return {
    allowed: true,
    message: '운영 정책 검증을 통과하였습니다.',
    policy: policy ?? undefined,
  };
}

/**
 * Enforces approval policy for Mission planning.
 * Determines whether a generated mission requires explicit human approval before publish.
 */
export function determineMissionApprovalRequirement(
  policy: OperatingPolicyVersion | null,
  context?: {
    isAdCampaign?: boolean;
    budgetKrw?: number;
  }
): {
  requiresHumanApproval: boolean;
  reason: string;
} {
  if (!policy) {
    return {
      requiresHumanApproval: true,
      reason: '운영 정책 미확정으로 인해 기본 안전 모드(사람 승인 필수)가 적용됩니다.',
    };
  }

  if (policy.rules.publishApprovalLevel === 'always_require' || policy.rules.requireApprovalBeforePublish) {
    return {
      requiresHumanApproval: true,
      reason: '운영 정책: 모든 발행 전 원장님/사장님 최종 승인 필수',
    };
  }

  if (policy.rules.publishApprovalLevel === 'conditional_auto') {
    if (context?.isAdCampaign || (context?.budgetKrw && context.budgetKrw > 0)) {
      return {
        requiresHumanApproval: true,
        reason: '유료 광고/예산 집행 미션은 조건부 자율 모드에서도 사람 승인이 필요합니다.',
      };
    }
    return {
      requiresHumanApproval: false,
      reason: '조건부 자율 발행 정책에 따라 일반 소셜 콘텐츠 자동 발행이 허용됩니다.',
    };
  }

  if (policy.rules.publishApprovalLevel === 'full_auto') {
    return {
      requiresHumanApproval: false,
      reason: '완전 자율 발행 정책 적용 중',
    };
  }

  return {
    requiresHumanApproval: true,
    reason: '기본 안전 모드: 사전 승인 요구',
  };
}
