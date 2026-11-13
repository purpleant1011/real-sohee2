import { describe, expect, it } from 'vitest'
import { prepareDepositIntent } from './deposit-intent'
import { TestDepositLedger, type BookingFact } from './deposit-ledger'
import { processPaymentWebhook, type ReadbackPort, type ReadbackResult } from './payment-webhook'
import { MinimalTestWebhookVerifier, signMinimalTestPayload } from './testing/minimal-webhook-verifier'
import type { Context, Scope } from '../policy-gate/testing/minimal-admission'

const NOW = '2026-10-21T10:00:00Z'
const NOW_DATE = new Date(NOW)
const WS_A = '11111111-1111-4111-8111-111111111111'
const WS_B = '99999999-9999-4999-8999-999999999999'
const SECRET = 'test-secret-key-for-webhook-processing'

const booking: BookingFact = {
  workspaceId: WS_A, bookingId: 'booking-a', customerId: 'customer-a', version: 2,
  serviceVersion: 'catalog-2', status: 'CONFIRMED', totalServicePriceKrw: 50000,
}

const baseRequest = {
  workspaceId: WS_A, bookingId: 'booking-a', bookingVersion: 2, serviceVersion: 'catalog-2',
  policy: 'OPTIONAL' as const, selected: true, ownerConfirmed: true, depositAmountKrw: 10000,
  refundRuleVersion: 'refund-1', cancellationTerms: '방문 하루 전까지 취소 가능',
  merchantRef: 'shop-merchant', settlementActor: 'SHOP' as const,
  expiresAt: '2026-10-22T10:00:00Z', idempotencyKey: 'booking-a-v2-deposit',
}

function makeContext(now: Date = NOW_DATE): Context {
  return {
    controls: {
      mode: 'TEST_FAKE_ONLY', datasetMode: 'TEST', allowedWorkspaceIds: [WS_A, WS_B], killSwitch: false,
    },
    now,
    evaluator: () => ({ ready: true }),
  }
}

function storedIntent(overrides: Record<string, unknown> = {}) {
  const ledger = new TestDepositLedger()
  const prepared = prepareDepositIntent({ ...baseRequest, ...overrides }, booking, NOW)
  if (prepared.status !== 'DRAFT' || !prepared.intent) throw new Error('fixture: expected DRAFT')
  const stored = ledger.storeIntent({ snapshot: prepared.intent, booking, now: NOW_DATE })
  if (stored.kind !== 'COMMITTED') throw new Error('fixture: expected COMMITTED')
  return { ledger, intentId: stored.intent.intentId, intent: stored.intent }
}

const verifier = new MinimalTestWebhookVerifier({ secret: SECRET })

type Body = {
  type: 'PAYMENT_PAID'
  intentId: string
  merchantRef: string
  orderRef: string
  paymentRef: string
  amountKrw: number
  currency: 'KRW'
}

function bodyFor(intentId: string, overrides: Partial<Body> = {}): Body {
  return {
    type: 'PAYMENT_PAID',
    intentId,
    merchantRef: 'shop-merchant',
    orderRef: intentId,
    paymentRef: 'pay-1',
    amountKrw: 10000,
    currency: 'KRW',
    ...overrides,
  }
}

function encode(body: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body))
}

function scopeFor(intentId: string, workspaceId: string = WS_A): Scope {
  return { workspaceId, provider: 'portone', action: 'payment', operationKey: `webhook-${intentId}` }
}

function headersFor(scope: Scope, rawBody: Uint8Array, eventId = 'evt-1', timestamp = NOW) {
  return signMinimalTestPayload({
    secret: SECRET, protocol: 'SOHEE_MINIMAL_TEST_V1', timestamp, eventId, scope, rawBody,
  })
}

function readbackStub(result: ReadbackResult): ReadbackPort & { calls: unknown[] } {
  const calls: unknown[] = []
  const port = (async (input: unknown) => {
    calls.push(input)
    return result
  }) as unknown as ReadbackPort & { calls: unknown[] }
  port.calls = calls
  return port
}

const paidReadback = (overrides: Partial<Extract<ReadbackResult, { status: 'PAID' }>> = {}) =>
  ({
    status: 'PAID' as const,
    amountKrw: 10000,
    currency: 'KRW' as const,
    paidAt: new Date('2026-10-21T10:30:00Z'),
    orderRef: 'order-ref-1',
    ...overrides,
  })

