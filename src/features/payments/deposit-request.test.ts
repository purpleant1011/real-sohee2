import { describe, expect, it } from 'vitest'
import { prepareDepositIntent } from './deposit-intent'
import { TestDepositLedger, type BookingFact } from './deposit-ledger'
import { describeDepositForOwner, requestDeposit } from './deposit-request'
import { MinimalTestTransport } from '../policy-gate/testing/minimal-transport'
import type { Context } from '../policy-gate/testing/minimal-admission'

const NOW = '2026-10-21T10:00:00Z'
const NOW_DATE = new Date(NOW)
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

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    controls: {
      mode: 'TEST_FAKE_ONLY',
      datasetMode: 'TEST',
      allowedWorkspaceIds: [WS_A, WS_B],
      killSwitch: false,
    },
    now: NOW_DATE,
    evaluator: () => ({ ready: true }),
    ...overrides,
  }
}

function setup(overrides: Record<string, unknown> = {}) {
  const ledger = new TestDepositLedger()
  const prepared = prepareDepositIntent({ ...baseRequest, ...overrides }, booking, NOW)
  if (prepared.status !== 'DRAFT' || !prepared.intent) throw new Error('fixture: expected DRAFT')
  const stored = ledger.storeIntent({ snapshot: prepared.intent, booking, now: NOW_DATE })
  if (stored.kind !== 'COMMITTED') throw new Error('fixture: expected COMMITTED')
  return { ledger, intentId: stored.intent.intentId, snapshot: prepared.intent }
}

