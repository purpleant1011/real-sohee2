import { describe, expect, it } from 'vitest'
import { prepareDepositIntent, type DepositSnapshot } from './deposit-intent'
import { TestDepositLedger, termsFingerprint, type BookingFact } from './deposit-ledger'

const NOW = '2026-10-21T10:00:00Z'
const NOW_DATE = new Date(NOW)
const WS_A = '11111111-1111-4111-8111-111111111111'
const WS_B = '99999999-9999-4999-8999-999999999999'

const booking: BookingFact = {
  workspaceId: WS_A, bookingId: 'booking-a', customerId: 'customer-a', version: 2,
  serviceVersion: 'catalog-2', status: 'CONFIRMED', totalServicePriceKrw: 50000,
}

const request = {
  workspaceId: WS_A, bookingId: 'booking-a', bookingVersion: 2, serviceVersion: 'catalog-2',
  policy: 'OPTIONAL' as const, selected: true, ownerConfirmed: true, depositAmountKrw: 10000,
  refundRuleVersion: 'refund-1', cancellationTerms: '방문 하루 전까지 취소 가능',
  merchantRef: 'shop-merchant', settlementActor: 'SHOP' as const,
  expiresAt: '2026-10-22T10:00:00Z', idempotencyKey: 'booking-a-v2-deposit',
}

function snapshotOf(overrides: Record<string, unknown> = {}): DepositSnapshot {
  const result = prepareDepositIntent({ ...request, ...overrides }, booking, NOW)
  if (result.status !== 'DRAFT' || !result.intent) throw new Error('fixture: expected DRAFT')
  return result.intent
}

