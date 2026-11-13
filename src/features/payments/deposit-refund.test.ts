import { describe, expect, it } from 'vitest'
import { prepareDepositIntent } from './deposit-intent'
import { TestDepositLedger, type BookingFact } from './deposit-ledger'
import { reconcileRefund, requestRefund, type RefundReadbackPort, type RefundReadbackResult } from './deposit-refund'
import { MinimalTestTransport } from '../policy-gate/testing/minimal-transport'
import type { Context } from '../policy-gate/testing/minimal-admission'

const NOW = '2026-10-21T10:00:00Z'
const NOW_DATE = new Date(NOW)
const PAID_AT = new Date('2026-10-21T11:00:00Z')
const WS_A = '11111111-1111-4111-8111-111111111111'
const WS_B = '99999999-9999-4999-8999-999999999999'

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

function makeContext(): Context {
  return {
    controls: {
      mode: 'TEST_FAKE_ONLY', datasetMode: 'TEST', allowedWorkspaceIds: [WS_A, WS_B], killSwitch: false,
    },
    now: NOW_DATE,
    evaluator: () => ({ ready: true }),
  }
}

function capturedLedger() {
  const ledger = new TestDepositLedger()
  const prepared = prepareDepositIntent(baseRequest, booking, NOW)
  if (prepared.status !== 'DRAFT' || !prepared.intent) throw new Error('fixture')
  const stored = ledger.storeIntent({ snapshot: prepared.intent, booking, now: NOW_DATE })
  if (stored.kind !== 'COMMITTED') throw new Error('fixture')
  const paid = ledger.commitPaymentObservation({
    workspaceId: WS_A, provider: 'portone', eventId: 'evt-1', payloadDigest: 'sha256:aaa',
    intentId: stored.intent.intentId, paymentRef: 'pay-1', observedAmountKrw: 10000,
    currency: 'KRW', paidAt: PAID_AT, bookingNow: booking, outcome: 'MATCHED', now: PAID_AT,
  })
  if (paid.kind !== 'MATCHED') throw new Error('fixture: expected MATCHED')
  return { ledger, intentId: stored.intent.intentId }
}

function refundArgs(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WS_A,
    captureRef: 'pay-1',
    operationKey: 'refund-op-1',
    amountKrw: 10000,
    reason: '예약 취소',
    ruleVersion: 'refund-1',
    now: NOW_DATE,
    ...overrides,
  }
}

function readbackStub(result: RefundReadbackResult): RefundReadbackPort & { calls: unknown[] } {
  const calls: unknown[] = []
  const port = (async (input: unknown) => {
    calls.push(input)
    return result
  }) as unknown as RefundReadbackPort & { calls: unknown[] }
  port.calls = calls
  return port
}

