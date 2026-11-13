/**
 * 예약 변경·취소 → 안내 job 무효화·재계획 호출 경로 통합 테스트 · ANI-1620
 *
 * 15:00 → 16:00 BDD. 예약 서비스(fake supabase) → sync port → TEST 원장 → runDue까지
 * 실제 호출 경로로 이어진다. 발송 직전 재검증이 구 job을 막는 것을 여기서 증명한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const syncResults = vi.hoisted(() => [] as Array<{ kind: string; error: string | null }>)

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/features/booking-recovery/production', () => ({ isRecoveryEnabled: () => false }))
vi.mock('@/features/notifications/reservation-notice-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reservation-notice-sync')>()
  return {
    ...actual,
    syncBookingNoticeState: async (input: Parameters<typeof actual.syncBookingNoticeState>[0]) => {
      const result = await actual.syncBookingNoticeState(input)
      syncResults.push({ kind: result.kind, error: result.error })
      return result
    },
  }
})

import { ReservationCanonicalService } from '@/features/reservations/reservation-canonical-service'
import { TestNoticeJobLedger } from '../notice-job-ledger'
import { planNotice, runDueNotices, type BookingNoticeFact } from '../notice-schedule'
import {
  reservationNoticeVersion,
  setBookingNoticeSyncPort,
} from '../reservation-notice-sync'
import { createNoticeLedgerSyncPort } from '../testing/notice-ledger-sync-port'
import { MinimalTestTransport } from '@/features/policy-gate/testing/minimal-transport'
import type { Context, Controls } from '@/features/policy-gate/testing/minimal-admission'

const WS = '11111111-2222-3333-4444-555555555555'
const BOOKING = 'bk_wiring_15_to_16'
const CUSTOMER = 'customer-wiring'

const SLOT_15 = '2026-10-23T15:00:00+09:00'
const SLOT_16 = '2026-10-23T16:00:00+09:00'
const UPDATED_AT_V1 = '2026-10-22T01:00:00.000Z'
const UPDATED_AT_V2 = '2026-10-22T02:00:00.000Z'
const V1 = reservationNoticeVersion(UPDATED_AT_V1)
const V2 = reservationNoticeVersion(UPDATED_AT_V2)

/** 구 job scheduledAt (15:00 방문의 24시간 전) */
const OLD_DUE = new Date('2026-10-22T06:00:00Z')
/** 새 job scheduledAt (16:00 방문의 24시간 전) */
const NEW_DUE = new Date('2026-10-22T07:00:00Z')
const PLANNING_NOW = new Date('2026-10-21T15:00:00Z')

const BODY_15 = '10월 23일 15:00 예약 안내입니다.'
const BODY_16 = '10월 23일 16:00 예약 안내입니다.'

function confirmedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING,
    workspace_id: WS,
    slot_id: SLOT_15,
    customer_id: CUSTOMER,
    customer_name: '테스트 고객',
    customer_phone: null,
    service_id: 'service-wiring',
    service_name: '상담 서비스',
    status: 'CONFIRMED',
    deposit_krw: 0,
    total_amount_krw: 40000,
    channel_source: 'MANUAL',
    proof_id: 'proof-wiring',
    evidence_id: null,
    confirmed_at: '2026-10-20T00:00:00Z',
    cancelled_at: null,
    cancel_reason: null,
    created_at: '2026-10-20T00:00:00Z',
    updated_at: UPDATED_AT_V1,
    ...overrides,
  }
}

function testControls(overrides: Partial<Controls> = {}): Controls {
  return {
    mode: 'TEST_FAKE_ONLY',
    datasetMode: 'TEST',
    allowedWorkspaceIds: [WS],
    killSwitch: false,
    ...overrides,
  }
}

function testContext(now: Date): Context {
  return {
    controls: testControls(),
    now,
    evaluator: () => ({ ready: true }),
  }
}

function fact(overrides: Partial<BookingNoticeFact> = {}): BookingNoticeFact {
  return {
    workspaceId: WS,
    bookingId: BOOKING,
    bookingVersion: V1,
    status: 'CONFIRMED',
    customerId: CUSTOMER,
    startsAt: SLOT_15,
    serviceName: '상담 서비스',
    locationText: '확인된 위치',
    datasetMode: 'TEST',
    ...overrides,
  }
}

function readerReturning(value: BookingNoticeFact) {
  return async () => ({ ok: true as const, fact: value })
}

function consentGranted() {
  return async () => ({ ok: true as const, granted: true })
}

