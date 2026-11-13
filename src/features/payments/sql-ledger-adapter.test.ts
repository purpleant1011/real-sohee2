import { describe, expect, it } from 'vitest'
import { LedgerPortError } from './ledger-port'
import {
  SqlNoticeLedgerAdapter,
  SqlPaymentLedgerAdapter,
} from './sql-ledger-adapter'

const WS = '11111111-1111-4111-8111-111111111111'
const WS_B = '99999999-9999-4999-8999-999999999999'
const INTENT = '22222222-2222-4222-8222-222222222222'
const JOB = '33333333-3333-4333-8333-333333333333'
const REFUND = '44444444-4444-4444-8444-444444444444'
const CAPTURE = '55555555-5555-4555-8555-555555555555'
const PAID_AT = new Date('2026-10-22T09:00:00.000Z')

type Call = { fn: string; args: Readonly<Record<string, unknown>> }

function recorder(reply: { data: unknown; error: { message: string } | null }) {
  const calls: Call[] = []
  return {
    calls,
    rpc: async (fn: string, args: Readonly<Record<string, unknown>>) => {
      calls.push({ fn, args })
      return reply
    },
  }
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WS,
    eventId: 'evt-1',
    payloadDigest: 'b'.repeat(64),
    intentId: INTENT,
    paymentRef: 'pay-1',
    amountKrw: 30000,
    currency: 'KRW' as const,
    paidAt: PAID_AT,
    outcome: 'MATCHED' as const,
    ...overrides,
  }
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerPortError)
    return (error as LedgerPortError).code
  }
  throw new Error('expected a throw')
}

