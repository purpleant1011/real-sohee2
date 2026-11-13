/**
 * 예약금 환불 (TEST 전용).
 * ANI-1617
 *
 * 환불 요청과 예약 취소는 서로 독립이다. 이 모듈은 예약 상태를 바꾸지 않는다.
 */

import type { Context } from '../policy-gate/testing/minimal-admission'
import type { TestTransport } from '../policy-gate/testing/minimal-transport'
import type { StoredRefund, TestDepositLedger } from './deposit-ledger'

export type RefundReadbackResult =
  | Readonly<{ status: 'CANCELLED'; amountKrw: number; cancellationRef: string }>
  | Readonly<{ status: 'PENDING' }>
  | Readonly<{ status: 'NOT_FOUND' }>
  | Readonly<{ status: 'ERROR' }>

export type RefundReadbackPort = (
  input: Readonly<{ workspaceId: string; operationKey: string }>
) => Promise<RefundReadbackResult>

export type RequestRefundInput = Readonly<{
  ledger: TestDepositLedger
  transport: TestTransport
  context: Context
  workspaceId: string
  captureRef: string
  operationKey: string
  amountKrw: number
  reason: string
  ruleVersion: string
  now: Date
}>

type RefundBase = Readonly<{
  bookingStatusChanged: false
  datasetMode: 'TEST'
  actualVerified: false
}>

export type RequestRefundResult =
  | (RefundBase & Readonly<{ kind: 'REQUESTED'; refund: StoredRefund; refundDone: false }>)
  | (RefundBase & Readonly<{ kind: 'REPLAY'; refund: StoredRefund; refundDone: false }>)
  | (RefundBase & Readonly<{ kind: 'UNKNOWN'; refund: StoredRefund; refundDone: false }>)
  | (RefundBase & Readonly<{ kind: 'UNKNOWN_REPLAY'; refund: StoredRefund; refundDone: false }>)
  | (RefundBase & Readonly<{ kind: 'REJECTED'; refund: StoredRefund; refundDone: false }>)
  | (RefundBase & Readonly<{ kind: 'EXCEEDS_AVAILABLE'; available: number }>)
  | (RefundBase & Readonly<{ kind: 'HOLD_UNKNOWN_REFUND' }>)
  | (RefundBase & Readonly<{ kind: 'BLOCKED_DISPUTE' }>)
  | (RefundBase & Readonly<{ kind: 'CAPTURE_NOT_FOUND' }>)
  | (RefundBase & Readonly<{ kind: 'INVALID_AMOUNT' }>)
  | (RefundBase & Readonly<{ kind: 'CONFLICT' }>)
  | (RefundBase & Readonly<{ kind: 'DENIED'; reason: string }>)

export type ReconcileRefundResult =
  | (RefundBase & Readonly<{ kind: 'MATCHED'; refund: StoredRefund; refundDone: true }>)
  | (RefundBase & Readonly<{ kind: 'NEEDS_REVIEW'; refund: StoredRefund; refundDone: false }>)
  | (RefundBase & Readonly<{ kind: 'UNCHANGED'; refund: StoredRefund; refundDone: false }>)
  | (RefundBase & Readonly<{ kind: 'REFUND_NOT_FOUND' }>)

function base(): RefundBase {
  return { bookingStatusChanged: false, datasetMode: 'TEST', actualVerified: false }
}

