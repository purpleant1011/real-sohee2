/**
 * 결제·환불·안내 job 원장 포트 (ANI-1615 / ANI-1616 / ANI-1617 / ANI-1620).
 *
 * 이 파일은 업무 의미만 정의한다. 저장소 구현(SQL RPC 어댑터, 인메모리 원장)은 이 포트를 구현한다.
 * 모든 결과는 discriminated union이며, 전부 `datasetMode:'TEST'`, `actualVerified:false`를 갖는다.
 * 실제 수납·실제 환불을 주장하는 이름(TEST_ 접두 없는 CAPTURED/REFUNDED 등)은 의도적으로 쓰지 않는다.
 */

export type LedgerDatasetMode = 'TEST'

/** 주입 가능한 RPC 호출 포트. Supabase client든 psql 하네스든 같은 모양으로 끼운다. */
export type SqlRpc = (
  fn: string,
  args: Readonly<Record<string, unknown>>
) => Promise<{ data: unknown; error: { message: string } | null }>

export type LedgerPortErrorCode =
  | 'INVALID_LEDGER_INPUT'
  | 'LEDGER_UNAVAILABLE'
  | 'LEDGER_CONTRACT_VIOLATION'

export class LedgerPortError extends Error {
  readonly code: LedgerPortErrorCode

  constructor(code: LedgerPortErrorCode, detail: string) {
    super(`${code}:${detail}`)
    this.name = 'LedgerPortError'
    this.code = code
  }
}

// ── 입력 가드 ────────────────────────────────────────────────────────────────

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isLedgerUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function assertWorkspaceId(value: unknown): string {
  if (!isLedgerUuid(value)) {
    throw new LedgerPortError('INVALID_LEDGER_INPUT', 'workspaceId must be a UUID')
  }
  return value
}

/** intent_id / job_id는 DB에서 uuid 컬럼이므로 같은 형식을 요구한다. */
export function assertLedgerUuid(value: unknown, field: string): string {
  if (!isLedgerUuid(value)) {
    throw new LedgerPortError('INVALID_LEDGER_INPUT', `${field} must be a UUID`)
  }
  return value
}

export function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LedgerPortError('INVALID_LEDGER_INPUT', `${field} must be a non-empty string`)
  }
  return value
}

export function assertPositiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new LedgerPortError('INVALID_LEDGER_INPUT', `${field} must be a positive safe integer`)
  }
  return value
}

export function assertValidDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new LedgerPortError('INVALID_LEDGER_INPUT', `${field} must be a valid Date`)
  }
  return value
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

// ── 결제 관측 커밋 ───────────────────────────────────────────────────────────

export type PaymentObservationOutcome = 'MATCHED' | 'MISMATCH' | 'UNCONFIRMED'

export type CommitPaymentObservationCommand = Readonly<{
  workspaceId: string
  /** 공급자 이벤트 id. (workspace, provider, event_id)가 유일 키다. */
  eventId: string
  payloadDigest: string
  intentId: string
  paymentRef: string
  amountKrw: number
  currency: 'KRW'
  paidAt: Date
  outcome: PaymentObservationOutcome
}>

type TestMark = Readonly<{ datasetMode: LedgerDatasetMode; actualVerified: false }>

export type PersistentPaymentResult = Readonly<
  TestMark &
    (
      | {
          kind: 'TEST_CAPTURE_RECORDED'
          /** 포트 수준의 capture 참조 = 공급자 payment reference. reserveRefund가 이 값을 받는다. */
          captureRef: string
          /** DB 행의 uuid. 증거 보존용이며 업무 키가 아니다. */
          captureId?: string
          eventId?: string
        }
      | { kind: 'REPLAY'; outcome?: string; captureRef?: string; captureId?: string; eventId?: string }
      | { kind: 'NEEDS_REVIEW'; reason: string; captureRef?: string; captureId?: string; eventId?: string }
      | { kind: 'INTENT_NOT_FOUND' }
    )
>

// ── 환불 예약 ────────────────────────────────────────────────────────────────

export type ReserveRefundCommand = Readonly<{
  workspaceId: string
  /**
   * 공급자 payment reference. 마이그레이션의 reserve_deposit_refund는 capture 행을
   * payment_ref로 찾으므로(캡처 uuid가 아니다) 이 이름을 쓴다.
   */
  paymentRef: string
  operationKey: string
  amountKrw: number
  reason: string
  ruleVersion: string
}>

export type PersistentRefundResult = Readonly<
  TestMark &
    (
      | { kind: 'RESERVED'; refundRef: string; availableKrw: number }
      | { kind: 'REPLAY'; refundRef: string; status: string }
      | { kind: 'CONFLICT'; reason?: string }
      | { kind: 'BLOCKED_DISPUTE' }
      | { kind: 'HOLD_UNKNOWN_REFUND' }
      | { kind: 'EXCEEDS_AVAILABLE'; availableKrw: number }
      | { kind: 'CAPTURE_NOT_FOUND' }
    )
>

// ── 안내 job ─────────────────────────────────────────────────────────────────

export type ClaimNoticeJobCommand = Readonly<{
  workspaceId: string
  jobId: string
  now: Date
}>

export type PersistentClaimResult = Readonly<
  TestMark &
    (
      | { kind: 'CLAIMED'; claimGeneration: number }
      | { kind: 'NOT_CLAIMABLE'; status: string; scheduledAt: string }
      | { kind: 'NOT_FOUND' }
    )
>

export type InvalidateNoticeJobsCommand = Readonly<{
  workspaceId: string
  bookingId: string
  currentVersion: number
  currentStatus: string
}>

export type PersistentInvalidateResult = Readonly<
  TestMark & { kind: 'OK'; invalidated: number; inFlightOrSent: number }
>

// ── 포트 ─────────────────────────────────────────────────────────────────────

export type PaymentLedgerPort = {
  commitPaymentObservation(input: CommitPaymentObservationCommand): Promise<PersistentPaymentResult>
  reserveRefund(input: ReserveRefundCommand): Promise<PersistentRefundResult>
}

export type NoticeLedgerPort = {
  claimNoticeJob(input: ClaimNoticeJobCommand): Promise<PersistentClaimResult>
  invalidateNoticeJobs(input: InvalidateNoticeJobsCommand): Promise<PersistentInvalidateResult>
}