describe('requestDeposit', () => {
  it('정책이 NONE이면 PG를 호출하지 않는다', async () => {
    const ledger = new TestDepositLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const prepared = prepareDepositIntent({ ...baseRequest, policy: 'NONE' }, booking, NOW)
    expect(prepared.status).toBe('NOT_REQUIRED')
    const result = await requestDeposit({
      ledger, transport, context: makeContext(), workspaceId: WS_A,
      intentId: 'intent-does-not-exist', currentBooking: booking, now: NOW_DATE,
    })
    expect(result.kind).toBe('NO_DEPOSIT_REQUIRED')
    expect(transport.getAttemptCount()).toBe(0)
  })

  it('OPTIONAL 미선택이면 PG를 호출하지 않는다', async () => {
    const ledger = new TestDepositLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const prepared = prepareDepositIntent({ ...baseRequest, selected: false }, booking, NOW)
    expect(prepared.status).toBe('NOT_REQUIRED')
    const result = await requestDeposit({
      ledger, transport, context: makeContext(), workspaceId: WS_A,
      intentId: 'intent-does-not-exist', currentBooking: booking, now: NOW_DATE,
    })
    expect(result.kind).toBe('NO_DEPOSIT_REQUIRED')
    expect(transport.getAttemptCount()).toBe(0)
  })

  it('OPTIONAL 선택이면 REQUESTED가 되고 수납(PAID)으로 표시하지 않는다', async () => {
    const { ledger, intentId } = setup()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const result = await requestDeposit({
      ledger, transport, context: makeContext(), workspaceId: WS_A,
      intentId, currentBooking: booking, now: NOW_DATE,
    })
    expect(result.kind).toBe('REQUESTED')
    if (result.kind !== 'REQUESTED') throw new Error('expected REQUESTED')
    expect(result.intent.state).toBe('REQUESTED')
    expect(result.intent.checkoutUrl).toContain('https://checkout.example.invalid/pay/')
    expect(result.paid).toBe(false)
    expect(result.actualVerified).toBe(false)
    expect(result.datasetMode).toBe('TEST')
    expect(transport.getAttemptCount()).toBe(1)
  })

  it('같은 키로 3회 요청해도 transport 시도는 1회뿐이다', async () => {
    const { ledger, intentId } = setup()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const args = {
      ledger, transport, context: makeContext(), workspaceId: WS_A,
      intentId, currentBooking: booking, now: NOW_DATE,
    }
    const first = await requestDeposit(args)
    const second = await requestDeposit(args)
    const third = await requestDeposit(args)
    expect(first.kind).toBe('REQUESTED')
    expect(second.kind).toBe('REPLAY')
    expect(third.kind).toBe('REPLAY')
    expect(transport.getAttemptCount()).toBe(1)
  })

  it('예약 버전이 바뀌면 PG를 호출하지 않고 STALE_TERMS로 멈춘다', async () => {
    const { ledger, intentId } = setup()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const result = await requestDeposit({
      ledger, transport, context: makeContext(), workspaceId: WS_A,
      intentId, currentBooking: { ...booking, version: 3 }, now: NOW_DATE,
    })
    expect(result.kind).toBe('STALE_TERMS')
    if (result.kind !== 'STALE_TERMS') throw new Error('expected STALE_TERMS')
    expect(result.reasons).toContain('BOOKING_VERSION_CHANGED')
    expect(transport.getAttemptCount()).toBe(0)
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('PREPARED')
  })

  it('조건이 만료되면 PG를 호출하지 않는다', async () => {
    const { ledger, intentId } = setup()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const result = await requestDeposit({
      ledger, transport, context: makeContext(), workspaceId: WS_A,
      intentId, currentBooking: booking, now: new Date('2026-10-22T10:00:00Z'),
    })
    expect(result.kind).toBe('STALE_TERMS')
    if (result.kind !== 'STALE_TERMS') throw new Error('expected STALE_TERMS')
    expect(result.reasons).toContain('EXPIRED')
    expect(transport.getAttemptCount()).toBe(0)
  })

  it('TIMEOUT(UNKNOWN)이면 재호출을 봉인한다', async () => {
    const { ledger, intentId } = setup()
    const transport = new MinimalTestTransport(['TEST_UNKNOWN'])
    const first = await requestDeposit({
      ledger, transport, context: makeContext(), workspaceId: WS_A,
      intentId, currentBooking: booking, now: NOW_DATE,
    })
    expect(first.kind).toBe('REQUEST_UNKNOWN')
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('REQUEST_UNKNOWN')

    const second = await requestDeposit({
      ledger, transport, context: makeContext(), workspaceId: WS_A,
      intentId, currentBooking: booking, now: NOW_DATE,
    })
    expect(second.kind).toBe('REQUEST_UNKNOWN_REPLAY')
    expect(transport.getAttemptCount()).toBe(1)
  })

  it('거부(TEST_REJECTED)면 REQUEST_REJECTED로 남고 다시 요청할 수 있다', async () => {
    const { ledger, intentId } = setup()
    const transport = new MinimalTestTransport(['TEST_REJECTED'])
    const result = await requestDeposit({
      ledger, transport, context: makeContext(), workspaceId: WS_A,
      intentId, currentBooking: booking, now: NOW_DATE,
    })
    expect(result.kind).toBe('REQUEST_REJECTED')
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('REQUEST_REJECTED')
  })

  it('admission이 거부하면 원장을 바꾸지 않는다', async () => {
    const { ledger, intentId } = setup()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const result = await requestDeposit({
      ledger, transport,
      context: makeContext({
        controls: {
          mode: 'TEST_FAKE_ONLY', datasetMode: 'ACTUAL', allowedWorkspaceIds: [WS_A], killSwitch: false,
        },
      }),
      workspaceId: WS_A, intentId, currentBooking: booking, now: NOW_DATE,
    })
    expect(result.kind).toBe('DENIED')
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('PREPARED')
    expect(transport.getAttemptCount()).toBe(0)
  })

  it('다른 워크스페이스에서는 intent에 접근할 수 없다', async () => {
    const { ledger, intentId } = setup()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const result = await requestDeposit({
      ledger, transport, context: makeContext(), workspaceId: WS_B,
      intentId, currentBooking: { ...booking, workspaceId: WS_B }, now: NOW_DATE,
    })
    expect(result.kind).toBe('NO_DEPOSIT_REQUIRED')
    expect(transport.getAttemptCount()).toBe(0)
    expect(ledger.getIntent(WS_A, intentId)?.state).toBe('PREPARED')
  })
})

describe('describeDepositForOwner', () => {
  it('REQUESTED는 결제 완료로 말하지 않는다', () => {
    const { ledger, intentId } = setup()
    ledger.markRequested(WS_A, intentId, { checkoutUrl: 'https://checkout.example.invalid/pay/x', acceptanceRef: 'r' })
    const text = describeDepositForOwner(ledger.getIntent(WS_A, intentId)!)
    expect(text).toBe('결제 요청을 보냈어요. 입금 확인 전이에요.')
    expect(text).not.toContain('PAID')
    expect(text).not.toContain('완료')
  })

  it('PREPARED는 아직 요청 전임을 알린다', () => {
    const { ledger, intentId } = setup()
    const text = describeDepositForOwner(ledger.getIntent(WS_A, intentId)!)
    expect(text).toContain('아직')
    expect(text).not.toContain('PAID')
  })
})