describe('requestRefund', () => {
  it('ACCEPTED면 REQUESTED가 되고 "환불 완료"로 표시하지 않는다', async () => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const result = await requestRefund({
      ledger, transport, context: makeContext(), ...refundArgs(),
    })
    expect(result.kind).toBe('REQUESTED')
    if (result.kind !== 'REQUESTED') throw new Error('expected REQUESTED')
    expect(result.refund.state).toBe('REQUESTED')
    expect(result.refundDone).toBe(false)
    expect(result.bookingStatusChanged).toBe(false)
    expect(result.actualVerified).toBe(false)
    expect(transport.getAttemptCount()).toBe(1)
  })

  it('UNKNOWN이면 재호출을 봉인하고 같은 키 재시도도 transport를 부르지 않는다', async () => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_UNKNOWN'])
    const first = await requestRefund({ ledger, transport, context: makeContext(), ...refundArgs() })
    expect(first.kind).toBe('UNKNOWN')
    expect(ledger.getRefund(WS_A, 'refund-op-1')?.state).toBe('UNKNOWN')

    const retry = await requestRefund({ ledger, transport, context: makeContext(), ...refundArgs() })
    expect(retry.kind).toBe('UNKNOWN_REPLAY')
    expect(transport.getAttemptCount()).toBe(1)

    // 다른 키로도 새 환불 금지
    const other = await requestRefund({
      ledger, transport, context: makeContext(), ...refundArgs({ operationKey: 'refund-op-2', amountKrw: 1000 }),
    })
    expect(other.kind).toBe('HOLD_UNKNOWN_REFUND')
    expect(transport.getAttemptCount()).toBe(1)
  })

  it('거부되면 예약을 해제하고 가용액을 되돌린다', async () => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_REJECTED', 'TEST_ACCEPTED'])
    const result = await requestRefund({ ledger, transport, context: makeContext(), ...refundArgs() })
    expect(result.kind).toBe('REJECTED')
    expect(ledger.getRefund(WS_A, 'refund-op-1')?.state).toBe('REJECTED')
    // 가용액 복구: 다시 10000 전액 환불 가능
    const retry = await requestRefund({
      ledger, transport, context: makeContext(), ...refundArgs({ operationKey: 'refund-op-2' }),
    })
    expect(retry.kind).toBe('REQUESTED')
  })

  it('admission이 거부하면 RESERVED가 남지 않는다', async () => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const result = await requestRefund({
      ledger, transport,
      context: { ...makeContext(), controls: { mode: 'TEST_FAKE_ONLY', datasetMode: 'ACTUAL', allowedWorkspaceIds: [WS_A], killSwitch: false } },
      ...refundArgs(),
    })
    expect(result.kind).toBe('DENIED')
    expect(ledger.getRefund(WS_A, 'refund-op-1')).toBeUndefined()
    expect(transport.getAttemptCount()).toBe(0)
  })

  it('같은 키 동시 요청에서도 transport 시도는 1회다', async () => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED', 'TEST_ACCEPTED'])
    const args = { ledger, transport, context: makeContext(), ...refundArgs() }
    const results = await Promise.all([requestRefund(args), requestRefund(args)])
    expect(transport.getAttemptCount()).toBe(1)
    expect(results.filter((r) => r.kind === 'REQUESTED')).toHaveLength(1)
    expect(results.filter((r) => r.kind === 'REPLAY')).toHaveLength(1)
  })

  it('captured를 넘는 금액은 transport 없이 거부한다', async () => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const result = await requestRefund({
      ledger, transport, context: makeContext(), ...refundArgs({ amountKrw: 10001 }),
    })
    expect(result.kind).toBe('EXCEEDS_AVAILABLE')
    expect(transport.getAttemptCount()).toBe(0)
  })

  it('다른 워크스페이스 capture는 환불할 수 없다', async () => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const result = await requestRefund({
      ledger, transport, context: makeContext(), ...refundArgs({ workspaceId: WS_B }),
    })
    expect(result.kind).toBe('CAPTURE_NOT_FOUND')
    expect(transport.getAttemptCount()).toBe(0)
  })

  it('분쟁 중인 capture는 환불하지 않는다', async () => {
    const { ledger } = capturedLedger()
    ledger.markDisputed(WS_A, 'pay-1')
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const result = await requestRefund({ ledger, transport, context: makeContext(), ...refundArgs() })
    expect(result.kind).toBe('BLOCKED_DISPUTE')
    expect(transport.getAttemptCount()).toBe(0)
  })
})

