/**
 * 예약금 결제 요청 (TEST 전용).
 * ANI-1615
 *
 * 결제 요청은 "요청을 보냈다"까지만 주장한다. 수납 확인은 웹훅·조회 경로(ANI-1616)의 몫이다.
 */

import type { Context } from '../policy-gate/testing/minimal-admission'
import type { TestTransport } from '../policy-gate/testing/minimal-transport'
import type { BookingFact, StaleReason, StoredDepositIntent, TestDepositLedger } from './deposit-ledger'

export type RequestDepositInput = Readonly<{
  ledger: TestDepositLedger
  transport: TestTransport
  context: Context
  workspaceId: string
  intentId: string
  currentBooking: BookingFact | null
  now: Date
}>

export type RequestDepositResult =
  | Readonly<{
      kind: 'REQUESTED'
      intent: StoredDepositIntent
      paid: false
      datasetMode: 'TEST'
      actualVerified: false
    }>
  | Readonly<{
      kind: 'REPLAY'
      intent: StoredDepositIntent
      paid: false
      datasetMode: 'TEST'
      actualVerified: false
    }>
  | Readonly<{
      kind: 'REQUEST_UNKNOWN'
      intent: StoredDepositIntent
      paid: false
      datasetMode: 'TEST'
      actualVerified: false
    }>
  | Readonly<{
      kind: 'REQUEST_UNKNOWN_REPLAY'
      intent: StoredDepositIntent
      paid: false
      datasetMode: 'TEST'
      actualVerified: false
    }>
  | Readonly<{
      kind: 'REQUEST_REJECTED'
      intent: StoredDepositIntent
      paid: false
      datasetMode: 'TEST'
      actualVerified: false
    }>
  | Readonly<{
      kind: 'STALE_TERMS'
      reasons: readonly StaleReason[]
      datasetMode: 'TEST'
      actualVerified: false
    }>
  | Readonly<{ kind: 'NO_DEPOSIT_REQUIRED'; datasetMode: 'TEST'; actualVerified: false }>
  | Readonly<{ kind: 'DENIED'; reason: string; datasetMode: 'TEST'; actualVerified: false }>

function testResultBase() {
  return { datasetMode: 'TEST' as const, actualVerified: false as const }
}

/** 사장님 화면용 문구. 영문 상태 코드를 노출하지 않는다. */
export function describeDepositForOwner(intent: StoredDepositIntent): string {
  switch (intent.state) {
    case 'PREPARED':
      return '예약금 결제를 아직 손님께 요청하지 않았어요.'
    case 'REQUESTED':
      return '결제 요청을 보냈어요. 입금 확인 전이에요.'
    case 'REQUEST_UNKNOWN':
      return '결제 요청 결과를 확인하지 못했어요. 다시 보내지 말고 입금 내역을 확인해 주세요.'
    case 'REQUEST_REJECTED':
      return '결제 요청이 거절되었어요. 손님께 다시 안내해 주세요.'
    case 'TEST_PAID_MATCHED':
      return '테스트 기준으로 입금이 확인되었어요(실제 입금 아님).'
    case 'EXPIRED':
      return '결제 요청 기한이 지났어요. 예약 조건을 다시 확인해 주세요.'
    case 'NEEDS_REVIEW':
      return '입금 내역을 사람이 확인해야 해요. 자동으로 처리하지 않았어요.'
    default:
      return '예약금 상태를 확인해 주세요.'
  }
}

export async function requestDeposit(input: RequestDepositInput): Promise<RequestDepositResult> {
  const { ledger, transport, context, workspaceId, intentId, currentBooking, now } = input

  const intent = ledger.getIntent(workspaceId, intentId)
  if (!intent) {
    // 정책 NONE·미선택·다른 워크스페이스: 예약금 요청 자체가 없으므로 PG를 호출하지 않는다.
    return { kind: 'NO_DEPOSIT_REQUIRED', ...testResultBase() }
  }

  // 이미 요청했거나 결과를 모르는 경우: 재호출 금지
  if (intent.state === 'REQUESTED') {
    return { kind: 'REPLAY', intent, paid: false, ...testResultBase() }
  }
  if (intent.state === 'REQUEST_UNKNOWN') {
    return { kind: 'REQUEST_UNKNOWN_REPLAY', intent, paid: false, ...testResultBase() }
  }
  if (intent.state !== 'PREPARED') {
    return { kind: 'STALE_TERMS', reasons: [], ...testResultBase() }
  }

  const stale = ledger.checkStale(intentId, workspaceId, currentBooking, now)
  if (stale.stale) {
    return { kind: 'STALE_TERMS', reasons: stale.reasons, ...testResultBase() }
  }

  const payload = new TextEncoder().encode(
    JSON.stringify({
      intentId: intent.intentId,
      amountKrw: intent.amountKrw,
      currency: intent.currency,
      merchantRef: intent.merchantRef,
      termsFingerprint: intent.termsFingerprint,
    })
  )

  const result = await transport.submit(context, {
    scope: {
      workspaceId: intent.workspaceId,
      provider: 'portone',
      action: 'payment',
      operationKey: intent.idempotencyKey,
    },
    payload,
  })

  if (result.kind === 'DENIED') {
    return { kind: 'DENIED', reason: result.reason, ...testResultBase() }
  }

  switch (result.status) {
    case 'TEST_ACCEPTED': {
      const transition = ledger.markRequested(workspaceId, intentId, {
        checkoutUrl: result.checkoutUrl ?? '',
        acceptanceRef: result.acceptanceRef ?? '',
      })
      if (transition.kind !== 'TRANSITIONED') {
        return { kind: 'STALE_TERMS', reasons: [], ...testResultBase() }
      }
      return { kind: result.replay ? 'REPLAY' : 'REQUESTED', intent: transition.intent, paid: false, ...testResultBase() }
    }
    case 'TEST_UNKNOWN':
    case 'TEST_IN_FLIGHT': {
      const transition = ledger.markRequestUnknown(workspaceId, intentId)
      const next = transition.kind === 'TRANSITIONED' ? transition.intent : intent
      return { kind: 'REQUEST_UNKNOWN', intent: next, paid: false, ...testResultBase() }
    }
    case 'TEST_REJECTED':
    case 'TEST_CONFLICT': {
      const transition = ledger.markRequestRejected(workspaceId, intentId)
      const next = transition.kind === 'TRANSITIONED' ? transition.intent : intent
      return { kind: 'REQUEST_REJECTED', intent: next, paid: false, ...testResultBase() }
    }
    default:
      return { kind: 'STALE_TERMS', reasons: [], ...testResultBase() }
  }
}