describe('SqlPaymentLedgerAdapter.commitPaymentObservation', () => {
  it('마이그레이션의 p_* 인자 이름 그대로 RPC를 부른다', async () => {
    const fake = recorder({ data: { kind: 'MATCHED', event_id: 'evt-1', capture_id: CAPTURE }, error: null })
    await new SqlPaymentLedgerAdapter(fake.rpc).commitPaymentObservation(command())

    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].fn).toBe('commit_payment_observation')
    expect(fake.calls[0].args).toEqual({
      p_workspace_id: WS,
      p_event_id: 'evt-1',
      p_payload_digest: 'b'.repeat(64),
      p_intent_id: INTENT,
      p_payment_ref: 'pay-1',
      p_amount_krw: 30000,
      p_currency: 'KRW',
      p_paid_at: '2026-10-22T09:00:00.000Z',
      p_outcome: 'MATCHED',
    })
  })

  it('datasetMode/ACTUAL 같은 값은 RPC 인자에 절대 넣지 않는다', async () => {
    const fake = recorder({ data: { kind: 'MATCHED', capture_id: CAPTURE }, error: null })
    await new SqlPaymentLedgerAdapter(fake.rpc).commitPaymentObservation(command())
    const serialized = JSON.stringify(fake.calls[0].args)
    expect(serialized).not.toContain('dataset_mode')
    expect(serialized).not.toContain('ACTUAL')
  })

  it('MATCHED는 실제 수납이 아닌 TEST 기록으로 매핑된다', async () => {
    const fake = recorder({ data: { kind: 'MATCHED', event_id: 'evt-1', capture_id: CAPTURE }, error: null })
    const result = await new SqlPaymentLedgerAdapter(fake.rpc).commitPaymentObservation(command())

    expect(result).toMatchObject({
      kind: 'TEST_CAPTURE_RECORDED',
      captureRef: 'pay-1',
      captureId: CAPTURE,
      eventId: 'evt-1',
      datasetMode: 'TEST',
      actualVerified: false,
    })
    expect(result.kind).not.toContain('CAPTURED')
  })

  it('REPLAY는 outcome을 보존하고 capture_id가 있을 때만 captureRef를 붙인다', async () => {
    const withCapture = recorder({
      data: { kind: 'REPLAY', event_id: 'evt-1', capture_id: CAPTURE },
      error: null,
    })
    const replay = await new SqlPaymentLedgerAdapter(withCapture.rpc).commitPaymentObservation(command())
    expect(replay).toMatchObject({ kind: 'REPLAY', captureRef: 'pay-1', captureId: CAPTURE, eventId: 'evt-1' })

    const withoutCapture = recorder({ data: { kind: 'REPLAY', event_id: 'evt-1', outcome: 'MISMATCH' }, error: null })
    const bare = await new SqlPaymentLedgerAdapter(withoutCapture.rpc).commitPaymentObservation(command())
    expect(bare).toMatchObject({ kind: 'REPLAY', outcome: 'MISMATCH' })
    expect('captureRef' in bare).toBe(false)
  })

  it.each([
    ['EVENT_CONFLICT', 'EVENT_CONFLICT'],
    ['PAYMENT_REF_CONFLICT', 'PAYMENT_REF_CONFLICT'],
    ['MISMATCH', 'MISMATCH'],
    ['AMOUNT_MISMATCH', 'AMOUNT_MISMATCH'],
  ])('%s는 NEEDS_REVIEW로만 내려간다', async (kind, reason) => {
    const fake = recorder({ data: { kind, event_id: 'evt-1' }, error: null })
    const result = await new SqlPaymentLedgerAdapter(fake.rpc).commitPaymentObservation(command())
    expect(result).toMatchObject({ kind: 'NEEDS_REVIEW', reason, datasetMode: 'TEST', actualVerified: false })
  })

  it('LATE_PAYMENT는 capture 증거를 보존한 NEEDS_REVIEW다', async () => {
    const fake = recorder({
      data: { kind: 'LATE_PAYMENT', event_id: 'evt-1', capture_id: CAPTURE },
      error: null,
    })
    const result = await new SqlPaymentLedgerAdapter(fake.rpc).commitPaymentObservation(command())
    expect(result).toMatchObject({
      kind: 'NEEDS_REVIEW',
      reason: 'LATE_PAYMENT',
      captureRef: 'pay-1',
      captureId: CAPTURE,
    })
  })

  it('NEEDS_REVIEW kind는 payload reason을 쓴다', async () => {
    const fake = recorder({ data: { kind: 'NEEDS_REVIEW', reason: 'BOOKING_CHANGED' }, error: null })
    const result = await new SqlPaymentLedgerAdapter(fake.rpc).commitPaymentObservation(command())
    expect(result).toMatchObject({ kind: 'NEEDS_REVIEW', reason: 'BOOKING_CHANGED' })
  })

  it('NOT_FOUND는 INTENT_NOT_FOUND다', async () => {
    const fake = recorder({ data: { kind: 'NOT_FOUND' }, error: null })
    const result = await new SqlPaymentLedgerAdapter(fake.rpc).commitPaymentObservation(command())
    expect(result).toEqual({ kind: 'INTENT_NOT_FOUND', datasetMode: 'TEST', actualVerified: false })
  })

  it('모르는 kind는 성공으로 승격하지 않고 계약 위반으로 던진다', async () => {
    const fake = recorder({ data: { kind: 'SETTLED' }, error: null })
    expect(await codeOf(() => new SqlPaymentLedgerAdapter(fake.rpc).commitPaymentObservation(command()))).toBe(
      'LEDGER_CONTRACT_VIOLATION'
    )
  })

  it.each([[null], [undefined], ['MATCHED'], [[{ kind: 'MATCHED' }]], [42]])(
    'data가 객체가 아니면(%s) 빈 결과로 위장하지 않고 던진다',
    async (data) => {
      const fake = recorder({ data, error: null })
      expect(await codeOf(() => new SqlPaymentLedgerAdapter(fake.rpc).commitPaymentObservation(command()))).toBe(
        'LEDGER_CONTRACT_VIOLATION'
      )
    }
  )

  it('kind가 문자열이 아니어도 계약 위반이다', async () => {
    const fake = recorder({ data: { kind: 7 }, error: null })
    expect(await codeOf(() => new SqlPaymentLedgerAdapter(fake.rpc).commitPaymentObservation(command()))).toBe(
      'LEDGER_CONTRACT_VIOLATION'
    )
  })

  it('RPC error는 원문 메시지를 보존한 LEDGER_UNAVAILABLE이다', async () => {
    const fake = recorder({ data: null, error: { message: 'permission denied for function' } })
    await expect(
      new SqlPaymentLedgerAdapter(fake.rpc).commitPaymentObservation(command())
    ).rejects.toMatchObject({ code: 'LEDGER_UNAVAILABLE', message: 'LEDGER_UNAVAILABLE:permission denied for function' })
  })

  it('입력이 어긋나면 RPC를 부르지 않고 INVALID_LEDGER_INPUT을 던진다', async () => {
    const fake = recorder({ data: { kind: 'MATCHED' }, error: null })
    const adapter = new SqlPaymentLedgerAdapter(fake.rpc)
    const bad = [
      command({ workspaceId: 'ws-a' }),
      command({ intentId: 'intent-1' }),
      command({ amountKrw: 0 }),
      command({ amountKrw: 1.5 }),
      command({ paidAt: '2026-10-22T09:00:00Z' }),
      command({ eventId: '   ' }),
      command({ payloadDigest: '' }),
      command({ paymentRef: '' }),
      command({ currency: 'USD' }),
      command({ outcome: 'CAPTURED' }),
    ]
    for (const input of bad) {
      expect(await codeOf(() => adapter.commitPaymentObservation(input as never))).toBe('INVALID_LEDGER_INPUT')
    }
    expect(fake.calls).toHaveLength(0)
  })

  it('반환값은 깊게 동결된다', async () => {
    const fake = recorder({ data: { kind: 'MATCHED', capture_id: CAPTURE }, error: null })
    const result = await new SqlPaymentLedgerAdapter(fake.rpc).commitPaymentObservation(command())
    expect(Object.isFrozen(result)).toBe(true)
  })
})