describe('reconcileRefund', () => {
  it('CANCELLED이고 금액이 맞으면 TEST_REFUND_MATCHED로 확정한다', async () => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_UNKNOWN'])
    await requestRefund({ ledger, transport, context: makeContext(), ...refundArgs() })
    // 실제로는 수행됐다고 시뮬레이션
    ledger.markRefundDispatched(WS_A, 'refund-op-1', { acceptanceRef: 'r' })
    const readback = readbackStub({ status: 'CANCELLED', amountKrw: 10000, cancellationRef: 'cancel-1' })
    const result = await reconcileRefund({
      ledger, readback, workspaceId: WS_A, operationKey: 'refund-op-1', now: NOW_DATE,
    })
    expect(result.kind).toBe('MATCHED')
    expect(ledger.getRefund(WS_A, 'refund-op-1')?.state).toBe('TEST_REFUND_MATCHED')
    expect(ledger.getRefund(WS_A, 'refund-op-1')?.cancellationRef).toBe('cancel-1')
    expect(transport.getAttemptCount()).toBe(1)
    expect(result.bookingStatusChanged).toBe(false)
  })

  it('금액이 다르면 NEEDS_REVIEW로 보낸다', async () => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    await requestRefund({ ledger, transport, context: makeContext(), ...refundArgs() })
    const readback = readbackStub({ status: 'CANCELLED', amountKrw: 9000, cancellationRef: 'cancel-1' })
    const result = await reconcileRefund({
      ledger, readback, workspaceId: WS_A, operationKey: 'refund-op-1', now: NOW_DATE,
    })
    expect(result.kind).toBe('NEEDS_REVIEW')
    expect(ledger.getRefund(WS_A, 'refund-op-1')?.state).toBe('NEEDS_REVIEW')
  })

  it.each([
    ['PENDING', { status: 'PENDING' as const }],
    ['NOT_FOUND', { status: 'NOT_FOUND' as const }],
    ['ERROR', { status: 'ERROR' as const }],
  ])('%s이면 상태를 바꾸지 않는다', async (_label, readbackResult) => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_UNKNOWN'])
    await requestRefund({ ledger, transport, context: makeContext(), ...refundArgs() })
    const readback = readbackStub(readbackResult as RefundReadbackResult)
    const result = await reconcileRefund({
      ledger, readback, workspaceId: WS_A, operationKey: 'refund-op-1', now: NOW_DATE,
    })
    expect(result.kind).toBe('UNCHANGED')
    expect(ledger.getRefund(WS_A, 'refund-op-1')?.state).toBe('UNKNOWN')
  })

  it('다른 워크스페이스에서는 조회·확정할 수 없다', async () => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    await requestRefund({ ledger, transport, context: makeContext(), ...refundArgs() })
    const readback = readbackStub({ status: 'CANCELLED', amountKrw: 10000, cancellationRef: 'cancel-1' })
    const result = await reconcileRefund({
      ledger, readback, workspaceId: WS_B, operationKey: 'refund-op-1', now: NOW_DATE,
    })
    expect(result.kind).toBe('REFUND_NOT_FOUND')
    expect(ledger.getRefund(WS_A, 'refund-op-1')?.state).toBe('REQUESTED')
  })
})

describe('환불과 예약 취소의 독립성', () => {
  it('취소된 예약의 예약금도 환불할 수 있다', async () => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const result = await requestRefund({
      ledger, transport, context: makeContext(), ...refundArgs({ reason: '예약 취소' }),
    })
    expect(result.kind).toBe('REQUESTED')
    expect(result.bookingStatusChanged).toBe(false)
  })

  it('환불이 진행 중이어도 예약 상태를 바꾸지 않는다', async () => {
    const { ledger } = capturedLedger()
    const transport = new MinimalTestTransport(['TEST_UNKNOWN'])
    const pending = await requestRefund({ ledger, transport, context: makeContext(), ...refundArgs() })
    expect(pending.bookingStatusChanged).toBe(false)
    const readback = readbackStub({ status: 'PENDING' })
    const reconciled = await reconcileRefund({
      ledger, readback, workspaceId: WS_A, operationKey: 'refund-op-1', now: NOW_DATE,
    })
    expect(reconciled.bookingStatusChanged).toBe(false)
    expect(ledger.getRefund(WS_A, 'refund-op-1')?.state).toBe('UNKNOWN')
  })

  it('늦은 결제 대사 큐 항목은 자동 환불을 만들지 않는다', async () => {
    const { ledger, intentId } = capturedLedger()
    // 만료 후 입금 → 대사 큐 항목만 생기고 환불은 없다.
    const late = ledger.commitPaymentObservation({
      workspaceId: WS_A, provider: 'portone', eventId: 'evt-late', payloadDigest: 'sha256:late',
      intentId, paymentRef: 'pay-late', observedAmountKrw: 10000, currency: 'KRW',
      paidAt: new Date('2026-10-23T00:00:00Z'), bookingNow: booking, outcome: 'MATCHED',
      now: new Date('2026-10-23T00:00:00Z'),
    })
    expect(late.kind).toBe('NEEDS_REVIEW')
    expect(ledger.listReconciliationQueue(WS_A).length).toBeGreaterThan(0)
    expect(ledger.listRefunds(WS_A)).toHaveLength(0)
  })
})
