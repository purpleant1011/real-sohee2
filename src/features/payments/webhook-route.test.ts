import { describe, expect, it, vi } from 'vitest'
import { handleDepositWebhook, preflightDepositWebhook, type WebhookRouteEnv } from './webhook-route'
import type { BookingFact } from './deposit-ledger'
import {
  LedgerPortError,
  type CommitPaymentObservationCommand,
  type PaymentLedgerPort,
  type PersistentPaymentResult,
} from './ledger-port'
import type { ReadbackPort, ReadbackResult } from './payment-webhook'
import {
  MinimalTestWebhookVerifier,
  signMinimalTestPayload,
  type TestVerifier,
  type TestVerifyInput,
} from './testing/minimal-webhook-verifier'
import type { Context, Scope } from '../policy-gate/testing/minimal-admission'

const NOW = '2026-10-21T10:00:00Z'
const NOW_DATE = new Date(NOW)
const WS_A = '11111111-1111-4111-8111-111111111111'
const WS_B = '99999999-9999-4999-8999-999999999999'
const INTENT_ID = '22222222-2222-4222-8222-222222222222'
const SECRET = 'route-test-secret-value'

const booking: BookingFact = {
  workspaceId: WS_A,
  bookingId: 'booking-a',
  customerId: 'customer-a',
  version: 2,
  serviceVersion: 'catalog-2',
  status: 'CONFIRMED',
  totalServicePriceKrw: 50000,
}

const body = {
  type: 'PAYMENT_PAID',
  intentId: INTENT_ID,
  merchantRef: 'shop-merchant',
  orderRef: 'order-ref-1',
  paymentRef: 'pay-1',
  amountKrw: 10000,
  currency: 'KRW',
}

const paid: ReadbackResult = {
  status: 'PAID',
  amountKrw: 10000,
  currency: 'KRW',
  paidAt: new Date('2026-10-21T09:50:00Z'),
  orderRef: 'order-ref-1',
}

const pending: ReadbackResult = { status: 'PENDING' }

const RECORDED: PersistentPaymentResult = {
  kind: 'TEST_CAPTURE_RECORDED',
  captureRef: 'pay-1',
  datasetMode: 'TEST',
  actualVerified: false,
}

const REPLAY: PersistentPaymentResult = { kind: 'REPLAY', outcome: 'MATCHED', datasetMode: 'TEST', actualVerified: false }

const NEEDS_REVIEW: PersistentPaymentResult = {
  kind: 'NEEDS_REVIEW',
  reason: 'LATE_PAYMENT',
  datasetMode: 'TEST',
  actualVerified: false,
}

const INTENT_NOT_FOUND: PersistentPaymentResult = { kind: 'INTENT_NOT_FOUND', datasetMode: 'TEST', actualVerified: false }

const ENV_BASE: WebhookRouteEnv = {
  DEPOSIT_WEBHOOK_ENABLED: '1',
  DEPOSIT_WEBHOOK_WORKSPACE_ALLOWLIST: `${WS_A},${WS_B}`,
  DEPOSIT_WEBHOOK_TEST_SECRET: SECRET,
  NODE_ENV: 'test',
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
}

function scopeFor(workspaceId: string = WS_A): Scope {
  return { workspaceId, provider: 'portone', action: 'payment', operationKey: `webhook-${INTENT_ID}` }
}

function headersFor(
  scope: Scope,
  rawBody: Uint8Array,
  eventId = 'evt-1',
  timestamp = NOW,
  secret = SECRET
): Record<string, string> {
  return signMinimalTestPayload({
    secret,
    protocol: 'SOHEE_MINIMAL_TEST_V1',
    timestamp,
    eventId,
    scope,
    rawBody,
  })
}

type LedgerScript = PersistentPaymentResult | Error

function makeLedger(script: LedgerScript | ((input: CommitPaymentObservationCommand) => LedgerScript)) {
  const calls: CommitPaymentObservationCommand[] = []
  const port: PaymentLedgerPort = {
    async commitPaymentObservation(input) {
      calls.push(input)
      const next = typeof script === 'function' ? script(input) : script
      if (next instanceof Error) throw next
      return next
    },
    async reserveRefund() {
      throw new Error('reserveRefund must never be called from the deposit webhook route')
    },
  }
  return { port, calls }
}

