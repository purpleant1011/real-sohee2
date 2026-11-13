/**
 * 소희 크레딧(SOHEE_CREDIT) 단일 정본 타입 정의
 * 
 * ANI-819: 제품 공식 명칭 '소희 크레딧' 단일 SSOT 통일 (Energy, SC, 코인 등 레거시 완전 제거)
 * ANI-820: 주간 크레딧 위젯 데이터 모델
 * ANI-821: Credit Reserve -> Execute -> Settle/Release 원자적 상태 머신
 * ANI-823: 플랜 자격 vs 소희 크레딧 vs 외부 광고비 3대 정책 독립 모델
 * ANI-824: Action Cost Quote 엔진
 * ANI-825: Zero Credit Semantics
 * ANI-838: Admin 불변 원장 14대 필수 필드
 * ANI-840: Weekly Credit Cycle SSOT
 */

/**
 * 공식 제품 크레딧 통화 코드
 */
export const OFFICIAL_CREDIT_UNIT = 'SOHEE_CREDIT' as const;
export type OfficialCreditUnit = typeof OFFICIAL_CREDIT_UNIT;

export const CREDIT_SCHEMA_VERSION = 2; // migration_version: 2 (ANI-819)

/**
 * 트랜잭션 상태 머신 상태
 */
export type CreditTransactionState =
  | 'IDLE'
  | 'RESERVED'
  | 'EXECUTING'
  | 'SETTLED'
  | 'RELEASED'
  | 'FAILED';

/**
 * 플랜 등급 (Agent Energy / Credit Plan Tier)
 */
export type SoheePlanTier =
  | 'FREE_TASTE'
  | 'TIER_150K_STARTER'
  | 'TIER_300K_GROWTH'
  | 'TIER_500K_PRO_SCALE';

/**
 * ANI-823: 3대 독립 비용 정책 분리 모델
 * 1) Plan Entitlement (플랜 기능 라이선스)
 * 2) Sohee Credit (소희 크레딧 - AI 액션 및 연산 자원)
 * 3) External Ad Spend (외부 광고비 - 메타/네이버 광고비 원가)
 */
export interface TripartiteCostPolicy {
  policyVersion: number;
  entitlement: {
    planTier: SoheePlanTier;
    featuresEnabled: string[];
    maxConcurrentActionRuns: number;
    supportSlaHours: number;
  };
  soheeCredit: {
    unit: OfficialCreditUnit;
    weeklyAllowance: number;
    ratePerActionRun: number;
    overageAllowed: boolean;
  };
  externalAdSpend: {
    isDirectlyBilledByPlatform: boolean; // 메타/네이버에 직접 결제
    adAccountLinked: boolean;
    budgetCapKrw: number;
    platformFeeRate: number; // 0 (외부 직결제)
  };
}

/**
 * ANI-824: Action Cost Quote (사전 견적)
 */
export interface ActionCostQuote {
  quoteId: string;
  workspaceId: string;
  actionType: string;
  requiredCredits: number;
  estimatedDurationMs: number;
  issuedAt: string;
  expiresAt: string; // TTL (기본 15분)
  isExpired: boolean;
  tripartiteClassification: 'SOHEE_CREDIT';
}

/**
 * ANI-820: 주간 크레딧 위젯 데이터 모델
 */
export interface WeeklyCreditSummary {
  workspaceId: string;
  unit: OfficialCreditUnit;
  schemaVersion: number;
  baseCredits: number; // 이번 주 기본 부여 크레딧
  bonusCredits: number; // 구매/이벤트 보너스 크레딧
  reservedCredits: number; // 현재 실행 예약 중인 크레딧
  settledCredits: number; // 이번 주 확정 소진된 크레딧
  availableCredits: number; // 즉시 사용 가능한 크레딧 (base + bonus - reserved)
  totalCapacity: number; // 주간 기본 + 보너스 총량
  burnRatePercentage: number;
  nextResetAt: string; // 다음 리셋 시각 (매주 월요일 09:00 KST)
  daysRemainingInCycle: number;
  usageHistory7d: Array<{
    date: string; // YYYY-MM-DD
    creditsUsed: number;
    actionCount: number;
  }>;
  zeroCreditStatus: {
    isZero: boolean;
    primaryCtaText: string;
    primaryCtaUrl: string;
    canExecuteBillableAction: boolean;
  };
}

/**
 * ANI-838: 불변 원장(Credit Ledger Entry) 14대 필수 필드
 */
export interface CreditLedgerEntry {
  id: string;
  workspaceId: string;
  entryType: 'GRANT' | 'RESERVE' | 'SETTLE' | 'RELEASE' | 'MANUAL_ADJUST' | 'EXPIRE';
  amount: number; // 양수: 증가/환원, 음수: 예약/소진
  balanceAfter: number;
  transactionRefId: string; // ActionRun ID, Payment ID 등
  quoteId?: string; // ANI-824 견적 ID
  reason: string;
  initiatedBy: string; // 'SYSTEM_CRON' | 'USER_ACTION' | 'ADMIN_MANUAL' | 'PG_WEBHOOK'
  createdAt: string;
  metadata: Record<string, unknown>;
  idempotencyKey: string; // 멱등 키
  auditHash: string; // SHA-256 무결성 해시
  previousEntryId: string | null; // 단방향 블록체인형 체인 링크
}

/**
 * 예약 트랜잭션 기록
 */
export interface CreditReservation {
  reservationId: string;
  workspaceId: string;
  quoteId: string;
  actionRunId: string;
  amount: number;
  state: CreditTransactionState;
  reservedAt: string;
  settledAt?: string;
  releasedAt?: string;
  idempotencyKey: string;
}
