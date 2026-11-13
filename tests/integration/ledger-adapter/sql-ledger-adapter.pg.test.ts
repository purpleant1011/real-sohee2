/**
 * SQL 원장 어댑터 ↔ 격리 PostgreSQL 16 통합 시험 (ANI-1615/1616/1617/1620).
 *
 * `SOHEE_LEDGER_PG`가 없으면 통째로 skip한다(일반 `vitest run` 안전).
 * 실행: `node scripts/test-vault-db.mjs --ledger-adapter`
 *
 * fixture 행은 psql로 직접 넣고, 그 뒤의 모든 원장 쓰기는 어댑터(→ RPC)만 사용한다.
 * 동시성은 psql 프로세스 2개(= 실제 연결 2개)를 Promise.all로 동시에 띄워 확인한다.
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  SqlNoticeLedgerAdapter,
  SqlPaymentLedgerAdapter,
} from '../../../src/features/payments/sql-ledger-adapter'
import { createPsqlRpc } from '../../../src/features/payments/testing/psql-rpc'

const enabled = process.env.SOHEE_LEDGER_PG === '1' && Boolean(process.env.PGDATABASE)

const bin = process.env.PG16_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const psqlBin = `${bin}/psql`
const host = process.env.PGHOST ?? ''
const port = process.env.PGPORT ?? ''
const database = process.env.PGDATABASE ?? ''
const user = process.env.PGUSER

/** fixture 삽입·집계용 psql. ON_ERROR_STOP으로 실패를 숨기지 않는다. */
function psql(statement: string): string {
  const result = spawnSync(psqlBin, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    encoding: 'utf8',
    env: { ...process.env, PGHOST: host, PGPORT: String(port), PGDATABASE: database },
  })
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr?.slice(-1500)}`)
  return result.stdout.trim()
}

function count(statement: string): number {
  return Number(psql(statement))
}

type Fixture = Readonly<{
  workspaceId: string
  otherWorkspaceId: string
  intentId: string
  refundIntentId: string
  paymentRef: string
  noticeJobId: string
  acceptedJobId: string
}>

let fixture!: Fixture

/** 58 테스트와 같은 방식으로 auth.users → workspaces 순서로 넣는다. */
function seed(): Fixture {
  const workspaceId = randomUUID()
  const otherWorkspaceId = randomUUID()
  const ownerId = randomUUID()
  const otherOwnerId = randomUUID()
  const intentId = randomUUID()
  const refundIntentId = randomUUID()
  const paymentRef = `pay-${randomUUID().slice(0, 8)}`
  const noticeJobId = randomUUID()
  const acceptedJobId = randomUUID()

  psql(`insert into auth.users (id, email) values
    ('${ownerId}', '${ownerId.slice(0, 8)}@ledger.test.invalid'),
    ('${otherOwnerId}', '${otherOwnerId.slice(0, 8)}@ledger.test.invalid')`)

  psql(`insert into public.workspaces (id, name, created_by) values
    ('${workspaceId}', 'Ledger A', '${ownerId}'),
    ('${otherWorkspaceId}', 'Ledger B', '${otherOwnerId}')`)

  psql(`insert into public.deposit_intents (
      id, workspace_id, booking_id, booking_version, service_version, customer_id, policy,
      amount_krw, total_service_price_krw, refund_rule_version, cancellation_terms,
      merchant_ref, settlement_actor, terms_fingerprint, idempotency_key, status, expires_at)
    values
      ('${intentId}', '${workspaceId}', 'bk_ledger_1', 1, 'svc_v1', 'cust_1', 'REQUIRED',
       30000, 120000, 'rr_v1', '취소 규정 v1', 'merchant_test', 'SHOP',
       repeat('a', 64), 'idem-${intentId.slice(0, 8)}', 'PREPARED', now() + interval '1 hour'),
      ('${refundIntentId}', '${workspaceId}', 'bk_ledger_2', 1, 'svc_v1', 'cust_2', 'REQUIRED',
       30000, 120000, 'rr_v1', '취소 규정 v1', 'merchant_test', 'SHOP',
       repeat('a', 64), 'idem-${refundIntentId.slice(0, 8)}', 'PREPARED', now() + interval '1 hour')`)

  psql(`insert into public.notice_jobs (
      id, workspace_id, booking_id, booking_version, kind, template_version,
      recipient_ref_hash, scheduled_at, payload_fingerprint, status)
    values
      ('${noticeJobId}', '${workspaceId}', 'bk_notice_1', 1, 'REMINDER', 'tpl_v1',
       repeat('3', 64), now() - interval '1 minute', repeat('f', 64), 'PLANNED'),
      ('${acceptedJobId}', '${workspaceId}', 'bk_notice_1', 1, 'CONFIRMATION', 'tpl_v1',
       repeat('4', 64), now() - interval '1 minute', repeat('f', 64), 'REQUEST_ACCEPTED')`)

  return { workspaceId, otherWorkspaceId, intentId, refundIntentId, paymentRef, noticeJobId, acceptedJobId }
}

const suite = enabled ? describe : describe.skip

suite('SqlPaymentLedgerAdapter ↔ PostgreSQL 16', () => {
  const rpc = enabled
    ? createPsqlRpc({ psqlBin, host, port, database, user })
    : null
  const payments = enabled ? new SqlPaymentLedgerAdapter(rpc!) : null
  const notices = enabled ? new SqlNoticeLedgerAdapter(rpc!) : null

  if (enabled) fixture = seed()

  const event = (overrides: Record<string, unknown> = {}) => ({
    workspaceId: fixture.workspaceId,
    eventId: `evt-${randomUUID().slice(0, 8)}`,
    payloadDigest: 'b'.repeat(64),
    intentId: fixture.intentId,
    paymentRef: fixture.paymentRef,
    amountKrw: 30000,
    currency: 'KRW' as const,
    paidAt: new Date(),
    outcome: 'MATCHED' as const,
    ...overrides,
  })

  it('같은 결제 이벤트 3회는 capture 1건 + REPLAY 2건이다', async () => {
    const input = event({ eventId: `evt-dedupe-${fixture.intentId.slice(0, 8)}` })

    const first = await payments!.commitPaymentObservation(input)
    const second = await payments!.commitPaymentObservation(input)
    const third = await payments!.commitPaymentObservation(input)

    expect(first.kind).toBe('TEST_CAPTURE_RECORDED')
    expect(first).toMatchObject({ datasetMode: 'TEST', actualVerified: false })
    expect(second.kind).toBe('REPLAY')
    expect(third.kind).toBe('REPLAY')
    // RPC의 event 재생 경로는 event_id/outcome만 돌려준다(capture_id 없음).
    // 어댑터는 없는 captureRef를 만들어내지 않는다.
    expect(second).toMatchObject({ kind: 'REPLAY', outcome: 'MATCHED' })
    expect('captureRef' in second).toBe(false)

    expect(
      count(`select count(*) from public.payment_captures
             where workspace_id = '${fixture.workspaceId}' and payment_ref = '${fixture.paymentRef}'`)
    ).toBe(1)
    expect(
      count(`select count(*) from public.payment_webhook_events
             where workspace_id = '${fixture.workspaceId}' and event_id = '${input.eventId}'`)
    ).toBe(1)
    expect(
      psql(`select status from public.deposit_intents where id = '${fixture.intentId}'`)
    ).toBe('TEST_PAID_MATCHED')
  })

  it('같은 operationKey 동시 예약 2회는 정확히 1회 RESERVED + 1회 REPLAY다', async () => {
    const command = {
      workspaceId: fixture.workspaceId,
      paymentRef: fixture.paymentRef,
      operationKey: `rf-concurrent-${randomUUID().slice(0, 8)}`,
      amountKrw: 10000,
      reason: '고객 취소',
      ruleVersion: 'rr_v1',
    }

    const [left, right] = await Promise.all([
      payments!.reserveRefund(command),
      payments!.reserveRefund(command),
    ])
    const kinds = [left.kind, right.kind].sort()

    expect(kinds).toEqual(['REPLAY', 'RESERVED'])
    expect(
      count(`select count(*) from public.deposit_refunds
             where workspace_id = '${fixture.workspaceId}' and operation_key = '${command.operationKey}'`)
    ).toBe(1)
  })

  it('capture 가용액을 넘는 예약은 거부된다', async () => {
    const over = await payments!.reserveRefund({
      workspaceId: fixture.workspaceId,
      paymentRef: fixture.paymentRef,
      operationKey: `rf-over-${randomUUID().slice(0, 8)}`,
      amountKrw: 25000,
      reason: '초과 환불 시도',
      ruleVersion: 'rr_v1',
    })
    expect(over.kind).toBe('EXCEEDS_AVAILABLE')
    expect(over).toMatchObject({ availableKrw: 20000 })
    expect(
      count(`select count(*) from public.deposit_refunds
             where workspace_id = '${fixture.workspaceId}' and amount_krw = 25000`)
    ).toBe(0)
  })

  it('없는 capture에 대한 예약은 CAPTURE_NOT_FOUND다', async () => {
    const missing = await payments!.reserveRefund({
      workspaceId: fixture.workspaceId,
      paymentRef: `pay-missing-${randomUUID().slice(0, 8)}`,
      operationKey: `rf-missing-${randomUUID().slice(0, 8)}`,
      amountKrw: 1000,
      reason: '없는 결제',
      ruleVersion: 'rr_v1',
    })
    expect(missing.kind).toBe('CAPTURE_NOT_FOUND')
  })

  it('같은 jobId 동시 claim 2회는 정확히 1회 CLAIMED다', async () => {
    const now = new Date()
    const [left, right] = await Promise.all([
      notices!.claimNoticeJob({ workspaceId: fixture.workspaceId, jobId: fixture.noticeJobId, now }),
      notices!.claimNoticeJob({ workspaceId: fixture.workspaceId, jobId: fixture.noticeJobId, now }),
    ])
    const kinds = [left.kind, right.kind].sort()

    expect(kinds).toEqual(['CLAIMED', 'NOT_CLAIMABLE'])
    expect(psql(`select status || ':' || claim_generation from public.notice_jobs
                 where id = '${fixture.noticeJobId}'`)).toBe('CLAIMED:1')
  })

  it('invalidate는 REQUEST_ACCEPTED 행을 건드리지 않는다', async () => {
    const result = await notices!.invalidateNoticeJobs({
      workspaceId: fixture.workspaceId,
      bookingId: 'bk_notice_1',
      currentVersion: 2,
      currentStatus: 'CONFIRMED',
    })

    expect(result).toMatchObject({ kind: 'OK', invalidated: 1, inFlightOrSent: 1, datasetMode: 'TEST' })
    expect(psql(`select status from public.notice_jobs where id = '${fixture.acceptedJobId}'`)).toBe(
      'REQUEST_ACCEPTED'
    )
    expect(psql(`select status from public.notice_jobs where id = '${fixture.noticeJobId}'`)).toBe('INVALIDATED')
  })

  it('다른 workspace로 호출하면 NOT_FOUND이며 아무 것도 바뀌지 않는다', async () => {
    const before = count(`select count(*) from public.payment_captures where workspace_id = '${fixture.otherWorkspaceId}'`)

    const observed = await payments!.commitPaymentObservation(
      event({ workspaceId: fixture.otherWorkspaceId, eventId: `evt-cross-${randomUUID().slice(0, 8)}` })
    )
    expect(observed.kind).toBe('INTENT_NOT_FOUND')

    const refunded = await payments!.reserveRefund({
      workspaceId: fixture.otherWorkspaceId,
      paymentRef: fixture.paymentRef,
      operationKey: `rf-cross-${randomUUID().slice(0, 8)}`,
      amountKrw: 1000,
      reason: '타 테넌트',
      ruleVersion: 'rr_v1',
    })
    expect(refunded.kind).toBe('CAPTURE_NOT_FOUND')

    const claimed = await notices!.claimNoticeJob({
      workspaceId: fixture.otherWorkspaceId,
      jobId: fixture.noticeJobId,
      now: new Date(),
    })
    expect(claimed.kind).toBe('NOT_FOUND')

    const invalidated = await notices!.invalidateNoticeJobs({
      workspaceId: fixture.otherWorkspaceId,
      bookingId: 'bk_notice_1',
      currentVersion: 99,
      currentStatus: 'CONFIRMED',
    })
    expect(invalidated).toMatchObject({ kind: 'OK', invalidated: 0, inFlightOrSent: 0 })

    expect(count(`select count(*) from public.payment_captures where workspace_id = '${fixture.otherWorkspaceId}'`)).toBe(before)
  })

  it('ACTUAL dataset_mode은 DB 제약으로 들어갈 수 없다', () => {
    const rejected = spawnSync(
      psqlBin,
      ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', `insert into public.notice_jobs (
         workspace_id, booking_id, booking_version, kind, template_version,
         recipient_ref_hash, scheduled_at, payload_fingerprint, dataset_mode)
       values ('${fixture.workspaceId}', 'bk_actual', 1, 'REMINDER', 'tpl_v1',
         repeat('a', 64), now(), repeat('f', 64), 'ACTUAL')`],
      { encoding: 'utf8', env: { ...process.env, PGHOST: host, PGPORT: String(port), PGDATABASE: database } }
    )
    expect(rejected.status).not.toBe(0)
    expect(rejected.stderr).toMatch(/check constraint/i)
    expect(count(`select count(*) from public.notice_jobs where booking_id = 'bk_actual'`)).toBe(0)
  })

  it('어댑터가 쓴 행은 전부 TEST dataset_mode다', () => {
    expect(
      count(`select count(*) from public.payment_captures where dataset_mode <> 'TEST'`)
    ).toBe(0)
    expect(
      count(`select count(*) from public.payment_webhook_events where dataset_mode <> 'TEST'`)
    ).toBe(0)
    expect(
      count(`select count(*) from public.deposit_refunds where dataset_mode <> 'TEST'`)
    ).toBe(0)
  })
})

suite('SqlNoticeLedgerAdapter ↔ PostgreSQL 16 (격리)', () => {
  const rpc = enabled ? createPsqlRpc({ psqlBin, host, port, database, user }) : null
  const payments = enabled ? new SqlPaymentLedgerAdapter(rpc!) : null

  it('다른 workspace의 intent는 이 workspace capture로 결속되지 않는다', async () => {
    const otherIntent = randomUUID()
    psql(`insert into public.deposit_intents (
        id, workspace_id, booking_id, booking_version, service_version, customer_id, policy,
        amount_krw, total_service_price_krw, refund_rule_version, cancellation_terms,
        merchant_ref, settlement_actor, terms_fingerprint, idempotency_key, status, expires_at)
      values ('${otherIntent}', '${fixture.otherWorkspaceId}', 'bk_other_1', 1, 'svc_v1', 'cust_9', 'REQUIRED',
        30000, 120000, 'rr_v1', '취소 규정 v1', 'merchant_test', 'SHOP',
        repeat('a', 64), 'idem-${otherIntent.slice(0, 8)}', 'PREPARED', now() + interval '1 hour')`)

    const result = await payments!.commitPaymentObservation({
      workspaceId: fixture.workspaceId,
      eventId: `evt-bind-${randomUUID().slice(0, 8)}`,
      payloadDigest: 'c'.repeat(64),
      intentId: otherIntent,
      paymentRef: `pay-bind-${randomUUID().slice(0, 8)}`,
      amountKrw: 30000,
      currency: 'KRW',
      paidAt: new Date(),
      outcome: 'MATCHED',
    })

    expect(result.kind).toBe('INTENT_NOT_FOUND')
    expect(psql(`select status from public.deposit_intents where id = '${otherIntent}'`)).toBe('PREPARED')
  })
})