function makeReadback(result: ReadbackResult | Error) {
  const calls: Array<{ workspaceId: string; paymentRef: string }> = []
  const port: ReadbackPort = async (input) => {
    calls.push({ workspaceId: input.workspaceId, paymentRef: input.paymentRef })
    if (result instanceof Error) throw result
    return result
  }
  return { port, calls }
}

function makeBookingLookup(result: BookingFact | null | Error) {
  const calls: Array<{ workspaceId: string; intentId: string }> = []
  const lookup = async (query: { workspaceId: string; intentId: string }): Promise<BookingFact | null> => {
    calls.push({ workspaceId: query.workspaceId, intentId: query.intentId })
    if (result instanceof Error) throw result
    return result
  }
  return { lookup, calls }
}

function makeVerifier(secret = SECRET) {
  const inner = new MinimalTestWebhookVerifier({ secret })
  const state = { calls: 0 }
  const verifier: TestVerifier = {
    async verify(context: Context, input: TestVerifyInput) {
      state.calls += 1
      return inner.verify(context, input)
    },
  }
  return { verifier, state }
}

async function run(
  options: {
    env?: WebhookRouteEnv
    ledgerScript?: LedgerScript | ((input: CommitPaymentObservationCommand) => LedgerScript)
    readbackResult?: ReadbackResult | Error
    bookingResult?: BookingFact | null | Error
    body?: unknown
    rawBody?: Uint8Array
    scope?: Scope
    headers?: Record<string, string>
  } = {}
) {
  const ledger = makeLedger(options.ledgerScript ?? RECORDED)
  const readback = makeReadback(options.readbackResult ?? paid)
  const bookingLookup = makeBookingLookup(options.bookingResult === undefined ? booking : options.bookingResult)
  const verifier = makeVerifier()
  const scope = options.scope ?? scopeFor()
  const rawBody = options.rawBody ?? encode(options.body ?? body)
  const headers = options.headers ?? headersFor(scope, rawBody)

  const response = await handleDepositWebhook({
    deps: {
      env: options.env ?? ENV_BASE,
      now: () => NOW_DATE,
      ledger: ledger.port,
      verifier: verifier.verifier,
      readback: readback.port,
      currentBooking: bookingLookup.lookup,
    },
    rawBody,
    headers,
  })

  return {
    response,
    ledgerCalls: ledger.calls,
    readbackCalls: readback.calls,
    bookingCalls: bookingLookup.calls,
    verifierCalls: verifier.state.calls,
  }
}

describe('preflightDepositWebhook — 기본 OFF / TEST 전용', () => {
  it('플래그가 없으면 503 WEBHOOK_DISABLED 를 낸다', () => {
    const env: WebhookRouteEnv = { ...ENV_BASE, DEPOSIT_WEBHOOK_ENABLED: undefined }
    expect(preflightDepositWebhook(env)).toEqual({ status: 503, body: { ok: false, code: 'WEBHOOK_DISABLED' } })
  })

  it("플래그가 '1'이 아니면 모두 거부한다", () => {
    for (const value of ['0', 'true', 'yes', ' 1', '1 ', 'ON', '']) {
      const result = preflightDepositWebhook({ ...ENV_BASE, DEPOSIT_WEBHOOK_ENABLED: value })
      expect(result?.status).toBe(503)
      expect(result?.body.code).toBe('WEBHOOK_DISABLED')
    }
  })

  it('production 에서는 플래그와 무관하게 503 PRODUCTION_FORBIDDEN 이다', () => {
    expect(preflightDepositWebhook({ ...ENV_BASE, NODE_ENV: 'production' })).toEqual({
      status: 503,
      body: { ok: false, code: 'PRODUCTION_FORBIDDEN' },
    })
    expect(
      preflightDepositWebhook({ ...ENV_BASE, NODE_ENV: 'production', DEPOSIT_WEBHOOK_ENABLED: undefined })
    ).toEqual({ status: 503, body: { ok: false, code: 'PRODUCTION_FORBIDDEN' } })
    expect(
      preflightDepositWebhook({ ...ENV_BASE, NODE_ENV: 'production', DEPOSIT_WEBHOOK_ENABLED: '0' })
    ).toEqual({ status: 503, body: { ok: false, code: 'PRODUCTION_FORBIDDEN' } })
  })

  it('플래그 ON + 비 production 이면 통과(null)', () => {
    expect(preflightDepositWebhook(ENV_BASE)).toBeNull()
  })
})