describe('SqlPaymentLedgerAdapter.reserveRefund', () => {
  const refund = {
    workspaceId: WS,
    paymentRef: 'pay-1',
    operationKey: 'rf-1',
    amountKrw: 10000,
    reason: '고객 취소',
    ruleVersion: 'rr_v1',
  }

  it('p_* 인자 이름 그대로 RPC를 부른다', async () => {
    const fake = recorder({ data: { kind: 'RESERVED', refund_id: REFUND, available_krw: 20000 }, error: null })
    await new SqlPaymentLedgerAdapter(fake.rpc).reserveRefund(refund)
    expect(fake.calls[0]).toEqual({
      fn: 'reserve_deposit_refund',
      args: {
        p_workspace_id: WS,
        p_payment_ref: 'pay-1',
        p_operation_key: 'rf-1',
        p_amount_krw: 10000,
        p_reason: '고객 취소',
        p_rule_version: 'rr_v1',
      },
    })
  })

  it('RESERVED는 가용액과 함께 내려온다', async () => {
    const fake = recorder({ data: { kind: 'RESERVED', refund_id: REFUND, available_krw: 20000 }, error: null })
    const result = await new SqlPaymentLedgerAdapter(fake.rpc).reserveRefund(refund)
    expect(result).toEqual({
      kind: 'RESERVED',
      refundRef: REFUND,
      availableKrw: 20000,
      datasetMode: 'TEST',
      actualVerified: false,
    })
  })

  it('REPLAY는 기존 환불 참조와 상태를 보존한다', async () => {
    const fake = recorder({ data: { kind: 'REPLAY', refund_id: REFUND, status: 'RESERVED' }, error: null })
    const result = await new SqlPaymentLedgerAdapter(fake.rpc).reserveRefund(refund)
    expect(result).toMatchObject({ kind: 'REPLAY', refundRef: REFUND, status: 'RESERVED' })
  })

  it('CONFLICT는 reason을 보존한다(없으면 생략)', async () => {
    const withReason = recorder({
      data: { kind: 'CONFLICT', reason: 'OPERATION_KEY_BOUND_TO_OTHER_CAPTURE' },
      error: null,
    })
    expect(await new SqlPaymentLedgerAdapter(withReason.rpc).reserveRefund(refund)).toMatchObject({
      kind: 'CONFLICT',
      reason: 'OPERATION_KEY_BOUND_TO_OTHER_CAPTURE',
    })

    const bare = recorder({ data: { kind: 'CONFLICT', refund_id: REFUND }, error: null })
    const result = await new SqlPaymentLedgerAdapter(bare.rpc).reserveRefund(refund)
    expect(result.kind).toBe('CONFLICT')
    expect('reason' in result).toBe(false)
  })

  it.each([['BLOCKED_DISPUTE'], ['HOLD_UNKNOWN_REFUND'], ['CAPTURE_NOT_FOUND']])(
    '%s는 그대로 내려온다',
    async (kind) => {
      const fake = recorder({ data: { kind }, error: null })
      const result = await new SqlPaymentLedgerAdapter(fake.rpc).reserveRefund(refund)
      expect(result).toMatchObject({ kind, datasetMode: 'TEST', actualVerified: false })
    }
  )

  it('EXCEEDS_AVAILABLE는 남은 가용액을 정수로 요구한다', async () => {
    const fake = recorder({ data: { kind: 'EXCEEDS_AVAILABLE', available_krw: 5000 }, error: null })
    expect(await new SqlPaymentLedgerAdapter(fake.rpc).reserveRefund(refund)).toMatchObject({
      kind: 'EXCEEDS_AVAILABLE',
      availableKrw: 5000,
    })

    const broken = recorder({ data: { kind: 'EXCEEDS_AVAILABLE', available_krw: '5000' }, error: null })
    expect(await codeOf(() => new SqlPaymentLedgerAdapter(broken.rpc).reserveRefund(refund))).toBe(
      'LEDGER_CONTRACT_VIOLATION'
    )
  })

  it('RESERVED에 refund_id가 없으면 계약 위반이다', async () => {
    const fake = recorder({ data: { kind: 'RESERVED', available_krw: 1 }, error: null })
    expect(await codeOf(() => new SqlPaymentLedgerAdapter(fake.rpc).reserveRefund(refund))).toBe(
      'LEDGER_CONTRACT_VIOLATION'
    )
  })

  it('모르는 kind는 계약 위반이다', async () => {
    const fake = recorder({ data: { kind: 'REFUNDED', refund_id: REFUND }, error: null })
    expect(await codeOf(() => new SqlPaymentLedgerAdapter(fake.rpc).reserveRefund(refund))).toBe(
      'LEDGER_CONTRACT_VIOLATION'
    )
  })

  it('입력 검증 실패 시 RPC를 부르지 않는다', async () => {
    const fake = recorder({ data: { kind: 'RESERVED', refund_id: REFUND, available_krw: 1 }, error: null })
    const adapter = new SqlPaymentLedgerAdapter(fake.rpc)
    for (const input of [
      { ...refund, workspaceId: 'nope' },
      { ...refund, amountKrw: -1 },
      { ...refund, paymentRef: '' },
      { ...refund, operationKey: ' ' },
    ]) {
      expect(await codeOf(() => adapter.reserveRefund(input as never))).toBe('INVALID_LEDGER_INPUT')
    }
    expect(fake.calls).toHaveLength(0)
  })
})