function planReminder15(ledger: TestNoticeJobLedger) {
  const result = planNotice({
    ledger,
    fact: fact(),
    kind: 'REMINDER',
    leadMinutes: 1440,
    templateVersion: 'tpl-v1',
    recipientRef: 'recipient-ref-wiring',
    renderedBody: BODY_15,
    consentGranted: true,
    now: PLANNING_NOW,
  })
  if (result.kind !== 'PLANNED') throw new Error(`fixture failed: ${result.kind}`)
  return result.job
}

/** 예약 변경: 최초 조회 → 슬롯 조회(AVAILABLE) → update → readback(16:00). */
function rescheduleClient() {
  const reservationsMaybeSingle = vi
    .fn()
    .mockResolvedValueOnce({ data: confirmedRow(), error: null })
    .mockResolvedValueOnce({
      data: confirmedRow({ slot_id: SLOT_16, updated_at: UPDATED_AT_V2 }),
      error: null,
    })

  const reservations = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: reservationsMaybeSingle,
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
  }

  const slots = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: { id: SLOT_16, workspace_id: WS, status: 'AVAILABLE' }, error: null }),
  }

  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'reservations') return reservations
      if (table === 'booking_recovery_slots') return slots
      return {}
    }),
  }

  return { client, reservations }
}

/** 예약 취소: 최초 조회(CONFIRMED) → update → readback(CANCELLED). */
function cancelClient() {
  const reservationsMaybeSingle = vi
    .fn()
    .mockResolvedValueOnce({ data: confirmedRow(), error: null })
    .mockResolvedValueOnce({
      data: {
        status: 'CANCELLED',
        cancelled_at: UPDATED_AT_V2,
        cancel_reason: '고객 요청 취소',
        updated_at: UPDATED_AT_V2,
      },
      error: null,
    })

  const reservations = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: reservationsMaybeSingle,
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }

  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'reservations') return reservations
      return {}
    }),
  }

  return { client, reservations }
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test')
  syncResults.length = 0
  ReservationCanonicalService.resetState()
})

afterEach(() => {
  setBookingNoticeSyncPort(null)
  vi.unstubAllEnvs()
})

