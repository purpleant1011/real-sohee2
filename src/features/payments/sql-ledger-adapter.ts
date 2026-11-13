/**
 * SQL RPC 기반 원장 어댑터 (ANI-1615 / ANI-1616 / ANI-1617 / ANI-1620).
 *
 * 마이그레이션 `20261022090000_v093_deposit_refund_notice_ledger.sql`의 RPC 4개를
 * 업무 포트(`PaymentLedgerPort`, `NoticeLedgerPort`)로 감싼다. 인메모리 Map을 SSOT로
 * 쓰지 않고 DB 트랜잭션이 유일한 저장소가 되게 하는 것이 목적이다.
 *
 * 계약 원칙:
 *  - RPC 인자 이름은 마이그레이션의 `p_*`와 정확히 같다(snake_case).
 *  - `error`가 있으면 `LEDGER_UNAVAILABLE`. 원문 message만 보존하고 secret/쿼리는 남기지 않는다.
 *  - 모르는 kind, 비정형 payload, `data`가 객체 아님은 `LEDGER_CONTRACT_VIOLATION`.
 *    성공으로 승격하거나 빈 결과로 위장하지 않는다.
 *  - 모든 반환은 deep-freeze이며 항상 `datasetMode:'TEST'`, `actualVerified:false`다.
 */

import {
  LedgerPortError,
  assertNonEmptyString,
  assertPositiveSafeInteger,
  assertValidDate,
  assertWorkspaceId,
  assertLedgerUuid,
  deepFreeze,
  type ClaimNoticeJobCommand,
  type CommitPaymentObservationCommand,
  type InvalidateNoticeJobsCommand,
  type NoticeLedgerPort,
  type PaymentLedgerPort,
  type PersistentClaimResult,
  type PersistentInvalidateResult,
  type PersistentPaymentResult,
  type PersistentRefundResult,
  type ReserveRefundCommand,
  type SqlRpc,
} from './ledger-port'

const PAYMENT_OUTCOMES = ['MATCHED', 'MISMATCH', 'UNCONFIRMED'] as const

type Payload = Record<string, unknown>

function violation(detail: string): LedgerPortError {
  return new LedgerPortError('LEDGER_CONTRACT_VIOLATION', detail)
}

function payloadOf(data: unknown): Payload {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw violation('rpc payload must be an object')
  }
  return data as Payload
}

function kindOf(payload: Payload): string {
  const kind = payload.kind
  if (typeof kind !== 'string' || kind.trim().length === 0) {
    throw violation('rpc payload kind must be a non-empty string')
  }
  return kind
}

/** 값이 있으면 비어 있지 않은 문자열이어야 한다. 없으면 undefined. */
function optionalText(payload: Payload, key: string): string | undefined {
  const value = payload[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw violation(`rpc payload ${key} must be a non-empty string`)
  }
  return value
}

function requiredText(payload: Payload, key: string): string {
  const value = optionalText(payload, key)
  if (value === undefined) throw violation(`rpc payload ${key} is required`)
  return value
}

function requiredInteger(payload: Payload, key: string): number {
  const value = payload[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw violation(`rpc payload ${key} must be a safe integer`)
  }
  return value
}

/** timestamptz는 드라이버/psql에 따라 표기가 다르므로 ISO instant로 정규화한다. */
function requiredInstant(payload: Payload, key: string): string {
  const raw = requiredText(payload, key)
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) throw violation(`rpc payload ${key} must be a timestamp`)
  return new Date(parsed).toISOString()
}

function testMark() {
  return { datasetMode: 'TEST' as const, actualVerified: false as const }
}

function captureEvidence(payload: Payload, paymentRef: string) {
  const captureId = optionalText(payload, 'capture_id')
  const eventId = optionalText(payload, 'event_id')
  return {
    captureRef: paymentRef,
    ...(captureId === undefined ? {} : { captureId }),
    ...(eventId === undefined ? {} : { eventId }),
  }
}

export class SqlPaymentLedgerAdapter implements PaymentLedgerPort {
  constructor(private readonly rpc: SqlRpc) {}

  private async call(fn: string, args: Readonly<Record<string, unknown>>): Promise<Payload> {
    const { data, error } = await this.rpc(fn, args)
    if (error !== null && error !== undefined) {
      throw new LedgerPortError('LEDGER_UNAVAILABLE', String(error.message))
    }
    return payloadOf(data)
  }