describe('handleDepositWebhook — 게이트 실패 시 부작용 0', () => {
  it('플래그 OFF 면 본문이 깨져 있어도 파싱/검증/원장/readback 0회다', async () => {
    const result = await run({
      env: { ...ENV_BASE, DEPOSIT_WEBHOOK_ENABLED: undefined },
      rawBody: encode('not-json-at-all'),
      headers: { 'x-sohee-test-workspace': WS_A },
    })

    expect(result.response.status).toBe(503)
    expect(result.response.body).toEqual({ ok: false, code: 'WEBHOOK_DISABLED' })
    expect(result.verifierCalls).toBe(0)
    expect(result.ledgerCalls).toHaveLength(0)
    expect(result.readbackCalls).toHaveLength(0)
    expect(result.bookingCalls).toHaveLength(0)
  })

  it('production 이면 503 PRODUCTION_FORBIDDEN 이고 아무 것도 호출하지 않는다', async () => {
    const result = await run({ env: { ...ENV_BASE, NODE_ENV: 'production' } })

    expect(result.response).toEqual({ status: 503, body: { ok: false, code: 'PRODUCTION_FORBIDDEN' } })
    expect(result.verifierCalls).toBe(0)
    expect(result.ledgerCalls).toHaveLength(0)
    expect(result.readbackCalls).toHaveLength(0)
  })

  it('production 이면 플래그가 꺼져 있어도 PRODUCTION_FORBIDDEN 이고 아무 것도 호출하지 않는다', async () => {
    const result = await run({ env: { ...ENV_BASE, NODE_ENV: 'production', DEPOSIT_WEBHOOK_ENABLED: undefined } })

    expect(result.response).toEqual({ status: 503, body: { ok: false, code: 'PRODUCTION_FORBIDDEN' } })
    expect(result.verifierCalls).toBe(0)
    expect(result.ledgerCalls).toHaveLength(0)
  })

  it('allowlist 가 비었거나 / * / 비UUID / 다른 workspace 면 403 이고 검증·원장 0회다', async () => {
    const cases: Array<{ label: string; allowlist: string | undefined; scopeWorkspace?: string }> = [
      { label: '미설정', allowlist: undefined },
      { label: '빈 문자열', allowlist: '' },
      { label: '공백만', allowlist: '   ' },
      { label: '와일드카드', allowlist: '*' },
      { label: '와일드카드 혼합', allowlist: `${WS_A},*` },
      { label: '비UUID', allowlist: 'not-a-uuid' },
      { label: '빈 항목', allowlist: `${WS_A},,${WS_B}` },
      { label: '타 workspace', allowlist: WS_B },
    ]

    for (const testCase of cases) {
      const result = await run({
        env: { ...ENV_BASE, DEPOSIT_WEBHOOK_WORKSPACE_ALLOWLIST: testCase.allowlist },
        scope: scopeFor(testCase.scopeWorkspace ?? WS_A),
      })

      expect(result.response.status, testCase.label).toBe(403)
      expect(result.response.body.code, testCase.label).toBe('WORKSPACE_NOT_ALLOWED')
      expect(result.verifierCalls, testCase.label).toBe(0)
      expect(result.ledgerCalls, testCase.label).toHaveLength(0)
      expect(result.readbackCalls, testCase.label).toHaveLength(0)
    }
  })

  it('서명 헤더에 workspace 가 없으면 403 이다', async () => {
    const result = await run({ headers: {} })
    expect(result.response.status).toBe(403)
    expect(result.response.body.code).toBe('WORKSPACE_NOT_ALLOWED')
    expect(result.ledgerCalls).toHaveLength(0)
  })

  it('TEST secret 이 비어 있으면 503 TEST_SECRET_MISSING 이다', async () => {
    for (const secret of ['', '   ', undefined]) {
      const result = await run({ env: { ...ENV_BASE, DEPOSIT_WEBHOOK_TEST_SECRET: secret } })
      expect(result.response.status).toBe(503)
      expect(result.response.body.code).toBe('TEST_SECRET_MISSING')
      expect(result.verifierCalls).toBe(0)
      expect(result.ledgerCalls).toHaveLength(0)
    }
  })

  it('서명이 틀리면 401 이고 원장·readback 0회다', async () => {
    const signedBody = encode(body)
    const otherBody = encode({ ...body, amountKrw: 99999 })
    const cases: Array<{ label: string; headers: Record<string, string> }> = [
      { label: '다른 secret', headers: headersFor(scopeFor(), signedBody, 'evt-1', NOW, 'other-secret') },
      { label: '본문 변조', headers: headersFor(scopeFor(), otherBody) },
      { label: '서명 헤더 누락', headers: { 'x-sohee-test-workspace': WS_A } },
    ]

    for (const testCase of cases) {
      const result = await run({ headers: testCase.headers })
      expect(result.response.status, testCase.label).toBe(401)
      expect(result.response.body.code, testCase.label).toBe('SIGNATURE_INVALID')
      expect(result.ledgerCalls, testCase.label).toHaveLength(0)
      expect(result.readbackCalls, testCase.label).toHaveLength(0)
      expect(result.bookingCalls, testCase.label).toHaveLength(0)
    }
  })

  it('서명된 scope 의 provider/action 이 payment/portone 이 아니면 401 이다', async () => {
    const rawBody = encode(body)
    const refundScope: Scope = { ...scopeFor(), action: 'refund' }
    const result = await run({ rawBody, headers: headersFor(refundScope, rawBody) })

    expect(result.response.status).toBe(401)
    expect(result.response.body.code).toBe('SIGNATURE_INVALID')
    expect(result.ledgerCalls).toHaveLength(0)
  })
})