describe('15:00 → 16:00 예약 변경 호출 경로 (BDD)', () => {
  it('구 리마인더는 무효화되고 새 16:00 일정으로만 재계획되며 구 시각 발송은 0이다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const oldJob = planReminder15(ledger)
    expect(Date.parse(oldJob.scheduledAt)).toBe(OLD_DUE.getTime())

    setBookingNoticeSyncPort(
      createNoticeLedgerSyncPort({
        ledger,
        templateVersion: 'tpl-v1',
        recipientRefHash: 'recipient-ref-wiring',
        renderedBodyFor: () => BODY_16,
        now: () => PLANNING_NOW,
        consentGrantedFor: () => true,
      })
    )

    const { client } = rescheduleClient()
    const updated = await ReservationCanonicalService.rescheduleReservation(
      BOOKING,
      SLOT_16,
      '손님 일정 변경',
      client
    )

    // 예약 자체는 정상 반환되고, 안내 동기화도 SYNCED다.
    expect(updated.slotId).toBe(SLOT_16)
    expect(updated.updatedAt).toBe(UPDATED_AT_V2)
    expect(syncResults).toEqual([{ kind: 'SYNCED', error: null }])

    // 1. 15:00 job은 INVALIDATED.
    const oldAfter = ledger.get(WS, oldJob.jobId)
    expect(oldAfter?.status).toBe('INVALIDATED')
    // 변경 사유가 있으면 그 사유를, 없으면 BOOKING_CHANGED_BEFORE_DISPATCH를 남긴다.
    expect(oldAfter?.reason).toBe('손님 일정 변경')

    // 2. 새 job은 16:00 기준이며 15:00 문자열이 본문/시각 어디에도 없다.
    const jobs = ledger.list(WS, BOOKING)
    const newJob = jobs.find((job) => job.jobId !== oldJob.jobId)
    if (newJob === undefined) throw new Error('fixture failed: no replanned job')
    expect(newJob.kind).toBe('REMINDER')
    expect(newJob.bookingVersion).toBe(V2)
    expect(newJob.scheduledAt).toBe(NEW_DUE.toISOString())
    expect(newJob.startsAt).toBe(new Date(Date.parse(SLOT_16)).toISOString())
    expect(newJob.renderedBody).toBe(BODY_16)
    expect(newJob.renderedBody).not.toContain('15:00')
    expect(newJob.scheduledAt).not.toContain('15:00')
    expect(newJob.startsAt).not.toContain('15:00')

    // 3. 구 job의 due 시점: 무효화되어 claim 대상이 아니고 요청은 0이다.
    expect(ledger.listDue(WS, OLD_DUE).map((job) => job.jobId)).not.toContain(oldJob.jobId)
    const oldRun = await runDueNotices({
      ledger,
      transport,
      context: testContext(OLD_DUE),
      readBooking: readerReturning(fact({ bookingVersion: V2, startsAt: SLOT_16 })),
      readConsent: consentGranted(),
      workspaceId: WS,
      now: OLD_DUE,
    })
    expect(oldRun.attempted).toBe(0)
    expect(transport.getAttemptCount()).toBe(0)
    expect(ledger.get(WS, oldJob.jobId)?.status).toBe('INVALIDATED')

    // 4. 새 job의 due 시점: 요청 1회. REQUEST_ACCEPTED는 배달 확인이 아니다.
    const newRun = await runDueNotices({
      ledger,
      transport,
      context: testContext(NEW_DUE),
      readBooking: readerReturning(fact({ bookingVersion: V2, startsAt: SLOT_16 })),
      readConsent: consentGranted(),
      workspaceId: WS,
      now: NEW_DUE,
    })
    expect(newRun.attempted).toBe(1)
    expect(transport.getAttemptCount()).toBe(1)
    expect(newRun.jobs).toHaveLength(1)
    expect(newRun.jobs[0]?.jobId).toBe(newJob.jobId)
    expect(newRun.jobs[0]?.outcome).toBe('ACCEPTED')
    expect(newRun.jobs[0]?.message).toBe('요청이 접수됐어요. 배달 확인 전이에요.')
    expect(newRun.jobs[0]?.actualVerified).toBe(false)
    expect(newRun.jobs[0]?.actualDeliveryCount).toBeNull()
    expect(ledger.get(WS, newJob.jobId)?.status).toBe('REQUEST_ACCEPTED')
  })

  it('무효화가 유실돼도 예약 변경 호출 경로 뒤 발송 직전 재검증이 구 job 전송을 0으로 막는다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const oldJob = planReminder15(ledger)

    // 무효화가 아무 것도 하지 못한 상황(포트 유실/원장 지연)을 흉내낸다.
    setBookingNoticeSyncPort({
      async invalidateForBooking() {
        return { invalidated: 0, inFlightOrSent: 0 }
      },
    })

    const { client } = rescheduleClient()
    const updated = await ReservationCanonicalService.rescheduleReservation(
      BOOKING,
      SLOT_16,
      '손님 일정 변경',
      client
    )
    expect(updated.slotId).toBe(SLOT_16)
    expect(ledger.get(WS, oldJob.jobId)?.status).toBe('PLANNED')

    // 구 job의 due 시각에 최신 예약(16:00/새 version)을 다시 읽어 claim 직후 차단한다.
    const run = await runDueNotices({
      ledger,
      transport,
      context: testContext(OLD_DUE),
      readBooking: readerReturning(fact({ bookingVersion: V2, startsAt: SLOT_16 })),
      readConsent: consentGranted(),
      workspaceId: WS,
      now: OLD_DUE,
    })

    expect(run.attempted).toBe(0)
    expect(transport.getAttemptCount()).toBe(0)
    expect(run.jobs).toHaveLength(1)
    expect(run.jobs[0]?.jobId).toBe(oldJob.jobId)
    expect(run.jobs[0]?.outcome).toBe('INVALIDATED')
    expect(run.jobs[0]?.reason).toBe('BOOKING_CHANGED_BEFORE_DISPATCH')
    expect(ledger.get(WS, oldJob.jobId)?.status).toBe('INVALIDATED')
  })

  it('동기화를 건너뛴 경우에도 발송 직전 재검증이 구 15:00 job 전송을 0으로 막는다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const oldJob = planReminder15(ledger)

    // 포트 미등록(=동기화 없음) 상태에서 구 job의 due 시각에 예약은 이미 16:00으로 바뀌어 있다.
    const run = await runDueNotices({
      ledger,
      transport,
      context: testContext(OLD_DUE),
      readBooking: readerReturning(fact({ bookingVersion: V2, startsAt: SLOT_16 })),
      readConsent: consentGranted(),
      workspaceId: WS,
      now: OLD_DUE,
    })

    expect(run.attempted).toBe(0)
    expect(transport.getAttemptCount()).toBe(0)
    expect(run.jobs[0]?.jobId).toBe(oldJob.jobId)
    expect(run.jobs[0]?.outcome).toBe('INVALIDATED')
    expect(ledger.get(WS, oldJob.jobId)?.status).toBe('INVALIDATED')
  })
})

