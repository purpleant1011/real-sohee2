/**
 * 결제 웹훅 처리 (TEST 전용).
 * ANI-1616
 *
 * 순서: 서명 검증 → 본문 파싱 → intent 결속 확인 → 독립 조회(readback) → 원장 커밋.
 * 이 함수는 예약을 만들거나 확정하지 않는다(bookingEffects는 항상 0).
 */

import { z } from 'zod'
import type { Context, Scope } from '../policy-gate/testing/minimal-admission'
import type { TestVerifier } from './testing/minimal-webhook-verifier'
import type {
  BookingFact,
  ReconciliationReason,
  TestDepositLedger,
} from './deposit-ledger'

export type ReadbackPaid = Readonly<{
  status: 'PAID'
  amountKrw: number
  currency: 'KRW'
  paidAt: Date
  orderRef: string
}>

export type ReadbackPending = Readonly<{ status: 'PENDING' }>
export type ReadbackNotFound = Readonly<{ status: 'NOT_FOUND' }>
export type ReadbackError = Readonly<{ status: 'ERROR' }>

export type ReadbackResult = ReadbackPaid | ReadbackPending | ReadbackNotFound | ReadbackError

export type ReadbackPort = (input: Readonly<{ workspaceId: string; paymentRef: string }>) => Promise<ReadbackResult>

export type ProcessPaymentWebhookInput = Readonly<{
  ledger: TestDepositLedger
  verifier: TestVerifier
  readback: ReadbackPort
  context: Context
  expectedScope: Scope
  rawBody: Uint8Array
  headers: Readonly<Record<string, string>>
  now: Date
  /** 예약 현재 상태. null이면 예약이 없거나 확인 불가로 본다(자동 복원·확정 금지). */
  currentBooking: BookingFact | null
}>

export type ProcessPaymentWebhookResult =
  | Readonly<{
      kind: 'PAYMENT_OBSERVED'
      captureRef: string
      intentId: string
      bookingEffects: 0
      datasetMode: 'TEST'
      actualVerified: false
    }>
  | Readonly<{
      kind: 'REPLAY'
      captureRef: string | null
      intentId: string
      bookingEffects: 0
      datasetMode: 'TEST'
      actualVerified: false
    }>
  | Readonly<{
      kind: 'NEEDS_REVIEW'
      reasons: readonly string[]
      captureRef: string | null
      intentId: string
      bookingEffects: 0
      datasetMode: 'TEST'
      actualVerified: false
    }>
  | Readonly<{
      kind: 'UNCONFIRMED'
      intentId: string
      bookingEffects: 0
      datasetMode: 'TEST'
      actualVerified: false
    }>
  | Readonly<{
      kind: 'REJECTED'
      reason: string
      bookingEffects: 0
      datasetMode: 'TEST'
      actualVerified: false
    }>

/** 웹훅 본문 계약(strict). route 도 같은 스키마로 파싱해 필드 정의를 중복하지 않는다. */
export const bodySchema = z
  .object({
    type: z.literal('PAYMENT_PAID'),
    intentId: z.string().trim().min(1).max(200),
    merchantRef: z.string().trim().min(1).max(200),
    orderRef: z.string().trim().min(1).max(200),
    paymentRef: z.string().trim().min(1).max(200),
    amountKrw: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    // 통화는 불일치를 판정해야 하므로 문자열로 받는다. KRW가 아니면 NEEDS_REVIEW.
    currency: z.string().trim().min(1).max(8),
    // 본문에 실린 workspaceId는 신뢰하지 않는다. 서명된 scope만 작업공간을 정한다.
    workspaceId: z.string().optional(),
  })
  .strict()

function base() {
  return { bookingEffects: 0 as const, datasetMode: 'TEST' as const, actualVerified: false as const }
}

function rejected(reason: string): ProcessPaymentWebhookResult {
  return { kind: 'REJECTED', reason, ...base() }
}