async function run(params: {
  ledger: TestDepositLedger
  intentId: string
  body?: Body
  scope?: Scope
  eventId?: string
  timestamp?: string
  rawBody?: Uint8Array
  headers?: Record<string, string>
  readback?: ReadbackPort
  now?: Date
  currentBooking?: BookingFact | null
}) {
  const scope = params.scope ?? scopeFor(params.intentId)
  const rawBody = params.rawBody ?? encode(params.body ?? bodyFor(params.intentId))
  return processPaymentWebhook({
    ledger: params.ledger,
    verifier,
    readback: params.readback ?? readbackStub(paidReadback()),
    context: makeContext(params.now ?? NOW_DATE),
    expectedScope: scope,
    rawBody,
    headers: params.headers ?? headersFor(scope, rawBody, params.eventId ?? 'evt-1', (params.now ?? NOW_DATE).toISOString()),
    now: params.now ?? NOW_DATE,
    currentBooking: params.currentBooking === undefined ? booking : params.currentBooking,
  })
}

describe('processPaymentWebhook — 서명 검증 실패는 부작용 0', () => {
  it('서명이 맞지 않으면 REJECTED이고 원장·readback에 아무 변화가 없다', async () => {
    const { ledger, intentId } = storedIntent()
    const readback = readbackStub(paidReadback())
    const scope = scopeFor(intentId)
    const rawBody = encode(bodyFor(intentId))
    const headers = { ...headersFor(scope, rawBody), 'x-sohee-test-signature': 'deadbeef' }
    const result = await run({ ledger, intentId, readback, headers })
    expect(result.kind).toBe('REJECTED')
    expect(result.bookingEffects).toBe(0)
    expect(readback.calls).toHaveLength(0)
    expect(ledger.listCaptures(WS_A)).toHaveLength(0)
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('PREPARED')
  })

  it('본문이 변조되면 REJECTED이고 원장은 그대로다', async () => {
    const { ledger, intentId } = storedIntent()
    const scope = scopeFor(intentId)
    const signed = encode(bodyFor(intentId))
    const headers = headersFor(scope, signed)
    const tampered = encode(bodyFor(intentId, { amountKrw: 999999 }))
    const readback = readbackStub(paidReadback())
    const result = await run({ ledger, intentId, readback, rawBody: tampered, headers })
    expect(result.kind).toBe('REJECTED')
    expect(readback.calls).toHaveLength(0)
    expect(ledger.listCaptures(WS_A)).toHaveLength(0)
  })

  it('타임스탬프가 만료되면 REJECTED', async () => {
    const { ledger, intentId } = storedIntent()
    const scope = scopeFor(intentId)
    const rawBody = encode(bodyFor(intentId))
    const stale = new Date(NOW_DATE.getTime() - 10 * 60 * 1000).toISOString()
    const headers = headersFor(scope, rawBody, 'evt-1', stale)
    const readback = readbackStub(paidReadback())
    const result = await run({ ledger, intentId, readback, headers })
    expect(result.kind).toBe('REJECTED')
    expect(readback.calls).toHaveLength(0)
    expect(ledger.listCaptures(WS_A)).toHaveLength(0)
  })

  it('서명 scope가 다르면 REJECTED', async () => {
    const { ledger, intentId } = storedIntent()
    const signedScope = scopeFor(intentId)
    const rawBody = encode(bodyFor(intentId))
    const headers = headersFor(signedScope, rawBody)
    const readback = readbackStub(paidReadback())
    const result = await run({
      ledger, intentId, readback, headers, scope: { ...signedScope, operationKey: 'webhook-other' },
    })
    expect(result.kind).toBe('REJECTED')
    expect(readback.calls).toHaveLength(0)
  })

  it('검증을 통과해도 본문 형식이 틀리면 MALFORMED_BODY로 거부한다', async () => {
    const { ledger, intentId } = storedIntent()
    const scope = scopeFor(intentId)
    const rawBody = encode({ type: 'PAYMENT_PAID', intentId, unexpected: true })
    const headers = headersFor(scope, rawBody)
    const readback = readbackStub(paidReadback())
    const result = await run({ ledger, intentId, readback, rawBody, headers })
    expect(result.kind).toBe('REJECTED')
    if (result.kind !== 'REJECTED') throw new Error('expected REJECTED')
    expect(result.reason).toBe('MALFORMED_BODY')
    expect(readback.calls).toHaveLength(0)
    expect(ledger.listCaptures(WS_A)).toHaveLength(0)
  })
})

