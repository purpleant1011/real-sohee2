/**
 * W6 실행 코어가 돌려주는 상태 계약 (ANI-1704).
 *
 * 정본: `docs/mobile-r2/w6-approval-api-and-cta-contract.md` (W6 브랜치)
 * "현재 실행 코어의 실제 반환 계약" 절. 여기 다섯 상태 외의 값은 이 계약에 없다.
 *
 * 이 파일은 값의 **보존**만 정의한다. 표시 판정은 `publish-outcome.ts`,
 * W6→W4 변환은 `execute-status-adapter.ts`가 맡는다. 어느 쪽도 상태를 새로 만들지 않는다.
 */

/** W6 실행 코어가 반환하는 상태. */
export type ExecuteStatus =
  | 'REQUESTED'
  | 'PROVIDER_ACCEPTED'
  | 'VERIFIED'
  | 'RESULT_UNKNOWN'
  | 'MANUAL_REQUIRED'

export const EXECUTE_STATUSES = [
  'REQUESTED',
  'PROVIDER_ACCEPTED',
  'VERIFIED',
  'RESULT_UNKNOWN',
  'MANUAL_REQUIRED',
] as const satisfies readonly ExecuteStatus[]

/**
 * MANUAL_REQUIRED에서 왜 수동 처리가 필요한지. 서버가 준 값을 그대로 보존하며 W4가 추론하지 않는다.
 * 사용자 화면에는 코드가 아니라 원인별 문구로만 나간다.
 */
export type ExecutionFailureCause =
  | 'PROVIDER_REJECTED'
  | 'TRANSPORT_FAILED'
  | 'READBACK_UNKNOWN'
  | 'UNSPECIFIED'

export const EXECUTION_FAILURE_CAUSES = [
  'PROVIDER_REJECTED',
  'TRANSPORT_FAILED',
  'READBACK_UNKNOWN',
  'UNSPECIFIED',
] as const satisfies readonly ExecutionFailureCause[]

/** 전송/재조회 메타데이터. 서버가 줄 때만 보존하고, 없으면 만들지 않는다. */
export interface ExecutionMeta {
  transport?: { attemptedAt?: string; responseStatus?: number }
  readback?: { attemptedAt?: string; observedAt?: string }
}

/** 실행 영수증이 가리키는 채널. W4 `OutcomeChannel`과 같은 값 집합이다. */
export type ExecutionChannel = 'instagram' | 'threads'

/**
 * 서버가 돌려주는 채널별 실행 영수증 DTO.
 * 없는 근거(permalink·verifiedAt)를 채우지 않는다. 값이 없으면 필드도 없다.
 */
export interface ExecutionReceiptDto {
  channel: ExecutionChannel
  status: ExecuteStatus
  providerPostId?: string
  permalink?: string
  verifiedAt?: string
  /** MANUAL_REQUIRED에서만 의미가 있지만, 다른 상태에 실려 와도 보존한다. */
  failureCause?: ExecutionFailureCause
  meta?: ExecutionMeta
}

export function isExecuteStatus(v: unknown): v is ExecuteStatus {
  return typeof v === 'string' && (EXECUTE_STATUSES as readonly string[]).includes(v)
}

export function isFailureCause(v: unknown): v is ExecutionFailureCause {
  return typeof v === 'string' && (EXECUTION_FAILURE_CAUSES as readonly string[]).includes(v)
}