export async function processPaymentWebhook(
  input: ProcessPaymentWebhookInput
): Promise<ProcessPaymentWebhookResult> {
  const { ledger, verifier, readback, context, expectedScope, rawBody, headers, now } = input

  // 1. 서명 검증 (실패 시 부작용 0)
  const verification = await verifier.verify(context, { expectedScope, rawBody, headers })
  if (verification.kind !== 'TEST_SIGNATURE_OBSERVATION') {
    return rejected(verification.reason)
  }

  // 2. 검증된 뒤에만 본문을 해석한다. workspace는 서명된 scope에서만 온다.
  let parsed: z.infer<typeof bodySchema>
  try {
    parsed = bodySchema.parse(JSON.parse(new TextDecoder().decode(rawBody)))
  } catch {
    return rejected('MALFORMED_BODY')
  }

  const workspaceId = verification.scope.workspaceId
  const intent = ledger.getIntent(workspaceId, parsed.intentId)
  if (!intent) {
    return rejected('INTENT_NOT_FOUND')
  }

  // 3. 본문-스냅샷 결속 확인
  const mismatchReasons: ReconciliationReason[] = []
  if (parsed.merchantRef !== intent.merchantRef) mismatchReasons.push('MERCHANT_MISMATCH')
  if (parsed.currency !== intent.currency) mismatchReasons.push('CURRENCY_MISMATCH')
  if (parsed.amountKrw !== intent.amountKrw) mismatchReasons.push('AMOUNT_MISMATCH')
  if (parsed.orderRef !== intent.intentId && parsed.orderRef !== intent.idempotencyKey) {
    mismatchReasons.push('ORDER_MISMATCH')
  }

  // 4. 독립 조회 (webhook body 재사용 금지)
  const observed = await readback({ workspaceId, paymentRef: parsed.paymentRef })

  const paidAt = observed.status === 'PAID' ? observed.paidAt : now
  let outcome: 'MATCHED' | 'MISMATCH' | 'UNCONFIRMED'
  let reasons = [...mismatchReasons]

  if (observed.status !== 'PAID') {
    outcome = 'UNCONFIRMED'
  } else {
    const readbackReasons: ReconciliationReason[] = []
    if (observed.amountKrw !== parsed.amountKrw) readbackReasons.push('AMOUNT_MISMATCH')
    if (observed.amountKrw !== intent.amountKrw) readbackReasons.push('AMOUNT_MISMATCH')
    if (observed.currency !== intent.currency) readbackReasons.push('CURRENCY_MISMATCH')
    if (observed.orderRef !== intent.intentId && observed.orderRef !== intent.idempotencyKey) {
      readbackReasons.push('ORDER_MISMATCH')
    }
    reasons = [...reasons, ...readbackReasons]
    outcome = reasons.length > 0 ? 'MISMATCH' : 'MATCHED'
  }

  const committed = ledger.commitPaymentObservation({
    workspaceId,
    provider: 'portone',
    eventId: verification.eventId,
    payloadDigest: verification.bodyDigest,
    intentId: parsed.intentId,
    paymentRef: parsed.paymentRef,
    observedAmountKrw: observed.status === 'PAID' ? observed.amountKrw : parsed.amountKrw,
    currency: 'KRW',
    paidAt,
    bookingNow: input.currentBooking,
    outcome,
    mismatchReasons: [...new Set(reasons)],
    now,
  })

  switch (committed.kind) {
    case 'MATCHED':
      return {
        kind: 'PAYMENT_OBSERVED',
        captureRef: committed.capture.captureRef,
        intentId: parsed.intentId,
        ...base(),
      }
    case 'REPLAY': {
      const prior = committed.priorResult
      const captureRef =
        prior.kind === 'MATCHED'
          ? prior.capture.captureRef
          : prior.kind === 'NEEDS_REVIEW'
            ? prior.capture?.captureRef ?? null
            : null
      return { kind: 'REPLAY', captureRef, intentId: parsed.intentId, ...base() }
    }
    case 'NEEDS_REVIEW':
      return {
        kind: 'NEEDS_REVIEW',
        reasons: committed.reasons,
        captureRef: committed.capture?.captureRef ?? null,
        intentId: parsed.intentId,
        ...base(),
      }
    case 'MISMATCH':
      return {
        kind: 'NEEDS_REVIEW',
        reasons: committed.reasons,
        captureRef: null,
        intentId: parsed.intentId,
        ...base(),
      }
    case 'EVENT_CONFLICT':
      return {
        kind: 'NEEDS_REVIEW',
        reasons: ['EVENT_CONFLICT'],
        captureRef: null,
        intentId: parsed.intentId,
        ...base(),
      }
    case 'PAYMENT_REF_CONFLICT':
      return {
        kind: 'NEEDS_REVIEW',
        reasons: ['PAYMENT_REF_CONFLICT'],
        captureRef: null,
        intentId: parsed.intentId,
        ...base(),
      }
    case 'UNCONFIRMED':
      return { kind: 'UNCONFIRMED', intentId: parsed.intentId, ...base() }
    case 'INTENT_NOT_FOUND':
      return rejected('INTENT_NOT_FOUND')
    default:
      return rejected('UNEXPECTED_RESULT')
  }
}
