/**
 * SOHEE V0.91 · Operating Policy Contract Types (ANI-1403 / HF-53)
 * Defines the canonical data contract, versioning, and status for workspace operating policies.
 */

export type PublishApprovalLevel = 'always_require' | 'conditional_auto' | 'full_auto';
export type CustomerResponseAutomationLevel = 'draft_only' | 'auto_reply_faq' | 'full_auto';
export type BookingPolicy = 'require_human_confirmation' | 'auto_confirm_available';

export interface OperatingPolicyRules {
  /** 게시 승인 수준: 'always_require' (기본값, 무조건 사람 승인), 'conditional_auto', 'full_auto' */
  publishApprovalLevel: PublishApprovalLevel;
  /** 호환성 플래그: requireApprovalBeforePublish */
  requireApprovalBeforePublish: boolean;
  /** 고객 응대 자동화 수준: 'draft_only' (초안만 생성), 'auto_reply_faq' (FAQ 자동응대), 'full_auto' */
  customerResponseAutomationLevel: CustomerResponseAutomationLevel;
  /** 예약 처리 정책: 'require_human_confirmation' (사람 최종확인 필수), 'auto_confirm_available' */
  bookingPolicy: BookingPolicy;
  /** 일일 최대 자동/수동 발행 한도 (기본: 2) */
  maxDailyPublishCount: number;
  /** 발행 허용 채널 목록 (예: ['instagram', 'threads']) */
  allowedChannels: string[];
  /** 일일 비용 허용 한도 (KRW) (기본: 10,000원) */
  dailySpendLimitKrw: number;
  /** 월간 비용 허용 한도 (KRW) (기본: 100,000원) */
  monthlySpendLimitKrw: number;
  /** 액션당 최대 허용 비용 (KRW) (기본: 2,000원) */
  maxCostPerActionKrw: number;
  /** 긴급 중단 플래그 (true인 경우 모든 외부 발행/자동화 즉시 차단) */
  emergencyStop: boolean;
  /** 연속 실패 시 자동 중단 임계치 (기본: 3회) */
  stopOnConsecutiveFailures: number;
  /** 고객 불만/부정적 감정 감지 시 사람에게 인계 */
  handoffOnComplaint: boolean;
  /** 가격/견적 문의 감지 시 사람에게 인계 */
  handoffOnPriceInquiry: boolean;
  /** 모델 불확실성(confidence < 0.8) 감지 시 사람에게 인계 */
  handoffOnUncertainty: boolean;
  /** R3 점진적 주의사항 (가격 DM 유도, 과장 금지, 인물 보호, 금지 단어) */
  restrictions?: import('./conversational-operating-policy').ProgressivePolicyRestrictions;
}

export type OperatingPolicyStatus = 'draft' | 'active' | 'retired' | 'stale';

export interface OperatingPolicyVersion {
  id: string;
  workspaceId: string;
  ruleKey: string;
  versionNumber: number;
  status: OperatingPolicyStatus;
  rules: OperatingPolicyRules;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OperatingPolicyHandoffEvaluation {
  requiresHandoff: boolean;
  triggerReason?: 'complaint' | 'price_inquiry' | 'model_uncertainty' | 'manual_override';
  message: string;
}

export interface OperatingPolicySpendEvaluation {
  allowed: boolean;
  errorCode?: 'DAILY_SPEND_LIMIT_EXCEEDED' | 'MONTHLY_SPEND_LIMIT_EXCEEDED' | 'PER_ACTION_COST_EXCEEDED';
  message: string;
  currentDaySpendKrw: number;
  proposedCostKrw: number;
  dailyLimitKrw: number;
}
