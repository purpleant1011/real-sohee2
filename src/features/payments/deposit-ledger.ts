/**
 * Test-only in-memory deposit ledger.
 * ANI-1615 / ANI-1616 / ANI-1617
 *
 * 모든 변경 메서드는 동기적으로 검증한 뒤 한 번에 커밋한다(부분 반영 없음).
 * 이 원장은 TEST 전용이며 실제 PG·DB·네트워크를 사용하지 않는다.
 */

import { createHash } from 'node:crypto'
import type { DepositSnapshot } from './deposit-intent'

export type BookingFact = Readonly<{
  workspaceId: string
  bookingId: string
  customerId: string
  version: number
  serviceVersion: string
  status: 'CONFIRMED' | 'CANCELLED' | 'PENDING' | 'COMPLETED'
  totalServicePriceKrw: number
}>

export type DepositIntentState =
  | 'PREPARED'
  | 'REQUESTED'
  | 'REQUEST_UNKNOWN'
  | 'REQUEST_REJECTED'
  | 'TEST_PAID_MATCHED'
  | 'EXPIRED'
  | 'NEEDS_REVIEW'

export type StaleReason =
  | 'BOOKING_VERSION_CHANGED'
  | 'SERVICE_VERSION_CHANGED'
  | 'BOOKING_NOT_CONFIRMED'
  | 'EXPIRED'

export type StoredDepositIntent = Readonly<{
  intentId: string
  workspaceId: string
  bookingId: string
  customerId: string
  bookingVersion: number
  serviceVersion: string
  policy: 'OPTIONAL' | 'REQUIRED'
  amountKrw: number
  currency: 'KRW'
  totalServicePriceKrw: number
  remainingServicePriceKrw: number
  refundRuleVersion: string
  cancellationTerms: string
  merchantRef: string
  settlementActor: 'SHOP'
  expiresAt: string
  idempotencyKey: string
  termsFingerprint: string
  state: DepositIntentState
  checkoutUrl: string | null
  acceptanceRef: string | null
  createdAt: string
  updatedAt: string
}>

export type StaleCheckResult = Readonly<{
  found: boolean
  stale: boolean
  reasons: readonly StaleReason[]
}>

export type StoreIntentInput = Readonly<{
  snapshot: DepositSnapshot
  booking: BookingFact | null
  now: Date
}>

export type StoreIntentResult =
  | Readonly<{ kind: 'COMMITTED'; intent: StoredDepositIntent }>
  | Readonly<{ kind: 'REPLAY'; intent: StoredDepositIntent }>
  | Readonly<{ kind: 'ORPHAN_REJECTED'; reason: string }>
  | Readonly<{ kind: 'CONFLICT'; reason: string }>
  | Readonly<{ kind: 'ACTIVE_INTENT_EXISTS'; reason: string }>
  | Readonly<{ kind: 'EXPIRED_TERMS'; reason: string }>
  | Readonly<{ kind: 'STALE_BOOKING'; reason: string }>

export type TransitionResult =
  | Readonly<{ kind: 'TRANSITIONED'; intent: StoredDepositIntent }>
  | Readonly<{ kind: 'INVALID_TRANSITION'; reason: string }>

const ACTIVE_STATES: readonly DepositIntentState[] = [
  'PREPARED',
  'REQUESTED',
  'REQUEST_UNKNOWN',
  'TEST_PAID_MATCHED',
  'NEEDS_REVIEW',
]

