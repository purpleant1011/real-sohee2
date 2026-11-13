/**
 * Sohee V0.8.9 Trial & Credit Entitlement Engine
 * 
 * Invariants:
 * 1. 14-day Trial starts ONLY after business verification and agreements acceptance.
 * 2. Credits are strictly bucketed:
 *    - Activation Bucket: Onboarding, initial audit, first test publish.
 *    - Agent Bucket: Routine autonomous generation, comment/DM handling.
 *    - Protected WOW Bucket: First high-value customer lead/inquiry response.
 * 3. Commercial Entitlement States:
 *    - TRIAL_ACTIVE -> (PAID_PENDING | ACTIVE | GRACE | PAST_DUE | CANCEL)
 */

export const TRIAL_DURATION_DAYS = 14;

export const TRIAL_CREDIT_ALLOCATION = {
  ACTIVATION: 5000,
  AGENT: 25000,
  PROTECTED_WOW: 10000,
  TOTAL: 40000
} as const;

export type EntitlementCommercialState =
  | 'TRIAL_ACTIVE'
  | 'PAID_PENDING'
  | 'ACTIVE'
  | 'GRACE'
  | 'PAST_DUE'
  | 'CANCEL'
  | 'EXPIRED';

export type CreditBucketType = 'ACTIVATION' | 'AGENT' | 'PROTECTED_WOW' | 'PURCHASED';

export interface WorkspaceCreditState {
  workspaceId: string;
  commercialState: EntitlementCommercialState;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  activationCredits: number;
  agentCredits: number;
  protectedWowCredits: number;
  purchasedCredits: number;
  totalAvailableCredits: number;
  isGracePeriod: boolean;
  graceEndsAt?: string | null;
}

export interface CreditDeductionRequest {
  workspaceId: string;
  bucketType: CreditBucketType;
  amount: number;
  actionType: 'TEST_PUBLISH' | 'AUTONOMOUS_POST' | 'COMMENT_REPLY' | 'DM_REPLY' | 'RESERVATION_ACTION';
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface CreditDeductionResult {
  success: boolean;
  deductedAmount: number;
  remainingTotal: number;
  reason?: string;
  requiresRecharge: boolean;
}

/**
 * 신규 14일 Trial 부트스트랩
 */
export function bootstrapTrialEntitlement(workspaceId: string): WorkspaceCreditState {
  const now = new Date();
  const trialEnds = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

  return {
    workspaceId,
    commercialState: 'TRIAL_ACTIVE',
    trialStartedAt: now.toISOString(),
    trialEndsAt: trialEnds.toISOString(),
    activationCredits: TRIAL_CREDIT_ALLOCATION.ACTIVATION,
    agentCredits: TRIAL_CREDIT_ALLOCATION.AGENT,
    protectedWowCredits: TRIAL_CREDIT_ALLOCATION.PROTECTED_WOW,
    purchasedCredits: 0,
    totalAvailableCredits: TRIAL_CREDIT_ALLOCATION.TOTAL,
    isGracePeriod: false
  };
}

/**
 * 크레딧 차감 및 게이트 검사
 */
export function deductCredits(
  state: WorkspaceCreditState,
  request: CreditDeductionRequest
): { updatedState: WorkspaceCreditState; result: CreditDeductionResult } {
  // 만료 여부 확인
  if (state.trialEndsAt && state.commercialState === 'TRIAL_ACTIVE') {
    const isExpired = new Date(state.trialEndsAt).getTime() < Date.now();
    if (isExpired) {
      return {
        updatedState: {
          ...state,
          commercialState: 'EXPIRED'
        },
        result: {
          success: false,
          deductedAmount: 0,
          remainingTotal: state.totalAvailableCredits,
          reason: '14일 무료 체험 기간이 만료되었습니다.',
          requiresRecharge: true
        }
      };
    }
  }

  // 버킷 잔액 확인
  let canDeduct = false;
  let targetBucketValue = 0;

  switch (request.bucketType) {
    case 'ACTIVATION':
      targetBucketValue = state.activationCredits;
      break;
    case 'AGENT':
      targetBucketValue = state.agentCredits;
      break;
    case 'PROTECTED_WOW':
      targetBucketValue = state.protectedWowCredits;
      break;
    case 'PURCHASED':
      targetBucketValue = state.purchasedCredits;
      break;
  }

  // 버킷에 잔액이 있으면 버킷에서 차감, 없으면 전체 가용 크레딧에서 차감 시도
  if (targetBucketValue >= request.amount) {
    canDeduct = true;
  } else if (state.totalAvailableCredits >= request.amount) {
    canDeduct = true;
  }

  if (!canDeduct) {
    return {
      updatedState: state,
      result: {
        success: false,
        deductedAmount: 0,
        remainingTotal: state.totalAvailableCredits,
        reason: '크레딧 잔액이 부족합니다.',
        requiresRecharge: true
      }
    };
  }

  // 차감 실행
  let newActivation = state.activationCredits;
  let newAgent = state.agentCredits;
  let newProtected = state.protectedWowCredits;
  let newPurchased = state.purchasedCredits;
  let remainingToDeduct = request.amount;

  if (request.bucketType === 'ACTIVATION' && newActivation >= remainingToDeduct) {
    newActivation -= remainingToDeduct;
    remainingToDeduct = 0;
  } else if (request.bucketType === 'AGENT' && newAgent >= remainingToDeduct) {
    newAgent -= remainingToDeduct;
    remainingToDeduct = 0;
  } else if (request.bucketType === 'PROTECTED_WOW' && newProtected >= remainingToDeduct) {
    newProtected -= remainingToDeduct;
    remainingToDeduct = 0;
  } else if (request.bucketType === 'PURCHASED' && newPurchased >= remainingToDeduct) {
    newPurchased -= remainingToDeduct;
    remainingToDeduct = 0;
  }

  // 잔여 차감액이 남아있는 경우 일반 버킷 순서대로 차감
  if (remainingToDeduct > 0) {
    if (newActivation >= remainingToDeduct) {
      newActivation -= remainingToDeduct;
      remainingToDeduct = 0;
    } else {
      remainingToDeduct -= newActivation;
      newActivation = 0;
    }
  }

  if (remainingToDeduct > 0) {
    if (newAgent >= remainingToDeduct) {
      newAgent -= remainingToDeduct;
      remainingToDeduct = 0;
    } else {
      remainingToDeduct -= newAgent;
      newAgent = 0;
    }
  }

  if (remainingToDeduct > 0) {
    if (newPurchased >= remainingToDeduct) {
      newPurchased -= remainingToDeduct;
      remainingToDeduct = 0;
    } else {
      remainingToDeduct -= newPurchased;
      newPurchased = 0;
    }
  }

  const newTotal = newActivation + newAgent + newProtected + newPurchased;

  const updated: WorkspaceCreditState = {
    ...state,
    activationCredits: newActivation,
    agentCredits: newAgent,
    protectedWowCredits: newProtected,
    purchasedCredits: newPurchased,
    totalAvailableCredits: newTotal
  };

  return {
    updatedState: updated,
    result: {
      success: true,
      deductedAmount: request.amount,
      remainingTotal: newTotal,
      requiresRecharge: newTotal <= 0
    }
  };
}