  async commitPaymentObservation(
    input: CommitPaymentObservationCommand
  ): Promise<PersistentPaymentResult> {
    const workspaceId = assertWorkspaceId(input?.workspaceId)
    const intentId = assertLedgerUuid(input?.intentId, 'intentId')
    const eventId = assertNonEmptyString(input?.eventId, 'eventId')
    const payloadDigest = assertNonEmptyString(input?.payloadDigest, 'payloadDigest')
    const paymentRef = assertNonEmptyString(input?.paymentRef, 'paymentRef')
    const amountKrw = assertPositiveSafeInteger(input?.amountKrw, 'amountKrw')
    const paidAt = assertValidDate(input?.paidAt, 'paidAt')
    if (input?.currency !== 'KRW') {
      throw new LedgerPortError('INVALID_LEDGER_INPUT', 'currency must be KRW')
    }
    if (!PAYMENT_OUTCOMES.includes(input?.outcome)) {
      throw new LedgerPortError('INVALID_LEDGER_INPUT', 'outcome must be MATCHED, MISMATCH or UNCONFIRMED')
    }

    const payload = await this.call('commit_payment_observation', {
      p_workspace_id: workspaceId,
      p_event_id: eventId,
      p_payload_digest: payloadDigest,
      p_intent_id: intentId,
      p_payment_ref: paymentRef,
      p_amount_krw: amountKrw,
      p_currency: 'KRW',
      p_paid_at: paidAt.toISOString(),
      p_outcome: input.outcome,
    })

    switch (kindOf(payload)) {
      case 'MATCHED':
        return deepFreeze({ kind: 'TEST_CAPTURE_RECORDED', ...captureEvidence(payload, paymentRef), ...testMark() })
      case 'REPLAY': {
        const outcome = optionalText(payload, 'outcome')
        const evidence = optionalText(payload, 'capture_id') === undefined ? {} : captureEvidence(payload, paymentRef)
        return deepFreeze({
          kind: 'REPLAY',
          ...(outcome === undefined ? {} : { outcome }),
          ...evidence,
          ...testMark(),
        })
      }
      case 'LATE_PAYMENT':
        // 금액은 실제로 관측됐지만 예약·정산을 되살리지 않는다. capture 증거만 보존한다.
        return deepFreeze({
          kind: 'NEEDS_REVIEW',
          reason: 'LATE_PAYMENT',
          ...captureEvidence(payload, paymentRef),
          ...testMark(),
        })
      // MISMATCH/AMOUNT_MISMATCH는 마이그레이션 RPC가 실제로 반환하는 값이다
      // (v_conflict_kind = 'AMOUNT_MISMATCH' | 'MISMATCH'). 모두 사람 확인으로만 내려간다.
      case 'EVENT_CONFLICT':
      case 'PAYMENT_REF_CONFLICT':
      case 'MISMATCH':
      case 'AMOUNT_MISMATCH':
        return deepFreeze({ kind: 'NEEDS_REVIEW', reason: kindOf(payload), ...testMark() })
      case 'NEEDS_REVIEW': {
        const reason = optionalText(payload, 'reason') ?? 'NEEDS_REVIEW'
        return deepFreeze({ kind: 'NEEDS_REVIEW', reason, ...testMark() })
      }
      case 'NOT_FOUND':
        return deepFreeze({ kind: 'INTENT_NOT_FOUND', ...testMark() })
      default:
        throw violation(`unknown commit_payment_observation kind: ${kindOf(payload)}`)
    }
  }