describe('processPaymentWebhook — 정상 수납', () => {
  it('서명·조회가 모두 맞으면 capture 1건을 남기고 예약 효과는 0이다', async () => {
    const { ledger, intentId } = storedIntent()
    const readback = readbackStub(paidReadback({ orderRef: intentId }))
    const result = await run({ ledger, intentId, readback })
    expect(result.kind).toBe('PAYMENT_OBSERVED')
    expect(result.bookingEffects).toBe(0)
    expect(result.actualVerified).toBe(false)
    expect(result.datasetMode).toBe('TEST')
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('TEST_PAID_MATCHED')
    expect(readback.calls).toHaveLength(1)
  })

  it('같은 이벤트를 순차 3회 보내면 capture 1건, REPLAY 2회다', async () => {
    const { ledger, intentId } = storedIntent()
    const readback = readbackStub(paidReadback({ orderRef: intentId }))
    const first = await run({ ledger, intentId, readback })
    const second = await run({ ledger, intentId, readback })
    const third = await run({ ledger, intentId, readback })
    expect(first.kind).toBe('PAYMENT_OBSERVED')
    expect(second.kind).toBe('REPLAY')
    expect(third.kind).toBe('REPLAY')
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
  })

  it('같은 이벤트를 동시에 3회 보내도 capture는 1건이다', async () => {
    const { ledger, intentId } = storedIntent()
    const readback = readbackStub(paidReadback({ orderRef: intentId }))
    const results = await Promise.all([
      run({ ledger, intentId, readback }),
      run({ ledger, intentId, readback }),
      run({ ledger, intentId, readback }),
    ])
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
    expect(results.filter((r) => r.kind === 'PAYMENT_OBSERVED')).toHaveLength(1)
    expect(results.filter((r) => r.kind === 'REPLAY')).toHaveLength(2)
  })

  it('같은 eventId에 다른 본문이 오면 EVENT_CONFLICT이고 덮어쓰지 않는다', async () => {
    const { ledger, intentId } = storedIntent()
    const readback = readbackStub(paidReadback({ orderRef: intentId }))
    await run({ ledger, intentId, readback, eventId: 'evt-1' })
    const conflict = await run({
      ledger, intentId, readback, eventId: 'evt-1', body: bodyFor(intentId, { paymentRef: 'pay-2' }),
    })
    expect(conflict.kind).toBe('NEEDS_REVIEW')
    if (conflict.kind !== 'NEEDS_REVIEW') throw new Error('expected NEEDS_REVIEW')
    expect(conflict.reasons).toContain('EVENT_CONFLICT')
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
  })

  it('결제 URL만 받은 intent는 캡처 없이 REQUESTED에 머문다', async () => {
    const { ledger, intentId } = storedIntent()
    ledger.markRequested(WS_A, intentId, {
      checkoutUrl: 'https://checkout.example.invalid/pay/x', acceptanceRef: 'test-request:1',
    })
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('REQUESTED')
    expect(ledger.listCaptures(WS_A)).toHaveLength(0)
  })
})

describe('processPaymentWebhook — 불일치·미확인', () => {
  it.each([
    ['금액 불일치', { amountKrw: 20000 }, 'AMOUNT_MISMATCH'],
    ['통화 불일치', { currency: 'USD' as unknown as 'KRW' }, 'CURRENCY_MISMATCH'],
    ['merchant 불일치', { merchantRef: 'other-shop' }, 'MERCHANT_MISMATCH'],
  ])('%s → NEEDS_REVIEW이고 capture를 만들지 않는다', async (_label, change, reason) => {
    const { ledger, intentId } = storedIntent()
    const readback = readbackStub(paidReadback({ orderRef: intentId }))
    const result = await run({ ledger, intentId, readback, body: bodyFor(intentId, change) })
    expect(result.kind).toBe('NEEDS_REVIEW')
    if (result.kind !== 'NEEDS_REVIEW') throw new Error('expected NEEDS_REVIEW')
    expect(result.reasons).toContain(reason)
    expect(ledger.listCaptures(WS_A)).toHaveLength(0)
  })

  it('orderRef가 intent와 다르면 NEEDS_REVIEW', async () => {
    const { ledger, intentId } = storedIntent()
    const readback = readbackStub(paidReadback({ orderRef: intentId }))
    const result = await run({ ledger, intentId, readback, body: bodyFor(intentId, { orderRef: 'order-other' }) })
    expect(result.kind).toBe('NEEDS_REVIEW')
    if (result.kind !== 'NEEDS_REVIEW') throw new Error('expected NEEDS_REVIEW')
    expect(result.reasons).toContain('ORDER_MISMATCH')
    expect(ledger.listCaptures(WS_A)).toHaveLength(0)
  })

  it.each([
    ['PENDING', { status: 'PENDING' as const }],
    ['NOT_FOUND', { status: 'NOT_FOUND' as const }],
    ['ERROR', { status: 'ERROR' as const }],
  ])('독립 조회가 %s이면 UNCONFIRMED(수납 아님)', async (_label, readbackResult) => {
    const { ledger, intentId } = storedIntent()
    const readback = readbackStub(readbackResult as ReadbackResult)
    const result = await run({ ledger, intentId, readback })
    expect(result.kind).toBe('UNCONFIRMED')
    expect(ledger.listCaptures(WS_A)).toHaveLength(0)
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('PREPARED')
  })

  it('조회 금액이 본문과 다르면 MISMATCH → NEEDS_REVIEW', async () => {
    const { ledger, intentId } = storedIntent()
    const readback = readbackStub(paidReadback({ orderRef: intentId, amountKrw: 5000 }))
    const result = await run({ ledger, intentId, readback })
    expect(result.kind).toBe('NEEDS_REVIEW')
    expect(ledger.listCaptures(WS_A)).toHaveLength(0)
  })
})