describe('SqlNoticeLedgerAdapter', () => {
  const now = new Date('2026-10-22T09:00:00.000Z')

  it('claim_notice_job 인자를 그대로 넘기고 CLAIMED generation을 돌려준다', async () => {
    const fake = recorder({ data: { kind: 'CLAIMED', claim_generation: 1, job: { id: JOB } }, error: null })
    const result = await new SqlNoticeLedgerAdapter(fake.rpc).claimNoticeJob({
      workspaceId: WS,
      jobId: JOB,
      now,
    })
    expect(fake.calls[0]).toEqual({
      fn: 'claim_notice_job',
      args: { p_workspace_id: WS, p_job_id: JOB, p_now: '2026-10-22T09:00:00.000Z' },
    })
    expect(result).toMatchObject({ kind: 'CLAIMED', claimGeneration: 1, datasetMode: 'TEST', actualVerified: false })
  })

  it('NOT_CLAIMABLE은 상태와 예정 시각을 정규화해 보존한다', async () => {
    const fake = recorder({
      data: { kind: 'NOT_CLAIMABLE', status: 'CLAIMED', scheduled_at: '2026-10-22T09:00:00+00:00', claim_generation: 1 },
      error: null,
    })
    const result = await new SqlNoticeLedgerAdapter(fake.rpc).claimNoticeJob({
      workspaceId: WS,
      jobId: JOB,
      now,
    })
    expect(result).toMatchObject({
      kind: 'NOT_CLAIMABLE',
      status: 'CLAIMED',
      scheduledAt: '2026-10-22T09:00:00.000Z',
    })
  })

  it('NOT_FOUND는 NOT_FOUND다', async () => {
    const fake = recorder({ data: { kind: 'NOT_FOUND' }, error: null })
    const result = await new SqlNoticeLedgerAdapter(fake.rpc).claimNoticeJob({ workspaceId: WS, jobId: JOB, now })
    expect(result).toEqual({ kind: 'NOT_FOUND', datasetMode: 'TEST', actualVerified: false })
  })

  it('claim의 모르는 kind와 비정형 payload는 계약 위반이다', async () => {
    for (const data of [{ kind: 'SENT' }, { kind: 'CLAIMED' }, null, { kind: 'NOT_CLAIMABLE', status: 'PLANNED' }]) {
      const fake = recorder({ data, error: null })
      expect(
        await codeOf(() => new SqlNoticeLedgerAdapter(fake.rpc).claimNoticeJob({ workspaceId: WS, jobId: JOB, now }))
      ).toBe('LEDGER_CONTRACT_VIOLATION')
    }
  })

  it('invalidate_notice_jobs는 두 정수 집계를 요구한다', async () => {
    const fake = recorder({ data: { kind: 'OK', invalidated: 3, in_flight_or_sent: 2 }, error: null })
    const result = await new SqlNoticeLedgerAdapter(fake.rpc).invalidateNoticeJobs({
      workspaceId: WS,
      bookingId: 'bk_a1',
      currentVersion: 16,
      currentStatus: 'CONFIRMED',
    })
    expect(fake.calls[0]).toEqual({
      fn: 'invalidate_notice_jobs',
      args: {
        p_workspace_id: WS,
        p_booking_id: 'bk_a1',
        p_current_version: 16,
        p_current_status: 'CONFIRMED',
      },
    })
    expect(result).toEqual({
      kind: 'OK',
      invalidated: 3,
      inFlightOrSent: 2,
      datasetMode: 'TEST',
      actualVerified: false,
    })
  })

  it('집계가 정수가 아니거나 kind가 OK가 아니면 계약 위반이다', async () => {
    for (const data of [
      { kind: 'OK', invalidated: '3', in_flight_or_sent: 2 },
      { kind: 'OK', invalidated: 3.5, in_flight_or_sent: 2 },
      { kind: 'OK', invalidated: 3 },
      { kind: 'PARTIAL', invalidated: 3, in_flight_or_sent: 2 },
    ]) {
      const fake = recorder({ data, error: null })
      expect(
        await codeOf(() =>
          new SqlNoticeLedgerAdapter(fake.rpc).invalidateNoticeJobs({
            workspaceId: WS,
            bookingId: 'bk_a1',
            currentVersion: 16,
            currentStatus: 'CONFIRMED',
          })
        )
      ).toBe('LEDGER_CONTRACT_VIOLATION')
    }
  })

  it('workspace/버전이 어긋나면 RPC를 부르지 않는다', async () => {
    const fake = recorder({ data: { kind: 'OK', invalidated: 0, in_flight_or_sent: 0 }, error: null })
    const adapter = new SqlNoticeLedgerAdapter(fake.rpc)
    expect(
      await codeOf(() =>
        adapter.invalidateNoticeJobs({
          workspaceId: WS_B.replace('9', 'z'),
          bookingId: 'bk_a1',
          currentVersion: 16,
          currentStatus: 'CONFIRMED',
        })
      )
    ).toBe('INVALID_LEDGER_INPUT')
    expect(
      await codeOf(() =>
        adapter.invalidateNoticeJobs({ workspaceId: WS, bookingId: 'bk_a1', currentVersion: 0, currentStatus: 'CONFIRMED' })
      )
    ).toBe('INVALID_LEDGER_INPUT')
    expect(await codeOf(() => adapter.claimNoticeJob({ workspaceId: WS, jobId: JOB, now: new Date(Number.NaN) }))).toBe(
      'INVALID_LEDGER_INPUT'
    )
    expect(fake.calls).toHaveLength(0)
  })
})
