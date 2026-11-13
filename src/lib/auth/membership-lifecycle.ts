/**
 * Sohee V0.8.9 Membership Commercial Lifecycle State Machine
 * 
 * Invariants:
 * 1. OAUTH_AUTHENTICATED is authentication, NOT authorization.
 * 2. Execution authority requires:
 *    - Valid session
 *    - Business verification APPROVED
 *    - Required versioned agreements ACCEPTED
 *    - Valid Trial/Active entitlement
 *    - Non-exhausted credit budget
 */

export type MembershipLifecycleState =
  | 'OAUTH_AUTHENTICATED'
  | 'FORM_REQUIRED'
  | 'BUSINESS_PENDING'
  | 'APPROVED'
  | 'TRIAL_ACTIVE'
  | 'ACTIVE'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'TRIAL_EXPIRED'
  | 'CREDIT_EXHAUSTED';

export interface MembershipContext {
  userId: string;
  workspaceId: string;
  lifecycleState: MembershipLifecycleState;
  businessVerificationStatus: 'UNVERIFIED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'DOCUMENT_REQUIRED';
  agreementsAccepted: boolean;
  trialEndsAt?: string | null;
  creditBalance: number;
  isSuspended?: boolean;
}

export interface EffectiveAuthorizationResult {
  canAccessApp: boolean;
  canExecuteAutonomousAction: boolean;
  canPublishExternal: boolean;
  isReadOnly: boolean;
  requiredAction?: 'COMPLETE_FORM' | 'WAIT_BUSINESS_VERIFICATION' | 'ACCEPT_AGREEMENTS' | 'RECHARGE_CREDITS' | 'UPGRADE_SUBSCRIPTION' | 'CONTACT_SUPPORT';
  reason: string;
}

/**
 * 전이 가능한 허용 상태 맵
 */
const VALID_TRANSITIONS: Record<MembershipLifecycleState, MembershipLifecycleState[]> = {
  OAUTH_AUTHENTICATED: ['FORM_REQUIRED', 'BUSINESS_PENDING', 'SUSPENDED'],
  FORM_REQUIRED: ['BUSINESS_PENDING', 'REJECTED', 'SUSPENDED'],
  BUSINESS_PENDING: ['APPROVED', 'REJECTED', 'SUSPENDED'],
  APPROVED: ['TRIAL_ACTIVE', 'ACTIVE', 'SUSPENDED'],
  TRIAL_ACTIVE: ['ACTIVE', 'TRIAL_EXPIRED', 'CREDIT_EXHAUSTED', 'SUSPENDED'],
  ACTIVE: ['CREDIT_EXHAUSTED', 'SUSPENDED', 'TRIAL_EXPIRED'],
  REJECTED: ['FORM_REQUIRED', 'BUSINESS_PENDING'],
  SUSPENDED: ['TRIAL_ACTIVE', 'ACTIVE', 'APPROVED'],
  TRIAL_EXPIRED: ['ACTIVE', 'SUSPENDED'],
  CREDIT_EXHAUSTED: ['TRIAL_ACTIVE', 'ACTIVE', 'SUSPENDED']
};

export function canTransitionState(
  from: MembershipLifecycleState,
  to: MembershipLifecycleState
): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 실시간 멤버십 상태에 따른 실효 권한 계산
 */
export function calculateEffectiveAuthorization(
  context: MembershipContext
): EffectiveAuthorizationResult {
  if (context.isSuspended || context.lifecycleState === 'SUSPENDED') {
    return {
      canAccessApp: false,
      canExecuteAutonomousAction: false,
      canPublishExternal: false,
      isReadOnly: true,
      requiredAction: 'CONTACT_SUPPORT',
      reason: '계정이 일시 정지되었습니다. 관리자에게 문의해 주세요.'
    };
  }

  if (context.lifecycleState === 'OAUTH_AUTHENTICATED' || context.lifecycleState === 'FORM_REQUIRED') {
    return {
      canAccessApp: false,
      canExecuteAutonomousAction: false,
      canPublishExternal: false,
      isReadOnly: true,
      requiredAction: 'COMPLETE_FORM',
      reason: '정식 사업자 정보 입력 및 약관 동의가 필요합니다.'
    };
  }

  if (
    context.lifecycleState === 'BUSINESS_PENDING' ||
    context.businessVerificationStatus === 'PENDING' ||
    context.businessVerificationStatus === 'DOCUMENT_REQUIRED'
  ) {
    return {
      canAccessApp: true,
      canExecuteAutonomousAction: false,
      canPublishExternal: false,
      isReadOnly: true,
      requiredAction: 'WAIT_BUSINESS_VERIFICATION',
      reason: '사업자등록 정보 심사 중입니다. 심사 완료 후 자동 마케팅 및 외부 발행이 활성화됩니다.'
    };
  }

  if (context.lifecycleState === 'REJECTED' || context.businessVerificationStatus === 'REJECTED') {
    return {
      canAccessApp: true,
      canExecuteAutonomousAction: false,
      canPublishExternal: false,
      isReadOnly: true,
      requiredAction: 'COMPLETE_FORM',
      reason: '사업자등록 정보가 반려되었습니다. 사업자 정보를 재확인하거나 서류를 제출해 주세요.'
    };
  }

  if (!context.agreementsAccepted) {
    return {
      canAccessApp: true,
      canExecuteAutonomousAction: false,
      canPublishExternal: false,
      isReadOnly: true,
      requiredAction: 'ACCEPT_AGREEMENTS',
      reason: '필수 약관 및 AI 마케팅 에이전트 업무 위임 동의가 필요합니다.'
    };
  }

  // 14일 Trial 만료 검사
  if (context.trialEndsAt) {
    const isExpired = new Date(context.trialEndsAt).getTime() < Date.now();
    if (isExpired && context.lifecycleState !== 'ACTIVE') {
      return {
        canAccessApp: true,
        canExecuteAutonomousAction: false,
        canPublishExternal: false,
        isReadOnly: true,
        requiredAction: 'UPGRADE_SUBSCRIPTION',
        reason: '14일 무료 체험 기간이 만료되었습니다. 플랜을 구독하고 자율 마케팅을 계속 운영하세요.'
      };
    }
  }

  // 크레딧 소진 검사
  if (context.creditBalance <= 0) {
    return {
      canAccessApp: true,
      canExecuteAutonomousAction: false,
      canPublishExternal: false,
      isReadOnly: true,
      requiredAction: 'RECHARGE_CREDITS',
      reason: '소희 크레딧이 모두 소진되었습니다. 크레딧을 충전하여 자율 실행을 재개하세요.'
    };
  }

  // 정상 활성 상태 (TRIAL_ACTIVE 또는 ACTIVE)
  return {
    canAccessApp: true,
    canExecuteAutonomousAction: true,
    canPublishExternal: true,
    isReadOnly: false,
    reason: '정상 운영 중입니다.'
  };
}