/** DepositSnapshot 전 필드를 키 정렬한 canonical JSON으로 해싱한다. */
export function termsFingerprint(snapshot: DepositSnapshot): string {
  const keys = Object.keys(snapshot).sort()
  const canonical = JSON.stringify(keys.map((key) => [key, (snapshot as unknown as Record<string, unknown>)[key]]))
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

function copyOf<T>(value: T): T {
  return deepFreeze(JSON.parse(JSON.stringify(value)) as T)
}

function isValidAmount(amountKrw: unknown, totalServicePriceKrw: number): boolean {
  return (
    typeof amountKrw === 'number' &&
    Number.isSafeInteger(amountKrw) &&
    amountKrw >= 1 &&
    amountKrw <= totalServicePriceKrw
  )
}

export type CapturedPayment = Readonly<{
  captureRef: string
  workspaceId: string
  provider: 'portone'
  paymentRef: string
  intentId: string
  amountKrw: number
  currency: 'KRW'
  paidAt: string
  eventId: string
  recordedAt: string
  disputed: boolean
}>

export type ReconciliationReason =
  | 'EVENT_CONFLICT'
  | 'PAYMENT_REF_CONFLICT'
  | 'LATE_PAYMENT'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_NOT_CONFIRMED'
  | 'EXPIRED_INTENT'
  | 'INTENT_NOT_FOUND'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'MERCHANT_MISMATCH'
  | 'ORDER_MISMATCH'

export type ReconciliationEntry = Readonly<{
  queueId: string
  workspaceId: string
  provider: 'portone'
  eventId: string | null
  intentId: string | null
  paymentRef: string | null
  reason: string
  createdAt: string
}>

export type PaymentOutcome = 'MATCHED' | 'MISMATCH' | 'UNCONFIRMED'

export type CommitPaymentObservationInput = Readonly<{
  workspaceId: string
  provider: 'portone'
  eventId: string
  payloadDigest: string
  intentId: string
  paymentRef: string
  observedAmountKrw: number
  currency: 'KRW'
  paidAt: Date
  bookingNow: BookingFact | null
  outcome: PaymentOutcome
  mismatchReasons?: readonly ReconciliationReason[]
  now: Date
}>

export type CommitPaymentObservationResult =
  | Readonly<{ kind: 'MATCHED'; intent: StoredDepositIntent; capture: CapturedPayment }>
  | Readonly<{ kind: 'REPLAY'; priorResult: CommitPaymentObservationResult }>
  | Readonly<{ kind: 'EVENT_CONFLICT'; reason: 'EVENT_ID_REUSED_WITH_DIFFERENT_PAYLOAD' }>
  | Readonly<{ kind: 'PAYMENT_REF_CONFLICT'; reason: 'PAYMENT_REF_BOUND_TO_ANOTHER_INTENT' }>
  | Readonly<{ kind: 'MISMATCH'; intent: StoredDepositIntent; reasons: readonly string[] }>
  | Readonly<{ kind: 'UNCONFIRMED'; intent: StoredDepositIntent }>
  | Readonly<{
      kind: 'NEEDS_REVIEW'
      intent: StoredDepositIntent
      capture: CapturedPayment | null
      reasons: readonly string[]
    }>
  | Readonly<{ kind: 'INTENT_NOT_FOUND' }>

const NON_PAYABLE_INTENT_STATES: readonly DepositIntentState[] = [
  'EXPIRED',
  'REQUEST_REJECTED',
]

export type RefundState =
  | 'RESERVED'
  | 'REQUESTED'
  | 'UNKNOWN'
  | 'REJECTED'
  | 'TEST_REFUND_MATCHED'
  | 'NEEDS_REVIEW'

export type StoredRefund = Readonly<{
  refundId: string
  workspaceId: string
  provider: 'portone'
  captureRef: string
  operationKey: string
  amountKrw: number
  reason: string
  ruleVersion: string
  state: RefundState
  acceptanceRef: string | null
  cancellationRef: string | null
  observedAmountKrw: number | null
  createdAt: string
  updatedAt: string
}>

export type ReserveRefundInput = Readonly<{
  workspaceId: string
  captureRef: string
  operationKey: string
  amountKrw: number
  reason: string
  ruleVersion: string
  now: Date
}>

export type ReserveRefundResult =
  | Readonly<{ kind: 'RESERVED'; refund: StoredRefund }>
  | Readonly<{ kind: 'REPLAY'; refund: StoredRefund }>
  | Readonly<{ kind: 'CONFLICT'; reason: string }>
  | Readonly<{ kind: 'CAPTURE_NOT_FOUND'; reason: string }>
  | Readonly<{ kind: 'INVALID_AMOUNT'; reason: string }>
  | Readonly<{ kind: 'EXCEEDS_AVAILABLE'; available: number }>
  | Readonly<{ kind: 'HOLD_UNKNOWN_REFUND'; reason: string }>
  | Readonly<{ kind: 'BLOCKED_DISPUTE'; reason: string }>

export type RefundTransitionResult =
  | Readonly<{ kind: 'TRANSITIONED'; refund: StoredRefund }>
  | Readonly<{ kind: 'INVALID_TRANSITION'; reason: string }>

export type RefundConfirmResult =
  | Readonly<{ kind: 'MATCHED'; refund: StoredRefund }>
  | Readonly<{ kind: 'NEEDS_REVIEW'; refund: StoredRefund; reason: 'AMOUNT_MISMATCH' }>
  | Readonly<{ kind: 'INVALID_TRANSITION'; reason: string }>

const REFUND_HOLDING_STATES: readonly RefundState[] = ['RESERVED', 'REQUESTED', 'UNKNOWN']

export type IdFactory = () => string

export class TestDepositLedger {
  private readonly intents = new Map<string, StoredDepositIntent>()
  private readonly keyIndex = new Map<string, string>()
  private readonly events = new Map<string, { payloadDigest: string; result: CommitPaymentObservationResult }>()
  private readonly captures = new Map<string, CapturedPayment>()
  private readonly reconciliation = new Map<string, ReconciliationEntry>()
  private readonly refunds = new Map<string, StoredRefund>()
  private readonly idFactory: IdFactory
  private sequence = 0

  constructor(options: { idFactory?: IdFactory } = {}) {
    this.idFactory = options.idFactory ?? (() => `intent-${++this.sequence}`)
  }

  private keyOf(workspaceId: string, idempotencyKey: string): string {
    return JSON.stringify([workspaceId, idempotencyKey])
  }

  private scopeOf(workspaceId: string, intentId: string): string {
    return JSON.stringify([workspaceId, intentId])
  }

  private activeIntentFor(workspaceId: string, bookingId: string): StoredDepositIntent | undefined {
    for (const intent of this.intents.values()) {
      if (
        intent.workspaceId === workspaceId &&
        intent.bookingId === bookingId &&
        ACTIVE_STATES.includes(intent.state)
      ) {
        return intent
      }
    }
    return undefined
  }

  storeIntent(input: StoreIntentInput): StoreIntentResult {
    const { snapshot, booking, now } = input
    const fingerprint = termsFingerprint(snapshot)
    const key = this.keyOf(snapshot.workspaceId, snapshot.idempotencyKey)

    const existingScope = this.keyIndex.get(key)
    if (existingScope) {
      const existing = this.intents.get(existingScope)!
      if (existing.termsFingerprint !== fingerprint) {
        return { kind: 'CONFLICT', reason: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_TERMS' }
      }
      return { kind: 'REPLAY', intent: copyOf(existing) }
    }

    if (!booking || booking.workspaceId !== snapshot.workspaceId || booking.bookingId !== snapshot.bookingId) {
      return { kind: 'ORPHAN_REJECTED', reason: 'BOOKING_NOT_FOUND' }
    }

    if (
      booking.version !== snapshot.bookingVersion ||
      booking.serviceVersion !== snapshot.serviceVersion ||
      booking.status !== 'CONFIRMED'
    ) {
      return { kind: 'STALE_BOOKING', reason: 'BOOKING_CHANGED_SINCE_SNAPSHOT' }
    }

    const nowMs = now.getTime()
    if (!Number.isFinite(nowMs)) {
      return { kind: 'CONFLICT', reason: 'INVALID_NOW' }
    }

    const expiresAtMs = Date.parse(snapshot.expiresAt)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
      return { kind: 'EXPIRED_TERMS', reason: 'TERMS_EXPIRED' }
    }

    if (!isValidAmount(snapshot.amountKrw, snapshot.totalServicePriceKrw)) {
      return { kind: 'CONFLICT', reason: 'INVALID_AMOUNT' }
    }

    if (this.activeIntentFor(snapshot.workspaceId, snapshot.bookingId)) {
      return { kind: 'ACTIVE_INTENT_EXISTS', reason: 'ANOTHER_ACTIVE_INTENT_FOR_BOOKING' }
    }

    const timestamp = now.toISOString()
    const intent: StoredDepositIntent = {
      intentId: this.idFactory(),
      workspaceId: snapshot.workspaceId,
      bookingId: snapshot.bookingId,
      customerId: snapshot.customerId,
      bookingVersion: snapshot.bookingVersion,
      serviceVersion: snapshot.serviceVersion,
      policy: snapshot.policy,
      amountKrw: snapshot.amountKrw,
      currency: snapshot.currency,
      totalServicePriceKrw: snapshot.totalServicePriceKrw,
      remainingServicePriceKrw: snapshot.remainingServicePriceKrw,
      refundRuleVersion: snapshot.refundRuleVersion,
      cancellationTerms: snapshot.cancellationTerms,
      merchantRef: snapshot.merchantRef,
      settlementActor: snapshot.settlementActor,
      expiresAt: snapshot.expiresAt,
      idempotencyKey: snapshot.idempotencyKey,
      termsFingerprint: fingerprint,
      state: 'PREPARED',
      checkoutUrl: null,
      acceptanceRef: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const scoped = this.scopeOf(intent.workspaceId, intent.intentId)
    this.intents.set(scoped, intent)
    this.keyIndex.set(key, scoped)
    return { kind: 'COMMITTED', intent: copyOf(intent) }
  }

  getIntent(workspaceId: string, intentId: string): StoredDepositIntent | undefined {
    const intent = this.intents.get(this.scopeOf(workspaceId, intentId))
    return intent ? copyOf(intent) : undefined
  }

  checkStale(
    intentId: string,
    workspaceId: string,
    currentBooking: BookingFact | null,
    now: Date
  ): StaleCheckResult {
    const intent = this.intents.get(this.scopeOf(workspaceId, intentId))
    if (!intent) {
      return { found: false, stale: true, reasons: [] }
    }

    const reasons: StaleReason[] = []
    if (!currentBooking || currentBooking.workspaceId !== intent.workspaceId || currentBooking.bookingId !== intent.bookingId) {
      reasons.push('BOOKING_NOT_CONFIRMED')
    } else {
      if (currentBooking.version !== intent.bookingVersion) reasons.push('BOOKING_VERSION_CHANGED')
      if (currentBooking.serviceVersion !== intent.serviceVersion) reasons.push('SERVICE_VERSION_CHANGED')
      if (currentBooking.status !== 'CONFIRMED') reasons.push('BOOKING_NOT_CONFIRMED')
    }
    if (Date.parse(intent.expiresAt) <= now.getTime()) reasons.push('EXPIRED')

    return { found: true, stale: reasons.length > 0, reasons }
  }

  private transition(
    workspaceId: string,
    intentId: string,
    from: readonly DepositIntentState[],
    patch: Partial<StoredDepositIntent>,
    at?: Date
  ): TransitionResult {
    const scoped = this.scopeOf(workspaceId, intentId)
    const intent = this.intents.get(scoped)
    if (!intent) {
      return { kind: 'INVALID_TRANSITION', reason: 'INTENT_NOT_FOUND' }
    }
    if (!from.includes(intent.state)) {
      return { kind: 'INVALID_TRANSITION', reason: `STATE_${intent.state}_NOT_TRANSITIONABLE` }
    }
    const next: StoredDepositIntent = {
      ...intent,
      ...patch,
      updatedAt: (at ?? new Date()).toISOString(),
    }
    this.intents.set(scoped, next)
    return { kind: 'TRANSITIONED', intent: copyOf(next) }
  }

  markRequested(
    workspaceId: string,
    intentId: string,
    params: { checkoutUrl: string; acceptanceRef: string }
  ): TransitionResult {
    return this.transition(workspaceId, intentId, ['PREPARED'], {
      state: 'REQUESTED',
      checkoutUrl: params.checkoutUrl,
      acceptanceRef: params.acceptanceRef,
    })
  }

  markRequestUnknown(workspaceId: string, intentId: string): TransitionResult {
    return this.transition(workspaceId, intentId, ['PREPARED', 'REQUESTED'], { state: 'REQUEST_UNKNOWN' })
  }

  markRequestRejected(workspaceId: string, intentId: string): TransitionResult {
    return this.transition(workspaceId, intentId, ['PREPARED', 'REQUESTED'], { state: 'REQUEST_REJECTED' })
  }

  expire(workspaceId: string, intentId: string): TransitionResult {
    return this.transition(workspaceId, intentId, ['PREPARED', 'REQUESTED'], { state: 'EXPIRED' })
  }

  private markNeedsReview(
    workspaceId: string,
    intentId: string,
    at: Date
  ): StoredDepositIntent | undefined {
    const scoped = this.scopeOf(workspaceId, intentId)
    const intent = this.intents.get(scoped)
    if (!intent) return undefined
    if (intent.state === 'NEEDS_REVIEW') return copyOf(intent)
    const next: StoredDepositIntent = { ...intent, state: 'NEEDS_REVIEW', updatedAt: at.toISOString() }
    this.intents.set(scoped, next)
    return copyOf(next)
  }

  private enqueueReconciliation(params: {
    workspaceId: string
    eventId: string | null
    intentId: string | null
    paymentRef: string | null
    reason: string
    at: Date
  }): ReconciliationEntry {
    const entry: ReconciliationEntry = {
      queueId: `recon-${this.reconciliation.size + 1}`,
      workspaceId: params.workspaceId,
      provider: 'portone',
      eventId: params.eventId,
      intentId: params.intentId,
      paymentRef: params.paymentRef,
      reason: params.reason,
      createdAt: params.at.toISOString(),
    }
    this.reconciliation.set(entry.queueId, entry)
    return copyOf(entry)
  }

  getCapture(workspaceId: string, paymentRef: string): CapturedPayment | undefined {
    const capture = this.captures.get(JSON.stringify([workspaceId, 'portone', paymentRef]))
    return capture ? copyOf(capture) : undefined
  }

  listCaptures(workspaceId: string): readonly CapturedPayment[] {
    return copyOf(
      [...this.captures.values()]
        .filter((capture) => capture.workspaceId === workspaceId)
        .sort((a, b) => (a.captureRef < b.captureRef ? -1 : 1))
    )
  }

  listReconciliationQueue(workspaceId: string): readonly ReconciliationEntry[] {
    return copyOf(
      [...this.reconciliation.values()]
        .filter((entry) => entry.workspaceId === workspaceId)
        .sort((a, b) => (a.queueId < b.queueId ? -1 : 1))
    )
  }

  /**
   * 결제 관측을 원자적으로 커밋한다.
   * 이벤트 유일성(workspace, provider, eventId) → capture 유일성(workspace, provider, paymentRef) 순으로 검증한다.
   */
  commitPaymentObservation(
    input: CommitPaymentObservationInput
  ): CommitPaymentObservationResult {
    const {
      workspaceId, eventId, payloadDigest, intentId, paymentRef,
      observedAmountKrw, currency, paidAt, bookingNow, outcome, now,
    } = input

    const eventKey = JSON.stringify([workspaceId, 'portone', eventId])
    const prior = this.events.get(eventKey)
    if (prior) {
      if (prior.payloadDigest === payloadDigest) {
        return { kind: 'REPLAY', priorResult: copyOf(prior.result) }
      }
      // 덮어쓰기 금지: 기존 이벤트 기록은 그대로 두고, intent만 사람 확인으로 올린다.
      this.markNeedsReview(workspaceId, intentId, now)
      this.enqueueReconciliation({
        workspaceId, eventId, intentId, paymentRef, reason: 'EVENT_CONFLICT', at: now,
      })
      return { kind: 'EVENT_CONFLICT', reason: 'EVENT_ID_REUSED_WITH_DIFFERENT_PAYLOAD' }
    }

    const scopedIntent = this.intents.get(this.scopeOf(workspaceId, intentId))
    if (!scopedIntent) {
      return { kind: 'INTENT_NOT_FOUND' }
    }

    if (outcome === 'UNCONFIRMED') {
      const result: CommitPaymentObservationResult = { kind: 'UNCONFIRMED', intent: copyOf(scopedIntent) }
      this.events.set(eventKey, { payloadDigest, result })
      return result
    }

    if (outcome === 'MISMATCH') {
      const reasons = [...(input.mismatchReasons ?? ['AMOUNT_MISMATCH'])]
      const intent = this.markNeedsReview(workspaceId, intentId, now)!
      for (const reason of reasons) {
        this.enqueueReconciliation({ workspaceId, eventId, intentId, paymentRef, reason, at: now })
      }
      const result: CommitPaymentObservationResult = { kind: 'MISMATCH', intent, reasons }
      this.events.set(eventKey, { payloadDigest, result })
      return result
    }

    // outcome === 'MATCHED'
    const captureKey = JSON.stringify([workspaceId, 'portone', paymentRef])
    const existingCapture = this.captures.get(captureKey)
    if (existingCapture && existingCapture.intentId !== intentId) {
      this.markNeedsReview(workspaceId, intentId, now)
      this.enqueueReconciliation({
        workspaceId, eventId, intentId, paymentRef, reason: 'PAYMENT_REF_CONFLICT', at: now,
      })
      const result: CommitPaymentObservationResult = {
        kind: 'PAYMENT_REF_CONFLICT',
        reason: 'PAYMENT_REF_BOUND_TO_ANOTHER_INTENT',
      }
      this.events.set(eventKey, { payloadDigest, result })
      return result
    }

    const capture: CapturedPayment =
      existingCapture ?? {
        captureRef: paymentRef,
        workspaceId,
        provider: 'portone',
        paymentRef,
        intentId,
        amountKrw: observedAmountKrw,
        currency,
        paidAt: paidAt.toISOString(),
        eventId,
        recordedAt: now.toISOString(),
        disputed: false,
      }
    if (!existingCapture) {
      this.captures.set(captureKey, capture)
    }

    // 금융 사실은 보존하되, 예약을 되살리거나 자동 환불하지 않는다.
    const bookingCancelled = !bookingNow || bookingNow.status !== 'CONFIRMED'
    const expiredAtPayment = paidAt.getTime() > Date.parse(scopedIntent.expiresAt)
    const nonPayableState = NON_PAYABLE_INTENT_STATES.includes(scopedIntent.state)

    if (nonPayableState || bookingCancelled || expiredAtPayment) {
      const reasons: string[] = []
      if (scopedIntent.state === 'EXPIRED' || expiredAtPayment) reasons.push('EXPIRED_INTENT')
      if (scopedIntent.state === 'REQUEST_REJECTED') reasons.push('INTENT_NOT_PAYABLE')
      if (bookingCancelled) {
        reasons.push(bookingNow ? 'BOOKING_CANCELLED' : 'BOOKING_NOT_CONFIRMED')
      }
      const intent = this.markNeedsReview(workspaceId, intentId, now)!
      for (const reason of reasons) {
        this.enqueueReconciliation({ workspaceId, eventId, intentId, paymentRef, reason, at: now })
      }
      const result: CommitPaymentObservationResult = {
        kind: 'NEEDS_REVIEW',
        intent,
        capture: copyOf(capture),
        reasons,
      }
      this.events.set(eventKey, { payloadDigest, result })
      return result
    }

    const paid: StoredDepositIntent = {
      ...scopedIntent,
      state: 'TEST_PAID_MATCHED',
      updatedAt: now.toISOString(),
    }
    this.intents.set(this.scopeOf(workspaceId, intentId), paid)
    const result: CommitPaymentObservationResult = {
      kind: 'MATCHED',
      intent: copyOf(paid),
      capture: copyOf(capture),
    }
    this.events.set(eventKey, { payloadDigest, result })
    return result
  }

  // ── 환불 (ANI-1617) ────────────────────────────────────────

  private refundScope(workspaceId: string, operationKey: string): string {
    return JSON.stringify([workspaceId, 'portone', operationKey])
  }

  private availableFor(workspaceId: string, captureRef: string): number {
    const capture = this.captures.get(JSON.stringify([workspaceId, 'portone', captureRef]))
    if (!capture) return 0
    let used = 0
    for (const refund of this.refunds.values()) {
      if (refund.workspaceId !== workspaceId || refund.captureRef !== captureRef) continue
      if (refund.state === 'TEST_REFUND_MATCHED' || REFUND_HOLDING_STATES.includes(refund.state)) {
        used += refund.amountKrw
      }
    }
    return capture.amountKrw - used
  }

  getRefund(workspaceId: string, operationKey: string): StoredRefund | undefined {
    const refund = this.refunds.get(this.refundScope(workspaceId, operationKey))
    return refund ? copyOf(refund) : undefined
  }

  listRefunds(workspaceId: string): readonly StoredRefund[] {
    return copyOf(
      [...this.refunds.values()]
        .filter((refund) => refund.workspaceId === workspaceId)
        .sort((a, b) => (a.refundId < b.refundId ? -1 : 1))
    )
  }

  markDisputed(workspaceId: string, paymentRef: string): Readonly<{ kind: 'MARKED' }> | Readonly<{ kind: 'CAPTURE_NOT_FOUND' }> {
    const key = JSON.stringify([workspaceId, 'portone', paymentRef])
    const capture = this.captures.get(key)
    if (!capture) return { kind: 'CAPTURE_NOT_FOUND' }
    this.captures.set(key, { ...capture, disputed: true })
    return { kind: 'MARKED' }
  }

  reserveRefund(input: ReserveRefundInput): ReserveRefundResult {
    const { workspaceId, captureRef, operationKey, amountKrw, reason, ruleVersion, now } = input

    if (
      typeof amountKrw !== 'number' ||
      !Number.isSafeInteger(amountKrw) ||
      amountKrw <= 0
    ) {
      return { kind: 'INVALID_AMOUNT', reason: 'REFUND_AMOUNT_NOT_POSITIVE_SAFE_INTEGER' }
    }

    const capture = this.captures.get(JSON.stringify([workspaceId, 'portone', captureRef]))
    if (!capture) {
      return { kind: 'CAPTURE_NOT_FOUND', reason: 'NO_CAPTURE_FOR_WORKSPACE' }
    }

    const scoped = this.refundScope(workspaceId, operationKey)
    const existing = this.refunds.get(scoped)
    if (existing) {
      if (existing.captureRef !== captureRef || existing.amountKrw !== amountKrw || existing.reason !== reason) {
        return { kind: 'CONFLICT', reason: 'OPERATION_KEY_REUSED_WITH_DIFFERENT_REFUND' }
      }
      return { kind: 'REPLAY', refund: copyOf(existing) }
    }

    if (capture.disputed) {
      return { kind: 'BLOCKED_DISPUTE', reason: 'CAPTURE_DISPUTED' }
    }

    const hasUnknown = [...this.refunds.values()].some(
      (refund) =>
        refund.workspaceId === workspaceId &&
        refund.captureRef === captureRef &&
        refund.state === 'UNKNOWN'
    )
    if (hasUnknown) {
      return { kind: 'HOLD_UNKNOWN_REFUND', reason: 'UNKNOWN_REFUND_AWAITING_RECONCILIATION' }
    }

    const available = this.availableFor(workspaceId, captureRef)
    if (amountKrw > available) {
      return { kind: 'EXCEEDS_AVAILABLE', available }
    }

    const refund: StoredRefund = {
      refundId: `refund-${this.refunds.size + 1}`,
      workspaceId,
      provider: 'portone',
      captureRef,
      operationKey,
      amountKrw,
      reason,
      ruleVersion,
      state: 'RESERVED',
      acceptanceRef: null,
      cancellationRef: null,
      observedAmountKrw: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
    this.refunds.set(scoped, refund)
    return { kind: 'RESERVED', refund: copyOf(refund) }
  }

  private transitionRefund(
    workspaceId: string,
    operationKey: string,
    from: readonly RefundState[],
    patch: Partial<StoredRefund>,
    at?: Date
  ): RefundTransitionResult {
    const scoped = this.refundScope(workspaceId, operationKey)
    const refund = this.refunds.get(scoped)
    if (!refund) return { kind: 'INVALID_TRANSITION', reason: 'REFUND_NOT_FOUND' }
    if (!from.includes(refund.state)) {
      return { kind: 'INVALID_TRANSITION', reason: `STATE_${refund.state}_NOT_TRANSITIONABLE` }
    }
    const next: StoredRefund = { ...refund, ...patch, updatedAt: (at ?? new Date()).toISOString() }
    this.refunds.set(scoped, next)
    return { kind: 'TRANSITIONED', refund: copyOf(next) }
  }

  markRefundDispatched(
    workspaceId: string,
    operationKey: string,
    params: { acceptanceRef: string }
  ): RefundTransitionResult {
    // UNKNOWN은 조회로 실제 수행이 확인된 경우에만 REQUESTED로 올린다.
    return this.transitionRefund(workspaceId, operationKey, ['RESERVED', 'UNKNOWN'], {
      state: 'REQUESTED',
      acceptanceRef: params.acceptanceRef,
    })
  }

  markRefundUnknown(workspaceId: string, operationKey: string): RefundTransitionResult {
    return this.transitionRefund(workspaceId, operationKey, ['RESERVED', 'REQUESTED'], { state: 'UNKNOWN' })
  }

  /** 요청 자체가 거부되어 아무 것도 시작되지 않았을 때: 예약 행을 남기지 않는다. */
  releaseRefundReservation(
    workspaceId: string,
    operationKey: string
  ): Readonly<{ kind: 'RELEASED' }> | Readonly<{ kind: 'INVALID_TRANSITION'; reason: string }> {
    const scoped = this.refundScope(workspaceId, operationKey)
    const refund = this.refunds.get(scoped)
    if (!refund) return { kind: 'INVALID_TRANSITION', reason: 'REFUND_NOT_FOUND' }
    if (refund.state !== 'RESERVED') {
      return { kind: 'INVALID_TRANSITION', reason: `STATE_${refund.state}_NOT_RELEASABLE` }
    }
    this.refunds.delete(scoped)
    return { kind: 'RELEASED' }
  }

  markRefundRejected(workspaceId: string, operationKey: string): RefundTransitionResult {
    return this.transitionRefund(workspaceId, operationKey, ['RESERVED', 'REQUESTED'], { state: 'REJECTED' })
  }

  markRefundNeedsReview(workspaceId: string, operationKey: string): RefundTransitionResult {
    return this.transitionRefund(
      workspaceId,
      operationKey,
      ['RESERVED', 'REQUESTED', 'UNKNOWN'],
      { state: 'NEEDS_REVIEW' }
    )
  }

  confirmRefundMatched(
    workspaceId: string,
    operationKey: string,
    params: { observedAmountKrw: number; cancellationRef: string }
  ): RefundConfirmResult {
    const scoped = this.refundScope(workspaceId, operationKey)
    const refund = this.refunds.get(scoped)
    if (!refund) return { kind: 'INVALID_TRANSITION', reason: 'REFUND_NOT_FOUND' }
    if (refund.state !== 'REQUESTED') {
      return { kind: 'INVALID_TRANSITION', reason: `STATE_${refund.state}_NOT_TRANSITIONABLE` }
    }

    if (params.observedAmountKrw !== refund.amountKrw) {
      const next: StoredRefund = {
        ...refund,
        state: 'NEEDS_REVIEW',
        cancellationRef: params.cancellationRef,
        observedAmountKrw: params.observedAmountKrw,
        updatedAt: new Date().toISOString(),
      }
      this.refunds.set(scoped, next)
      return { kind: 'NEEDS_REVIEW', refund: copyOf(next), reason: 'AMOUNT_MISMATCH' }
    }

    const next: StoredRefund = {
      ...refund,
      state: 'TEST_REFUND_MATCHED',
      cancellationRef: params.cancellationRef,
      observedAmountKrw: params.observedAmountKrw,
      updatedAt: new Date().toISOString(),
    }
    this.refunds.set(scoped, next)
    return { kind: 'MATCHED', refund: copyOf(next) }
  }
}