describe('termsFingerprint', () => {
  it('같은 스냅샷은 항상 같은 지문을 만든다', () => {
    expect(termsFingerprint(snapshotOf())).toBe(termsFingerprint(snapshotOf()))
    expect(termsFingerprint(snapshotOf())).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('필드 하나라도 달라지면 지문이 달라진다', () => {
    const base = snapshotOf()
    const baseFingerprint = termsFingerprint(base)
    const variants: DepositSnapshot[] = [
      { ...base, workspaceId: WS_B },
      { ...base, bookingId: 'booking-b' },
      { ...base, customerId: 'customer-b' },
      { ...base, bookingVersion: 3 },
      { ...base, serviceVersion: 'catalog-3' },
      { ...base, policy: 'REQUIRED' },
      { ...base, amountKrw: 10001 },
      { ...base, totalServicePriceKrw: 50001 },
      { ...base, remainingServicePriceKrw: 40001 },
      { ...base, refundRuleVersion: 'refund-2' },
      { ...base, cancellationTerms: '방문 당일 취소 불가' },
      { ...base, merchantRef: 'shop-merchant-2' },
      { ...base, expiresAt: '2026-10-22T11:00:00Z' },
      { ...base, idempotencyKey: 'booking-a-v2-deposit-2' },
    ]
    for (const variant of variants) {
      expect(termsFingerprint(variant)).not.toBe(baseFingerprint)
    }
  })
})

describe('TestDepositLedger.storeIntent', () => {
  it('예약과 조건이 맞으면 PREPARED 상태로 커밋한다', () => {
    const ledger = new TestDepositLedger()
    const snapshot = snapshotOf()
    const result = ledger.storeIntent({ snapshot, booking, now: NOW_DATE })
    expect(result.kind).toBe('COMMITTED')
    if (result.kind !== 'COMMITTED') throw new Error('expected COMMITTED')
    expect(result.intent.intentId).toBe('intent-1')
    expect(result.intent.state).toBe('PREPARED')
    expect(result.intent.termsFingerprint).toBe(termsFingerprint(snapshot))
    expect(Object.isFrozen(result.intent)).toBe(true)
  })

  it('같은 멱등키와 같은 조건은 REPLAY로 같은 intent를 돌려준다', () => {
    const ledger = new TestDepositLedger()
    const snapshot = snapshotOf()
    const first = ledger.storeIntent({ snapshot, booking, now: NOW_DATE })
    const second = ledger.storeIntent({ snapshot, booking, now: NOW_DATE })
    expect(first.kind).toBe('COMMITTED')
    expect(second.kind).toBe('REPLAY')
    if (first.kind !== 'COMMITTED' || second.kind !== 'REPLAY') throw new Error('expected COMMITTED/REPLAY')
    expect(second.intent.intentId).toBe(first.intent.intentId)
    expect(ledger.getIntent(WS_A, first.intent.intentId)).toEqual(first.intent)
  })

  it('같은 멱등키에 조건이 다르면 CONFLICT로 거부한다', () => {
    const ledger = new TestDepositLedger()
    ledger.storeIntent({ snapshot: snapshotOf(), booking, now: NOW_DATE })
    const conflicting = ledger.storeIntent({ snapshot: snapshotOf({ depositAmountKrw: 20000 }), booking, now: NOW_DATE })
    expect(conflicting.kind).toBe('CONFLICT')
  })

  it('같은 예약에 다른 키로 활성 intent가 있으면 ACTIVE_INTENT_EXISTS', () => {
    const ledger = new TestDepositLedger()
    ledger.storeIntent({ snapshot: snapshotOf(), booking, now: NOW_DATE })
    const second = ledger.storeIntent({
      snapshot: snapshotOf({ idempotencyKey: 'booking-a-v2-deposit-other' }), booking, now: NOW_DATE,
    })
    expect(second.kind).toBe('ACTIVE_INTENT_EXISTS')
  })

  it('다른 워크스페이스의 같은 멱등키는 서로 독립이다', () => {
    const ledger = new TestDepositLedger()
    const otherBooking: BookingFact = { ...booking, workspaceId: WS_B }
    const otherRequest = { ...request, workspaceId: WS_B }
    const other = prepareDepositIntent(otherRequest, otherBooking, NOW)
    if (other.status !== 'DRAFT' || !other.intent) throw new Error('fixture')
    const a = ledger.storeIntent({ snapshot: snapshotOf(), booking, now: NOW_DATE })
    const b = ledger.storeIntent({ snapshot: other.intent, booking: otherBooking, now: NOW_DATE })
    expect(a.kind).toBe('COMMITTED')
    expect(b.kind).toBe('COMMITTED')
    if (a.kind !== 'COMMITTED' || b.kind !== 'COMMITTED') throw new Error('expected COMMITTED')
    expect(b.intent.intentId).not.toBe(a.intent.intentId)
    expect(ledger.getIntent(WS_B, a.intent.intentId)).toBeUndefined()
  })

  it('예약 없는 결제(orphan)는 ORPHAN_REJECTED', () => {
    const ledger = new TestDepositLedger()
    expect(ledger.storeIntent({ snapshot: snapshotOf(), booking: { ...booking, bookingId: 'booking-zzz' }, now: NOW_DATE }).kind).toBe('ORPHAN_REJECTED')
    expect(ledger.storeIntent({ snapshot: snapshotOf(), booking: { ...booking, workspaceId: WS_B }, now: NOW_DATE }).kind).toBe('ORPHAN_REJECTED')
  })

  it.each([
    ['예약 버전 변경', { version: 3 }],
    ['서비스 버전 변경', { serviceVersion: 'catalog-3' }],
    ['예약 취소', { status: 'CANCELLED' as const }],
    ['예약 대기', { status: 'PENDING' as const }],
  ])('%s 시 STALE_BOOKING으로 거부한다', (_label, change) => {
    const ledger = new TestDepositLedger()
    expect(ledger.storeIntent({ snapshot: snapshotOf(), booking: { ...booking, ...change } as BookingFact, now: NOW_DATE }).kind).toBe('STALE_BOOKING')
  })

  it('만료된 조건은 EXPIRED_TERMS', () => {
    const ledger = new TestDepositLedger()
    const later = new Date('2026-10-22T10:00:00Z')
    expect(ledger.storeIntent({ snapshot: snapshotOf(), booking, now: later }).kind).toBe('EXPIRED_TERMS')
  })

  it.each([0, -1, 1.5, 50001, Number.MAX_SAFE_INTEGER + 1])('금액 %s 는 커밋하지 않는다', (amount) => {
    const ledger = new TestDepositLedger()
    const result = ledger.storeIntent({ snapshot: { ...snapshotOf(), amountKrw: amount }, booking, now: NOW_DATE })
    expect(result.kind).toBe('CONFLICT')
  })
})

describe('TestDepositLedger.checkStale', () => {
  const stored = () => {
    const ledger = new TestDepositLedger()
    const result = ledger.storeIntent({ snapshot: snapshotOf(), booking, now: NOW_DATE })
    if (result.kind !== 'COMMITTED') throw new Error('fixture')
    return { ledger, intentId: result.intent.intentId }
  }

  it('변경이 없으면 stale이 아니다', () => {
    const { ledger, intentId } = stored()
    expect(ledger.checkStale(intentId, WS_A, booking, NOW_DATE)).toMatchObject({ stale: false, reasons: [] })
  })

  it('예약 버전/서비스 버전/상태/만료를 각각 감지한다', () => {
    const { ledger, intentId } = stored()
    expect(ledger.checkStale(intentId, WS_A, { ...booking, version: 3 }, NOW_DATE).reasons).toContain('BOOKING_VERSION_CHANGED')
    expect(ledger.checkStale(intentId, WS_A, { ...booking, serviceVersion: 'catalog-3' }, NOW_DATE).reasons).toContain('SERVICE_VERSION_CHANGED')
    expect(ledger.checkStale(intentId, WS_A, { ...booking, status: 'CANCELLED' }, NOW_DATE).reasons).toContain('BOOKING_NOT_CONFIRMED')
    expect(ledger.checkStale(intentId, WS_A, booking, new Date('2026-10-22T10:00:00Z')).reasons).toContain('EXPIRED')
  })

  it('다른 워크스페이스 조회는 찾을 수 없음으로 처리한다', () => {
    const { ledger, intentId } = stored()
    const result = ledger.checkStale(intentId, WS_B, booking, NOW_DATE)
    expect(result.found).toBe(false)
    expect(result.stale).toBe(true)
  })
})

describe('TestDepositLedger 상태 전이', () => {
  const stored = () => {
    const ledger = new TestDepositLedger()
    const result = ledger.storeIntent({ snapshot: snapshotOf(), booking, now: NOW_DATE })
    if (result.kind !== 'COMMITTED') throw new Error('fixture')
    return { ledger, intentId: result.intent.intentId }
  }

  it('PREPARED에서 REQUESTED로만 전이한다', () => {
    const { ledger, intentId } = stored()
    const requested = ledger.markRequested(WS_A, intentId, { checkoutUrl: 'https://checkout.example.invalid/pay/x', acceptanceRef: 'test-request:1' })
    expect(requested.kind).toBe('TRANSITIONED')
    if (requested.kind !== 'TRANSITIONED') throw new Error('expected TRANSITIONED')
    expect(requested.intent.state).toBe('REQUESTED')
    expect(requested.intent.checkoutUrl).toBe('https://checkout.example.invalid/pay/x')
    expect(ledger.markRequested(WS_A, intentId, { checkoutUrl: 'https://checkout.example.invalid/pay/x', acceptanceRef: 'test-request:1' }).kind).toBe('INVALID_TRANSITION')
  })

  it('REQUEST_UNKNOWN·REQUEST_REJECTED·EXPIRED 전이를 허용한다', () => {
    const a = stored()
    expect(a.ledger.markRequestUnknown(WS_A, a.intentId).kind).toBe('TRANSITIONED')
    expect(a.ledger.getIntent(WS_A, a.intentId)?.state).toBe('REQUEST_UNKNOWN')
    expect(a.ledger.markRequested(WS_A, a.intentId, { checkoutUrl: 'x', acceptanceRef: 'y' }).kind).toBe('INVALID_TRANSITION')

    const b = stored()
    expect(b.ledger.markRequestRejected(WS_A, b.intentId).kind).toBe('TRANSITIONED')
    expect(b.ledger.getIntent(WS_A, b.intentId)?.state).toBe('REQUEST_REJECTED')

    const c = stored()
    expect(c.ledger.expire(WS_A, c.intentId).kind).toBe('TRANSITIONED')
    expect(c.ledger.getIntent(WS_A, c.intentId)?.state).toBe('EXPIRED')
  })

  it('거부된 intent는 더 이상 활성이 아니어서 새 키로 다시 만들 수 있다', () => {
    const { ledger, intentId } = stored()
    ledger.markRequestRejected(WS_A, intentId)
    const again = ledger.storeIntent({ snapshot: snapshotOf({ idempotencyKey: 'booking-a-v2-deposit-retry' }), booking, now: NOW_DATE })
    expect(again.kind).toBe('COMMITTED')
  })

  it('다른 워크스페이스에서는 전이할 수 없다', () => {
    const { ledger, intentId } = stored()
    expect(ledger.markRequested(WS_B, intentId, { checkoutUrl: 'x', acceptanceRef: 'y' }).kind).toBe('INVALID_TRANSITION')
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('PREPARED')
  })

  it('반환 객체를 변이해도 원장은 바뀌지 않는다', () => {
    const { ledger, intentId } = stored()
    const intent = ledger.getIntent(WS_A, intentId)
    expect(intent).toBeDefined()
    expect(() => { (intent as any).state = 'REQUESTED' }).toThrow()
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('PREPARED')
  })
})

// ─────────────────────────────────────────────────────────────
// ANI-1616: 수납 관측(웹훅) 원장 커밋
// ─────────────────────────────────────────────────────────────

const PAID_AT = new Date('2026-10-21T11:00:00Z')

function storedIntent(overrides: Record<string, unknown> = {}) {
  const ledger = new TestDepositLedger()
  const prepared = prepareDepositIntent({ ...request, ...overrides }, booking, NOW)
  if (prepared.status !== 'DRAFT' || !prepared.intent) throw new Error('fixture: expected DRAFT')
  const stored = ledger.storeIntent({ snapshot: prepared.intent, booking, now: NOW_DATE })
  if (stored.kind !== 'COMMITTED') throw new Error('fixture: expected COMMITTED')
  return { ledger, intentId: stored.intent.intentId, intent: stored.intent }
}

function paidInput(
  intentId: string,
  overrides: Partial<Parameters<TestDepositLedger['commitPaymentObservation']>[0]> = {}
) {
  return {
    workspaceId: WS_A,
    provider: 'portone' as const,
    eventId: 'evt-1',
    payloadDigest: 'sha256:aaa',
    intentId,
    paymentRef: 'pay-1',
    observedAmountKrw: 10000,
    currency: 'KRW' as const,
    paidAt: PAID_AT,
    bookingNow: booking,
    outcome: 'MATCHED' as const,
    now: PAID_AT,
    ...overrides,
  }
}

describe('TestDepositLedger.commitPaymentObservation', () => {
  it('금액이 일치하면 capture 1건을 만들고 TEST_PAID_MATCHED로 올린다', () => {
    const { ledger, intentId } = storedIntent()
    const result = ledger.commitPaymentObservation(paidInput(intentId))
    expect(result.kind).toBe('MATCHED')
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('TEST_PAID_MATCHED')
    const captures = ledger.listCaptures(WS_A)
    expect(captures).toHaveLength(1)
    expect(captures[0]).toMatchObject({ paymentRef: 'pay-1', captureRef: 'pay-1', amountKrw: 10000, currency: 'KRW', intentId })
    expect(ledger.getCapture(WS_A, 'pay-1')?.paymentRef).toBe('pay-1')
    expect(ledger.listReconciliationQueue(WS_A)).toHaveLength(0)
  })

  it('같은 이벤트를 다시 보내면 REPLAY로 부작용 없이 이전 결과를 돌려준다', () => {
    const { ledger, intentId } = storedIntent()
    const first = ledger.commitPaymentObservation(paidInput(intentId))
    const second = ledger.commitPaymentObservation(paidInput(intentId))
    const third = ledger.commitPaymentObservation(paidInput(intentId))
    expect(first.kind).toBe('MATCHED')
    expect(second.kind).toBe('REPLAY')
    expect(third.kind).toBe('REPLAY')
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
    if (second.kind !== 'REPLAY') throw new Error('expected REPLAY')
    expect(second.priorResult.kind).toBe('MATCHED')
  })

  it('같은 eventId에 다른 내용이 오면 EVENT_CONFLICT로 덮어쓰지 않는다', () => {
    const { ledger, intentId } = storedIntent()
    ledger.commitPaymentObservation(paidInput(intentId))
    const conflict = ledger.commitPaymentObservation(paidInput(intentId, { payloadDigest: 'sha256:bbb' }))
    expect(conflict.kind).toBe('EVENT_CONFLICT')
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('NEEDS_REVIEW')
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
    expect(ledger.listReconciliationQueue(WS_A).map((e) => e.reason)).toContain('EVENT_CONFLICT')
  })

  it('불일치(MISMATCH)면 capture 없이 NEEDS_REVIEW로 남긴다', () => {
    const { ledger, intentId } = storedIntent()
    const result = ledger.commitPaymentObservation(
      paidInput(intentId, { outcome: 'MISMATCH', mismatchReasons: ['AMOUNT_MISMATCH'] })
    )
    expect(result.kind).toBe('MISMATCH')
    expect(ledger.listCaptures(WS_A)).toHaveLength(0)
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('NEEDS_REVIEW')
    expect(ledger.listReconciliationQueue(WS_A).map((e) => e.reason)).toContain('AMOUNT_MISMATCH')
  })

  it('미확인(UNCONFIRMED)이면 capture 없이 상태를 유지한다', () => {
    const { ledger, intentId } = storedIntent()
    const result = ledger.commitPaymentObservation(paidInput(intentId, { outcome: 'UNCONFIRMED' }))
    expect(result.kind).toBe('UNCONFIRMED')
    expect(ledger.listCaptures(WS_A)).toHaveLength(0)
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('PREPARED')
  })

  it('만료 후 입금은 금융 사실을 보존하되 예약을 복원하지 않는다', () => {
    const { ledger, intentId } = storedIntent()
    ledger.expire(WS_A, intentId)
    const result = ledger.commitPaymentObservation(paidInput(intentId, { paidAt: new Date('2026-10-23T00:00:00Z'), now: new Date('2026-10-23T00:00:00Z') }))
    expect(result.kind).toBe('NEEDS_REVIEW')
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('NEEDS_REVIEW')
    const reasons = ledger.listReconciliationQueue(WS_A).map((e) => e.reason)
    expect(reasons).toContain('EXPIRED_INTENT')
    expect(reasons).not.toContain('AUTO_REFUND')
  })

  it('예약이 취소된 뒤 입금되면 capture는 남기고 NEEDS_REVIEW로 보낸다', () => {
    const { ledger, intentId } = storedIntent()
    const result = ledger.commitPaymentObservation(
      paidInput(intentId, { bookingNow: { ...booking, status: 'CANCELLED' } })
    )
    expect(result.kind).toBe('NEEDS_REVIEW')
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
    expect(ledger.listReconciliationQueue(WS_A).map((e) => e.reason)).toContain('BOOKING_CANCELLED')
  })

  it('같은 paymentRef가 다른 intent에 결속되면 PAYMENT_REF_CONFLICT', () => {
    const { ledger, intentId } = storedIntent()
    ledger.commitPaymentObservation(paidInput(intentId))

    const bookingB: BookingFact = { ...booking, bookingId: 'booking-b' }
    const preparedB = prepareDepositIntent(
      { ...request, bookingId: 'booking-b', idempotencyKey: 'booking-b-v2-deposit' }, bookingB, NOW
    )
    if (preparedB.status !== 'DRAFT' || !preparedB.intent) throw new Error('fixture')
    const secondIntent = ledger.storeIntent({ snapshot: preparedB.intent, booking: bookingB, now: NOW_DATE })
    expect(secondIntent.kind).toBe('COMMITTED')
    if (secondIntent.kind !== 'COMMITTED') throw new Error('fixture')

    const conflict = ledger.commitPaymentObservation(
      paidInput(secondIntent.intent.intentId, {
        eventId: 'evt-2', paymentRef: 'pay-1', bookingNow: bookingB,
      })
    )
    expect(conflict.kind).toBe('PAYMENT_REF_CONFLICT')
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
    expect(ledger.listReconciliationQueue(WS_A).map((e) => e.reason)).toContain('PAYMENT_REF_CONFLICT')
  })

  it('워크스페이스별로 capture·대사 큐를 격리한다', () => {
    const { ledger, intentId } = storedIntent()
    ledger.commitPaymentObservation(paidInput(intentId))
    expect(ledger.listCaptures(WS_B)).toHaveLength(0)
    expect(ledger.getCapture(WS_B, 'pay-1')).toBeUndefined()
    expect(ledger.listReconciliationQueue(WS_B)).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────
// ANI-1617: 환불 예약·가용액·UNKNOWN 보류
// ─────────────────────────────────────────────────────────────

function captureLedger() {
  const { ledger, intentId } = storedIntent()
  const committed = ledger.commitPaymentObservation(paidInput(intentId))
  if (committed.kind !== 'MATCHED') throw new Error('fixture: expected MATCHED')
  return { ledger, intentId, paymentRef: 'pay-1' }
}

function refundInput(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WS_A,
    captureRef: 'pay-1',
    operationKey: 'refund-op-1',
    amountKrw: 10000,
    reason: '예약 취소',
    ruleVersion: 'refund-1',
    now: PAID_AT,
    ...overrides,
  }
}

describe('TestDepositLedger.reserveRefund', () => {
  it('capture가 있으면 RESERVED로 예약한다', () => {
    const { ledger } = captureLedger()
    const result = ledger.reserveRefund(refundInput())
    expect(result.kind).toBe('RESERVED')
    if (result.kind !== 'RESERVED') throw new Error('expected RESERVED')
    expect(result.refund.state).toBe('RESERVED')
    expect(result.refund.amountKrw).toBe(10000)
    expect(result.refund.cancellationRef).toBeNull()
  })

  it('capture가 없으면 거부한다', () => {
    const { ledger } = captureLedger()
    expect(ledger.reserveRefund(refundInput({ captureRef: 'pay-missing' })).kind).toBe('CAPTURE_NOT_FOUND')
  })

  it('다른 워크스페이스의 capture는 환불할 수 없다', () => {
    const { ledger } = captureLedger()
    expect(ledger.reserveRefund(refundInput({ workspaceId: WS_B })).kind).toBe('CAPTURE_NOT_FOUND')
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])('금액 %s 는 거부한다', (amount) => {
    const { ledger } = captureLedger()
    expect(ledger.reserveRefund(refundInput({ amountKrw: amount })).kind).toBe('INVALID_AMOUNT')
  })

  it('captured를 넘는 금액은 EXCEEDS_AVAILABLE', () => {
    const { ledger } = captureLedger()
    const result = ledger.reserveRefund(refundInput({ amountKrw: 10001 }))
    expect(result.kind).toBe('EXCEEDS_AVAILABLE')
    if (result.kind !== 'EXCEEDS_AVAILABLE') throw new Error('expected EXCEEDS_AVAILABLE')
    expect(result.available).toBe(10000)
  })

  it('부분환불 2회 + 진행 예약 합이 captured를 넘으면 거부한다', () => {
    const { ledger } = captureLedger()
    const first = ledger.reserveRefund(refundInput({ operationKey: 'refund-op-1', amountKrw: 4000 }))
    expect(first.kind).toBe('RESERVED')
    ledger.confirmRefundMatched(WS_A, 'refund-op-1', { observedAmountKrw: 4000, cancellationRef: 'cancel-1' })
    const second = ledger.reserveRefund(refundInput({ operationKey: 'refund-op-2', amountKrw: 4000 }))
    expect(second.kind).toBe('RESERVED')
    // 확정 4000 + 진행 4000 = 8000 사용 → 가용 2000
    const third = ledger.reserveRefund(refundInput({ operationKey: 'refund-op-3', amountKrw: 3000 }))
    expect(third.kind).toBe('EXCEEDS_AVAILABLE')
    if (third.kind !== 'EXCEEDS_AVAILABLE') throw new Error('expected EXCEEDS_AVAILABLE')
    expect(third.available).toBe(2000)
  })

  it('같은 operationKey·같은 내용은 REPLAY로 기존 환불을 돌려준다', () => {
    const { ledger } = captureLedger()
    const first = ledger.reserveRefund(refundInput())
    const second = ledger.reserveRefund(refundInput())
    expect(first.kind).toBe('RESERVED')
    expect(second.kind).toBe('REPLAY')
    if (first.kind !== 'RESERVED' || second.kind !== 'REPLAY') throw new Error('fixture')
    expect(second.refund.refundId).toBe(first.refund.refundId)
  })

  it('같은 operationKey·다른 금액은 CONFLICT', () => {
    const { ledger } = captureLedger()
    ledger.reserveRefund(refundInput())
    expect(ledger.reserveRefund(refundInput({ amountKrw: 5000 })).kind).toBe('CONFLICT')
  })

  it('UNKNOWN 환불이 있으면 다른 키의 새 환불은 HOLD_UNKNOWN_REFUND', () => {
    const { ledger } = captureLedger()
    ledger.reserveRefund(refundInput({ amountKrw: 3000 }))
    ledger.markRefundUnknown(WS_A, 'refund-op-1')
    const blocked = ledger.reserveRefund(refundInput({ operationKey: 'refund-op-2', amountKrw: 1000 }))
    expect(blocked.kind).toBe('HOLD_UNKNOWN_REFUND')
    // 같은 키 재시도는 여전히 REPLAY(재호출 아님)
    expect(ledger.reserveRefund(refundInput({ amountKrw: 3000 })).kind).toBe('REPLAY')
  })

  it('분쟁(chargeback) 표시된 capture는 환불을 막는다', () => {
    const { ledger } = captureLedger()
    expect(ledger.markDisputed(WS_A, 'pay-1').kind).toBe('MARKED')
    expect(ledger.reserveRefund(refundInput()).kind).toBe('BLOCKED_DISPUTE')
  })

  it('환불 거부 시 가용액이 복구된다', () => {
    const { ledger } = captureLedger()
    ledger.reserveRefund(refundInput({ amountKrw: 10000 }))
    expect(ledger.reserveRefund(refundInput({ operationKey: 'refund-op-2', amountKrw: 1000 })).kind).toBe('EXCEEDS_AVAILABLE')
    ledger.markRefundRejected(WS_A, 'refund-op-1')
    expect(ledger.reserveRefund(refundInput({ operationKey: 'refund-op-2', amountKrw: 1000 })).kind).toBe('RESERVED')
  })
})

describe('TestDepositLedger 환불 상태 전이', () => {
  it('RESERVED → REQUESTED → TEST_REFUND_MATCHED', () => {
    const { ledger } = captureLedger()
    ledger.reserveRefund(refundInput())
    expect(ledger.markRefundDispatched(WS_A, 'refund-op-1', { acceptanceRef: 'test-request:r1' }).kind).toBe('TRANSITIONED')
    expect(ledger.getRefund(WS_A, 'refund-op-1')?.state).toBe('REQUESTED')
    const matched = ledger.confirmRefundMatched(WS_A, 'refund-op-1', { observedAmountKrw: 10000, cancellationRef: 'cancel-1' })
    expect(matched.kind).toBe('MATCHED')
    expect(ledger.getRefund(WS_A, 'refund-op-1')?.state).toBe('TEST_REFUND_MATCHED')
    expect(ledger.getRefund(WS_A, 'refund-op-1')?.cancellationRef).toBe('cancel-1')
  })

  it('금액이 다르면 NEEDS_REVIEW로 보낸다', () => {
    const { ledger } = captureLedger()
    ledger.reserveRefund(refundInput())
    ledger.markRefundDispatched(WS_A, 'refund-op-1', { acceptanceRef: 'r' })
    const result = ledger.confirmRefundMatched(WS_A, 'refund-op-1', { observedAmountKrw: 9000, cancellationRef: 'cancel-1' })
    expect(result.kind).toBe('NEEDS_REVIEW')
    expect(ledger.getRefund(WS_A, 'refund-op-1')?.state).toBe('NEEDS_REVIEW')
  })

  it('REQUESTED 상태에서만 확정할 수 있다', () => {
    const { ledger } = captureLedger()
    ledger.reserveRefund(refundInput())
    expect(ledger.confirmRefundMatched(WS_A, 'refund-op-1', { observedAmountKrw: 10000, cancellationRef: 'c' }).kind).toBe('INVALID_TRANSITION')
  })

  it('다른 워크스페이스에서는 환불을 조회·전이할 수 없다', () => {
    const { ledger } = captureLedger()
    ledger.reserveRefund(refundInput())
    expect(ledger.getRefund(WS_B, 'refund-op-1')).toBeUndefined()
    expect(ledger.markRefundDispatched(WS_B, 'refund-op-1', { acceptanceRef: 'r' }).kind).toBe('INVALID_TRANSITION')
    expect(ledger.listRefunds(WS_B)).toHaveLength(0)
  })
})