describe('예약 취소 호출 경로', () => {
  it('확정 예약 리마인더는 무효화되고 발송은 0이며 취소 안내만 별도로 계획 가능하다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const reminder = planReminder15(ledger)

    setBookingNoticeSyncPort(
      createNoticeLedgerSyncPort({
        ledger,
        templateVersion: 'tpl-v1',
        recipientRefHash: 'recipient-ref-wiring',
        renderedBodyFor: () => BODY_16,
        now: () => PLANNING_NOW,
        consentGrantedFor: () => true,
      })
    )

    const { client } = cancelClient()
    const cancelled = await ReservationCanonicalService.cancelReservation(BOOKING, '고객 요청 취소', client)

    expect(cancelled.status).toBe('CANCELLED')
    expect(syncResults).toEqual([{ kind: 'SYNCED', error: null }])
    expect(ledger.get(WS, reminder.jobId)?.status).toBe('INVALIDATED')
    expect(ledger.get(WS, reminder.jobId)?.reason).toBe('고객 요청 취소')

    const run = await runDueNotices({
      ledger,
      transport,
      context: testContext(OLD_DUE),
      readBooking: readerReturning(
        fact({ bookingVersion: V2, status: 'CANCELLED' })
      ),
      readConsent: consentGranted(),
      workspaceId: WS,
      now: OLD_DUE,
    })
    expect(run.attempted).toBe(0)
    expect(transport.getAttemptCount()).toBe(0)

    // 취소 안내는 현재 설계대로 CANCELLED 상태에서만 별도 job으로 계획 가능하다.
    const cancellation = planNotice({
      ledger,
      fact: fact({ bookingVersion: V2, status: 'CANCELLED' }),
      kind: 'CANCELLATION',
      templateVersion: 'tpl-cancel-v1',
      recipientRef: 'recipient-ref-wiring',
      renderedBody: '예약이 취소되었어요. 문의가 있으시면 사장님께 알려 주세요.',
      consentGranted: true,
      now: PLANNING_NOW,
    })
    expect(cancellation.kind).toBe('PLANNED')
    if (cancellation.kind !== 'PLANNED') throw new Error('fixture failed')
    expect(cancellation.job.kind).toBe('CANCELLATION')
    expect(cancellation.job.bookingVersion).toBe(V2)
  })
})

describe('안내 동기화 실패가 예약 취소를 실패시키지 않는다', () => {
  it('포트 미등록이면 NOT_CONFIGURED이고 취소는 정상 반환된다', async () => {
    const ledger = new TestNoticeJobLedger()
    const reminder = planReminder15(ledger)

    const { client } = cancelClient()
    const cancelled = await ReservationCanonicalService.cancelReservation(BOOKING, '고객 요청 취소', client)

    expect(cancelled.status).toBe('CANCELLED')
    expect(syncResults).toEqual([{ kind: 'NOT_CONFIGURED', error: null }])
    expect(ledger.get(WS, reminder.jobId)?.status).toBe('PLANNED')
  })

  it('updated_at에서 version을 유도할 수 없어도 취소는 성공 반환된다', async () => {
    const ledger = new TestNoticeJobLedger()
    planReminder15(ledger)

    setBookingNoticeSyncPort(
      createNoticeLedgerSyncPort({
        ledger,
        templateVersion: 'tpl-v1',
        recipientRefHash: 'recipient-ref-wiring',
        renderedBodyFor: () => BODY_16,
        now: () => PLANNING_NOW,
        consentGrantedFor: () => true,
      })
    )

    // readback이 offset 없는 updated_at을 돌려주는 비정상 상황.
    const reservations = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValueOnce({ data: confirmedRow(), error: null })
        .mockResolvedValueOnce({
          data: {
            status: 'CANCELLED',
            cancelled_at: '2026-10-22T02:00:00',
            cancel_reason: '고객 요청 취소',
            updated_at: '2026-10-22T02:00:00',
          },
          error: null,
        }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }
    const client = {
      from: vi.fn().mockImplementation((table: string) =>
        table === 'reservations' ? reservations : {}
      ),
    }

    const cancelled = await ReservationCanonicalService.cancelReservation(BOOKING, '고객 요청 취소', client)

    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.updatedAt).toBe('2026-10-22T02:00:00')
    // 동기화는 호출되지 않았고, 성공으로 집계된 결과도 없다.
    expect(syncResults).toEqual([])
  })

  it('포트가 예외를 던져도 취소는 성공 반환되고 동기화 결과는 SYNC_FAILED다', async () => {
    const ledger = new TestNoticeJobLedger()
    planReminder15(ledger)

    setBookingNoticeSyncPort({
      async invalidateForBooking() {
        throw new Error('LEDGER_UNAVAILABLE')
      },
    })

    const { client } = cancelClient()
    const cancelled = await ReservationCanonicalService.cancelReservation(BOOKING, '고객 요청 취소', client)

    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.cancelReason).toBe('고객 요청 취소')
    expect(syncResults).toHaveLength(1)
    expect(syncResults[0]?.kind).toBe('SYNC_FAILED')
    expect(syncResults[0]?.error).toContain('LEDGER_UNAVAILABLE')
  })
})