  async reserveRefund(input: ReserveRefundCommand): Promise<PersistentRefundResult> {
    const workspaceId = assertWorkspaceId(input?.workspaceId)
    const paymentRef = assertNonEmptyString(input?.paymentRef, 'paymentRef')
    const operationKey = assertNonEmptyString(input?.operationKey, 'operationKey')
    const amountKrw = assertPositiveSafeInteger(input?.amountKrw, 'amountKrw')
    const reason = typeof input?.reason === 'string' ? input.reason : invalidReason()
    const ruleVersion = typeof input?.ruleVersion === 'string' ? input.ruleVersion : invalidRuleVersion()

    const payload = await this.call('reserve_deposit_refund', {
      p_workspace_id: workspaceId,
      p_payment_ref: paymentRef,
      p_operation_key: operationKey,
      p_amount_krw: amountKrw,
      p_reason: reason,
      p_rule_version: ruleVersion,
    })

    switch (kindOf(payload)) {
      case 'RESERVED':
        return deepFreeze({
          kind: 'RESERVED',
          refundRef: requiredText(payload, 'refund_id'),
          availableKrw: requiredInteger(payload, 'available_krw'),
          ...testMark(),
        })
      case 'REPLAY':
        return deepFreeze({
          kind: 'REPLAY',
          refundRef: requiredText(payload, 'refund_id'),
          status: requiredText(payload, 'status'),
          ...testMark(),
        })
      case 'CONFLICT': {
        const reasonText = optionalText(payload, 'reason')
        return deepFreeze({
          kind: 'CONFLICT',
          ...(reasonText === undefined ? {} : { reason: reasonText }),
          ...testMark(),
        })
      }
      case 'BLOCKED_DISPUTE':
        return deepFreeze({ kind: 'BLOCKED_DISPUTE', ...testMark() })
      case 'HOLD_UNKNOWN_REFUND':
        return deepFreeze({ kind: 'HOLD_UNKNOWN_REFUND', ...testMark() })
      case 'EXCEEDS_AVAILABLE':
        return deepFreeze({
          kind: 'EXCEEDS_AVAILABLE',
          availableKrw: requiredInteger(payload, 'available_krw'),
          ...testMark(),
        })
      case 'CAPTURE_NOT_FOUND':
        return deepFreeze({ kind: 'CAPTURE_NOT_FOUND', ...testMark() })
      default:
        throw violation(`unknown reserve_deposit_refund kind: ${kindOf(payload)}`)
    }
  }
}

function invalidReason(): never {
  throw new LedgerPortError('INVALID_LEDGER_INPUT', 'reason must be a string')
}

function invalidRuleVersion(): never {
  throw new LedgerPortError('INVALID_LEDGER_INPUT', 'ruleVersion must be a string')
}

export class SqlNoticeLedgerAdapter implements NoticeLedgerPort {
  constructor(private readonly rpc: SqlRpc) {}

  private async call(fn: string, args: Readonly<Record<string, unknown>>): Promise<Payload> {
    const { data, error } = await this.rpc(fn, args)
    if (error !== null && error !== undefined) {
      throw new LedgerPortError('LEDGER_UNAVAILABLE', String(error.message))
    }
    return payloadOf(data)
  }

  async claimNoticeJob(input: ClaimNoticeJobCommand): Promise<PersistentClaimResult> {
    const workspaceId = assertWorkspaceId(input?.workspaceId)
    const jobId = assertLedgerUuid(input?.jobId, 'jobId')
    const now = assertValidDate(input?.now, 'now')

    const payload = await this.call('claim_notice_job', {
      p_workspace_id: workspaceId,
      p_job_id: jobId,
      p_now: now.toISOString(),
    })

    switch (kindOf(payload)) {
      case 'CLAIMED':
        return deepFreeze({
          kind: 'CLAIMED',
          claimGeneration: requiredInteger(payload, 'claim_generation'),
          ...testMark(),
        })
      case 'NOT_CLAIMABLE':
        return deepFreeze({
          kind: 'NOT_CLAIMABLE',
          status: requiredText(payload, 'status'),
          scheduledAt: requiredInstant(payload, 'scheduled_at'),
          ...testMark(),
        })
      case 'NOT_FOUND':
        return deepFreeze({ kind: 'NOT_FOUND', ...testMark() })
      default:
        throw violation(`unknown claim_notice_job kind: ${kindOf(payload)}`)
    }
  }

  async invalidateNoticeJobs(input: InvalidateNoticeJobsCommand): Promise<PersistentInvalidateResult> {
    const workspaceId = assertWorkspaceId(input?.workspaceId)
    const bookingId = assertNonEmptyString(input?.bookingId, 'bookingId')
    const currentVersion = assertPositiveSafeInteger(input?.currentVersion, 'currentVersion')
    const currentStatus = assertNonEmptyString(input?.currentStatus, 'currentStatus')

    const payload = await this.call('invalidate_notice_jobs', {
      p_workspace_id: workspaceId,
      p_booking_id: bookingId,
      p_current_version: currentVersion,
      p_current_status: currentStatus,
    })

    if (kindOf(payload) !== 'OK') {
      throw violation(`unknown invalidate_notice_jobs kind: ${kindOf(payload)}`)
    }

    return deepFreeze({
      kind: 'OK',
      invalidated: requiredInteger(payload, 'invalidated'),
      inFlightOrSent: requiredInteger(payload, 'in_flight_or_sent'),
      ...testMark(),
    })
  }
}