describe('handleDepositWebhook — 본문/원장 계약', () => {
  it('서명은 맞지만 본문이 JSON 이 아니면 400 INVALID_REQUEST 다', async () => {
    const rawBody = encode('definitely-not-json')
    const result = await run({ rawBody, headers: headersFor(scopeFor(), rawBody) })

    expect(result.response).toEqual({ status: 400, body: { ok: false, code: 'INVALID_REQUEST' } })
    expect(result.ledgerCalls).toHaveLength(0)
  })

  it('strict 스키마에 없는 필드(datasetMode=ACTUAL)는 400 으로 거부한다', async () => {
    const result = await run({ body: { ...body, datasetMode: 'ACTUAL' } })

    expect(result.response.status).toBe(400)
    expect(result.response.body.code).toBe('INVALID_REQUEST')
    expect(result.ledgerCalls).toHaveLength(0)
  })

  it('필수 필드가 빠지면 400 이다', async () => {
    const withoutPaymentRef = {
      type: body.type,
      intentId: body.intentId,
      merchantRef: body.merchantRef,
      orderRef: body.orderRef,
      amountKrw: body.amountKrw,
      currency: body.currency,
    }
    const result = await run({ body: withoutPaymentRef })

    expect(result.response.status).toBe(400)
    expect(result.response.body.code).toBe('INVALID_REQUEST')
    expect(result.ledgerCalls).toHaveLength(0)
  })

  it('readback PAID 일치 + 원장 MATCHED 면 200 TEST_CAPTURE_RECORDED 이고 예약 효과 키가 없다', async () => {
    const result = await run()

    expect(result.response).toEqual({ status: 200, body: { ok: true, code: 'TEST_CAPTURE_RECORDED' } })
    expect(result.response.body).not.toHaveProperty('bookingEffects')
    expect(result.bookingCalls).toEqual([{ workspaceId: WS_A, intentId: INTENT_ID }])
    expect(result.readbackCalls).toEqual([{ workspaceId: WS_A, paymentRef: 'pay-1' }])
    expect(result.ledgerCalls).toHaveLength(1)
    expect(result.ledgerCalls[0]).toMatchObject({
      workspaceId: WS_A,
      intentId: INTENT_ID,
      paymentRef: 'pay-1',
      amountKrw: 10000,
      currency: 'KRW',
      outcome: 'MATCHED',
      eventId: 'evt-1',
    })
    expect(result.ledgerCalls[0].payloadDigest.startsWith('sha256:')).toBe(true)
  })

  it('본문의 workspaceId 는 신뢰하지 않고 서명된 workspace 만 쓴다', async () => {
    const result = await run({ body: { ...body, workspaceId: WS_B } })

    expect(result.response.status).toBe(200)
    expect(result.ledgerCalls[0].workspaceId).toBe(WS_A)
  })

  it('같은 이벤트 재전송(원장 REPLAY)은 200 REPLAY 다', async () => {
    const result = await run({ ledgerScript: REPLAY })

    expect(result.response).toEqual({ status: 200, body: { ok: true, code: 'REPLAY' } })
  })

  it('readback PENDING 이면 원장에 UNCONFIRMED 로 남기고 202 UNCONFIRMED 다', async () => {
    const result = await run({ readbackResult: pending, ledgerScript: NEEDS_REVIEW })

    expect(result.response).toEqual({ status: 202, body: { ok: false, code: 'UNCONFIRMED' } })
    expect(result.ledgerCalls).toHaveLength(1)
    expect(result.ledgerCalls[0].outcome).toBe('UNCONFIRMED')
  })

  it('readback NOT_FOUND/ERROR 도 202 UNCONFIRMED 다', async () => {
    for (const readbackResult of [{ status: 'NOT_FOUND' as const }, { status: 'ERROR' as const }]) {
      const result = await run({ readbackResult, ledgerScript: NEEDS_REVIEW })
      expect(result.response.status).toBe(202)
      expect(result.response.body.code).toBe('UNCONFIRMED')
    }
  })

  it('readback 금액이 본문과 다르면 정산하지 않고 202 NEEDS_REVIEW 다', async () => {
    const result = await run({
      readbackResult: { ...paid, amountKrw: 5000 } as ReadbackResult,
      ledgerScript: NEEDS_REVIEW,
    })

    expect(result.response).toEqual({ status: 202, body: { ok: false, code: 'NEEDS_REVIEW' } })
    expect(result.ledgerCalls[0].outcome).toBe('MISMATCH')
  })

  it('원장이 INTENT_NOT_FOUND 면 404 다', async () => {
    const result = await run({ ledgerScript: INTENT_NOT_FOUND })

    expect(result.response).toEqual({ status: 404, body: { ok: false, code: 'INTENT_NOT_FOUND' } })
  })

  it('원장이 LEDGER_UNAVAILABLE 을 던지면 503 이고 원문을 노출하지 않는다', async () => {
    const result = await run({ ledgerScript: new LedgerPortError('LEDGER_UNAVAILABLE', 'rpc down at db-1') })

    expect(result.response.status).toBe(503)
    expect(result.response.body.code).toBe('LEDGER_UNAVAILABLE')
    expect(JSON.stringify(result.response.body)).not.toContain('rpc down')
  })

  it('원장이 LEDGER_CONTRACT_VIOLATION 을 던지면 500 이다', async () => {
    const result = await run({ ledgerScript: new LedgerPortError('LEDGER_CONTRACT_VIOLATION', 'weird payload') })

    expect(result.response).toEqual({ status: 500, body: { ok: false, code: 'LEDGER_CONTRACT_VIOLATION' } })
  })

  it('원장이 INVALID_LEDGER_INPUT 을 던지면 400 이다', async () => {
    const result = await run({ ledgerScript: new LedgerPortError('INVALID_LEDGER_INPUT', 'intentId') })

    expect(result.response).toEqual({ status: 400, body: { ok: false, code: 'INVALID_REQUEST' } })
  })

  it('원장이 알 수 없는 kind 를 돌려주면 성공으로 위장하지 않고 500 이다', async () => {
    const unknown = { kind: 'PAID_MATCHED', datasetMode: 'TEST', actualVerified: false } as unknown as PersistentPaymentResult
    const result = await run({ ledgerScript: unknown })

    expect(result.response).toEqual({ status: 500, body: { ok: false, code: 'LEDGER_CONTRACT_VIOLATION' } })
  })

  it('정산 결과가 요청 outcome 과 어긋나면 성공을 주장하지 않는다', async () => {
    const result = await run({ readbackResult: pending, ledgerScript: RECORDED })

    expect(result.response.status).toBe(500)
    expect(result.response.body.code).toBe('LEDGER_CONTRACT_VIOLATION')
  })

  it('예약이 확정 상태로 확인되지 않으면 정산하지 않고 202 NEEDS_REVIEW 다', async () => {
    const cases: Array<{ label: string; bookingResult: BookingFact | null }> = [
      { label: '예약 없음', bookingResult: null },
      { label: '취소됨', bookingResult: { ...booking, status: 'CANCELLED' } },
      { label: '다른 workspace', bookingResult: { ...booking, workspaceId: WS_B } },
    ]

    for (const testCase of cases) {
      const result = await run({ bookingResult: testCase.bookingResult, ledgerScript: NEEDS_REVIEW })
      expect(result.response.status, testCase.label).toBe(202)
      expect(result.response.body.code, testCase.label).toBe('NEEDS_REVIEW')
      expect(result.ledgerCalls[0].outcome, testCase.label).toBe('MISMATCH')
    }
  })

  it('예약 조회가 실패하면 원장을 쓰지 않고 500 이다', async () => {
    const result = await run({ bookingResult: new Error('booking db down') })

    expect(result.response.status).toBe(500)
    expect(result.response.body.code).toBe('INTERNAL_ERROR')
    expect(result.ledgerCalls).toHaveLength(0)
    expect(JSON.stringify(result.response.body)).not.toContain('booking db down')
  })

  it('readback 이 던지면 원장을 쓰지 않고 500 이다', async () => {
    const result = await run({ readbackResult: new Error('provider timeout') })

    expect(result.response.status).toBe(500)
    expect(result.response.body.code).toBe('INTERNAL_ERROR')
    expect(result.ledgerCalls).toHaveLength(0)
  })

  it('원장이 예상 밖 예외를 던져도 성공으로 위장하지 않는다', async () => {
    const result = await run({ ledgerScript: new Error('boom with secret ' + SECRET) })

    expect(result.response.status).toBe(500)
    expect(result.response.body.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(result.response.body)).not.toContain(SECRET)
  })

  it('응답 본문에는 금액·결제번호·secret·내부 kind 가 없다', async () => {
    const results = await Promise.all([
      run(),
      run({ ledgerScript: REPLAY }),
      run({ readbackResult: pending, ledgerScript: NEEDS_REVIEW }),
      run({ ledgerScript: INTENT_NOT_FOUND }),
    ])

    for (const result of results) {
      const text = JSON.stringify(result.response.body)
      expect(text).not.toContain('amount')
      expect(text).not.toContain('10000')
      expect(text).not.toContain('paymentRef')
      expect(text).not.toContain('pay-1')
      expect(text).not.toContain(SECRET)
      expect(text).not.toContain('kind')
      expect(text).not.toContain('captureRef')
      expect(Object.keys(result.response.body).sort()).toEqual(['code', 'ok'])
    }
  })

  it('처리 중 console 로그를 남기지 않는다', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
    const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}))

    try {
      await run()
      await run({ ledgerScript: new LedgerPortError('LEDGER_UNAVAILABLE', 'down') })
      for (const spy of spies) expect(spy.mock.calls).toHaveLength(0)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