describe('processPaymentWebhook — 늦은 입금·취소·충돌·격리', () => {
  it('만료 후 입금은 capture를 기록하고 NEEDS_REVIEW로 대사 큐에 남긴다', async () => {
    const { ledger, intentId } = storedIntent()
    ledger.expire(WS_A, intentId)
    const lateNow = new Date('2026-10-23T00:00:00Z')
    const readback = readbackStub(paidReadback({ orderRef: intentId, paidAt: lateNow }))
    const result = await run({ ledger, intentId, readback, now: lateNow })
    expect(result.kind).toBe('NEEDS_REVIEW')
    expect(result.bookingEffects).toBe(0)
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
    expect(ledger.listReconciliationQueue(WS_A).map((e) => e.reason)).toContain('EXPIRED_INTENT')
  })

  it('취소된 예약의 입금도 예약을 되살리지 않는다', async () => {
    const { ledger, intentId } = storedIntent()
    const readback = readbackStub(paidReadback({ orderRef: intentId }))
    const result = await processPaymentWebhook({
      ledger, verifier, readback, context: makeContext(), expectedScope: scopeFor(intentId),
      rawBody: encode(bodyFor(intentId)),
      headers: headersFor(scopeFor(intentId), encode(bodyFor(intentId))),
      now: NOW_DATE,
      currentBooking: { ...booking, status: 'CANCELLED' },
    })
    expect(result.kind).toBe('NEEDS_REVIEW')
    expect(result.bookingEffects).toBe(0)
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
    expect(ledger.listReconciliationQueue(WS_A).map((e) => e.reason)).toContain('BOOKING_CANCELLED')
  })

  it('같은 paymentRef가 다른 intent에 오면 PAYMENT_REF_CONFLICT', async () => {
    const { ledger, intentId } = storedIntent()
    const readback = readbackStub(paidReadback({ orderRef: intentId }))
    await run({ ledger, intentId, readback, eventId: 'evt-1' })

    // 다른 예약(booking-b)의 intent
    const bookingB: BookingFact = { ...booking, bookingId: 'booking-b' }
    const preparedB = prepareDepositIntent(
      { ...baseRequest, bookingId: 'booking-b', idempotencyKey: 'booking-b-v2-deposit' }, bookingB, NOW
    )
    if (preparedB.status !== 'DRAFT' || !preparedB.intent) throw new Error('fixture')
    const second = ledger.storeIntent({ snapshot: preparedB.intent, booking: bookingB, now: NOW_DATE })
    if (second.kind !== 'COMMITTED') throw new Error('fixture')

    const conflict = await run({
      ledger, intentId: second.intent.intentId,
      readback: readbackStub(paidReadback({ orderRef: second.intent.intentId })),
      eventId: 'evt-2',
      body: bodyFor(second.intent.intentId, { paymentRef: 'pay-1', orderRef: second.intent.intentId }),
      currentBooking: bookingB,
    })
    expect(conflict.kind).toBe('NEEDS_REVIEW')
    if (conflict.kind !== 'NEEDS_REVIEW') throw new Error('expected NEEDS_REVIEW')
    expect(conflict.reasons).toContain('PAYMENT_REF_CONFLICT')
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
  })

  it('다른 워크스페이스 서명으로 타 워크스페이스 intent를 건드릴 수 없다', async () => {
    const { ledger, intentId } = storedIntent()
    const foreignScope = scopeFor(intentId, WS_B)
    const rawBody = encode(bodyFor(intentId))
    const readback = readbackStub(paidReadback({ orderRef: intentId }))
    const result = await run({
      ledger, intentId, readback, rawBody, scope: foreignScope, headers: headersFor(foreignScope, rawBody),
    })
    expect(result.kind).toBe('REJECTED')
    expect(readback.calls).toHaveLength(0)
    expect(ledger.listCaptures(WS_A)).toHaveLength(0)
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('PREPARED')
  })

  it('본문의 workspaceId는 신뢰하지 않고 서명된 scope만 쓴다', async () => {
    const { ledger, intentId } = storedIntent()
    const rawBody = encode({ ...bodyFor(intentId), workspaceId: WS_B })
    const readback = readbackStub(paidReadback({ orderRef: intentId }))
    const result = await run({ ledger, intentId, readback, rawBody })
    expect(result.kind).toBe('PAYMENT_OBSERVED')
    expect(ledger.listCaptures(WS_A)).toHaveLength(1)
    expect(ledger.listCaptures(WS_B)).toHaveLength(0)
  })
})