export async function requestRefund(input: RequestRefundInput): Promise<RequestRefundResult> {
  const { ledger, transport, context, workspaceId, captureRef, operationKey, amountKrw, reason, ruleVersion, now } = input

  const existing = ledger.getRefund(workspaceId, operationKey)
  if (existing) {
    if (existing.state === 'UNKNOWN') {
      return { kind: 'UNKNOWN_REPLAY', refund: existing, refundDone: false, ...base() }
    }
    if (existing.state === 'REQUESTED' || existing.state === 'TEST_REFUND_MATCHED') {
      return { kind: 'REPLAY', refund: existing, refundDone: false, ...base() }
    }
  }

  const reserved = ledger.reserveRefund({
    workspaceId, captureRef, operationKey, amountKrw, reason, ruleVersion, now,
  })

  switch (reserved.kind) {
    case 'REPLAY':
      return { kind: 'REPLAY', refund: reserved.refund, refundDone: false, ...base() }
    case 'CONFLICT':
      return { kind: 'CONFLICT', ...base() }
    case 'CAPTURE_NOT_FOUND':
      return { kind: 'CAPTURE_NOT_FOUND', ...base() }
    case 'INVALID_AMOUNT':
      return { kind: 'INVALID_AMOUNT', ...base() }
    case 'EXCEEDS_AVAILABLE':
      return { kind: 'EXCEEDS_AVAILABLE', available: reserved.available, ...base() }
    case 'HOLD_UNKNOWN_REFUND':
      return { kind: 'HOLD_UNKNOWN_REFUND', ...base() }
    case 'BLOCKED_DISPUTE':
      return { kind: 'BLOCKED_DISPUTE', ...base() }
    case 'RESERVED':
      break
    default:
      return { kind: 'CONFLICT', ...base() }
  }

  const payload = new TextEncoder().encode(
    JSON.stringify({
      operationKey,
      captureRef,
      amountKrw,
      reason,
      ruleVersion,
    })
  )

  const submitted = await transport.submit(context, {
    scope: { workspaceId, provider: 'portone', action: 'refund', operationKey },
    payload,
  })

  if (submitted.kind === 'DENIED') {
    // 아무 것도 시작되지 않았으므로 예약 행 자체를 남기지 않는다(가용액도 그대로).
    ledger.releaseRefundReservation(workspaceId, operationKey)
    return { kind: 'DENIED', reason: submitted.reason, ...base() }
  }

  switch (submitted.status) {
    case 'TEST_ACCEPTED': {
      const transitioned = ledger.markRefundDispatched(workspaceId, operationKey, {
        acceptanceRef: submitted.acceptanceRef ?? '',
      })
      if (transitioned.kind !== 'TRANSITIONED') return { kind: 'CONFLICT', ...base() }
      return {
        kind: submitted.replay ? 'REPLAY' : 'REQUESTED',
        refund: transitioned.refund,
        refundDone: false,
        ...base(),
      }
    }
    case 'TEST_UNKNOWN':
    case 'TEST_IN_FLIGHT': {
      const transitioned = ledger.markRefundUnknown(workspaceId, operationKey)
      const refund = transitioned.kind === 'TRANSITIONED' ? transitioned.refund : reserved.refund
      return { kind: 'UNKNOWN', refund, refundDone: false, ...base() }
    }
    case 'TEST_REJECTED':
    case 'TEST_CONFLICT': {
      const transitioned = ledger.markRefundRejected(workspaceId, operationKey)
      const refund = transitioned.kind === 'TRANSITIONED' ? transitioned.refund : reserved.refund
      return { kind: 'REJECTED', refund, refundDone: false, ...base() }
    }
    default:
      return { kind: 'CONFLICT', ...base() }
  }
}

/** 조회만 한다. transport를 호출하지 않는다. */
export async function reconcileRefund(input: {
  ledger: TestDepositLedger
  readback: RefundReadbackPort
  workspaceId: string
  operationKey: string
  now: Date
}): Promise<ReconcileRefundResult> {
  const { ledger, readback, workspaceId, operationKey, now } = input

  const refund = ledger.getRefund(workspaceId, operationKey)
  if (!refund) {
    return { kind: 'REFUND_NOT_FOUND', ...base() }
  }

  const observed = await readback({ workspaceId, operationKey })
  if (observed.status !== 'CANCELLED') {
    return { kind: 'UNCHANGED', refund, refundDone: false, ...base() }
  }

  // 관측으로 실제 수행이 확인되었으므로 REQUESTED로 올린 뒤 금액을 대조한다.
  if (refund.state === 'RESERVED' || refund.state === 'UNKNOWN') {
    ledger.markRefundDispatched(workspaceId, operationKey, { acceptanceRef: `observed:${now.toISOString()}` })
  }

  const confirmed = ledger.confirmRefundMatched(workspaceId, operationKey, {
    observedAmountKrw: observed.amountKrw,
    cancellationRef: observed.cancellationRef,
  })

  switch (confirmed.kind) {
    case 'MATCHED':
      return { kind: 'MATCHED', refund: confirmed.refund, refundDone: true, ...base() }
    case 'NEEDS_REVIEW':
      return { kind: 'NEEDS_REVIEW', refund: confirmed.refund, refundDone: false, ...base() }
    default: {
      const current = ledger.getRefund(workspaceId, operationKey) ?? refund
      return { kind: 'UNCHANGED', refund: current, refundDone: false, ...base() }
    }
  }
}
