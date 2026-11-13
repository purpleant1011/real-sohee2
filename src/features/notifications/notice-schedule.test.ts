import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { TestNoticeJobLedger, noticeJobKeyString } from './notice-job-ledger'
import {
  invalidateOnBookingChange,
  planNotice,
  reconcileNotice,
  runDueNotices,
  type BookingNoticeFact,
  type PlanNoticeInput,
  type ReadBooking,
  type ReadConsent,
} from './notice-schedule'
import {
  MinimalTestTransport,
  computeRequestFingerprint,
} from '../policy-gate/testing/minimal-transport'
import type { Context, Controls } from '../policy-gate/testing/minimal-admission'

const WS = '11111111-2222-3333-4444-555555555555'
const WS2 = '22222222-3333-4444-5555-666666666666'
const BOOKING = 'booking-1'
const CUSTOMER = 'customer-1'

function fact(overrides: Partial<BookingNoticeFact> = {}): BookingNoticeFact {
  return {
    workspaceId: WS,
    bookingId: BOOKING,
    bookingVersion: 1,
    status: 'CONFIRMED',
    customerId: CUSTOMER,
    startsAt: '2026-10-22T15:00:00+09:00',
    serviceName: '상담 서비스',
    locationText: '확인된 위치',
    ...overrides,
  }
}

function testControls(overrides: Partial<Controls> = {}): Controls {
  return {
    mode: 'TEST_FAKE_ONLY',
    datasetMode: 'TEST',
    allowedWorkspaceIds: [WS, WS2],
    killSwitch: false,
    ...overrides,
  }
}

function context(overrides: Partial<Context> = {}): Context {
  return {
    controls: testControls(),
    now: new Date('2026-10-21T09:00:00+09:00'),
    evaluator: () => ({ ready: true }),
    ...overrides,
  }
}

function readerReturning(...facts: BookingNoticeFact[]): ReadBooking {
  const byKey = new Map(facts.map((entry) => [`${entry.workspaceId}:${entry.bookingId}`, entry]))
  return async (query) => {
    const found = byKey.get(`${query.workspaceId}:${query.bookingId}`)
    return found ? { ok: true, fact: found } : { ok: false, error: 'BOOKING_NOT_FOUND' }
  }
}

function consentReturning(granted: boolean): ReadConsent {
  return async (query) =>
    query.workspaceId === WS && query.customerId === CUSTOMER && query.purpose === 'INFO'
      ? { ok: true, granted }
      : { ok: false, error: 'CONSENT_UNAVAILABLE' }
}

function planInput(overrides: Partial<PlanNoticeInput> = {}): PlanNoticeInput {
  return {
    ledger: new TestNoticeJobLedger(),
    fact: fact(),
    kind: 'CONFIRMATION',
    templateVersion: 'tpl-v1',
    recipientRef: 'recipient-ref-1',
    renderedBody: '예약이 확정되었어요. 방문 전에 다시 안내드릴게요.',
    consentGranted: true,
    now: new Date('2026-10-21T09:00:00+09:00'),
    ...overrides,
  }
}

function planOrThrow(input: PlanNoticeInput) {
  const result = planNotice(input)
  if (result.kind === 'REJECTED' || result.kind === 'CONFLICT') {
    throw new Error(`fixture failed: ${result.kind} ${result.kind === 'REJECTED' ? result.reason : ''}`)
  }
  return result
}

describe('notice-schedule · 15:00 → 16:00 변경 (BDD)', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('구 리마인더는 무효화되어 전송 0이고 새 계획만 16:00 기준이다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const now = new Date('2026-10-21T00:00:00+09:00')

    const planned = planOrThrow(
      planInput({
        ledger,
        fact: fact({ startsAt: '2026-10-22T15:00:00+09:00' }),
        kind: 'REMINDER',
        leadMinutes: 1440,
        renderedBody: '내일 15:00 예약 안내입니다.',
        now,
      })
    )
    expect(Date.parse(planned.job.scheduledAt)).toBe(Date.parse('2026-10-21T15:00:00+09:00'))

    const changed = invalidateOnBookingChange({
      ledger,
      workspaceId: WS,
      bookingId: BOOKING,
      currentVersion: 2,
      currentStatus: 'CONFIRMED',
    })
    expect(changed.invalidated).toContain(planned.job.jobId)
    expect(changed.inFlightOrSent).toEqual([])
    expect(changed.message).toContain('예약이 바뀌어')
    expect(changed.message).toContain('보내지 않았어요')

    const run = await runDueNotices({
      ledger,
      transport,
      context: context(),
      readBooking: readerReturning(fact({ bookingVersion: 2, startsAt: '2026-10-22T16:00:00+09:00' })),
      readConsent: consentReturning(true),
      workspaceId: WS,
      now: new Date('2026-10-21T15:30:00+09:00'),
    })
    expect(run.attempted).toBe(0)
    expect(transport.getAttemptCount()).toBe(0)
    expect(ledger.get(WS, planned.job.jobId)?.status).toBe('INVALIDATED')

    const replanned = planOrThrow(
      planInput({
        ledger,
        fact: fact({ bookingVersion: 2, startsAt: '2026-10-22T16:00:00+09:00' }),
        kind: 'REMINDER',
        leadMinutes: 1440,
        renderedBody: '내일 16:00 예약 안내입니다.',
        now,
      })
    )
    expect(replanned.kind).toBe('PLANNED')
    expect(replanned.job.jobId).not.toBe(planned.job.jobId)
    expect(Date.parse(replanned.job.scheduledAt)).toBe(Date.parse('2026-10-21T16:00:00+09:00'))
    expect(replanned.job.renderedBody).not.toContain('15:00')
    expect(replanned.job.scheduledAt).not.toContain('15:00')
    expect(replanned.job.startsAt).toBe(new Date(Date.parse('2026-10-22T16:00:00+09:00')).toISOString())
  })
})

describe('notice-schedule · 취소', () => {
  it('취소된 예약은 확정/리마인더 계획을 거부하고 기존 job은 전송 0으로 무효화된다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const now = new Date('2026-10-21T00:00:00+09:00')

    const cancelledFact = fact({ bookingVersion: 2, status: 'CANCELLED' })
    const confirmation = planNotice(planInput({ ledger, fact: cancelledFact, kind: 'CONFIRMATION', now }))
    expect(confirmation.kind).toBe('REJECTED')
    if (confirmation.kind !== 'REJECTED') throw new Error('fixture failed')
    expect(confirmation.reason).toBe('BOOKING_NOT_CONFIRMED')

    const reminder = planNotice(
      planInput({ ledger, fact: cancelledFact, kind: 'REMINDER', leadMinutes: 1440, now })
    )
    expect(reminder.kind).toBe('REJECTED')

    const pending = planNotice(planInput({ ledger, fact: fact({ status: 'PENDING' }), kind: 'CONFIRMATION', now }))
    expect(pending.kind).toBe('REJECTED')
    if (pending.kind !== 'REJECTED') throw new Error('fixture failed')
    expect(pending.reason).toBe('BOOKING_NOT_CONFIRMED')

    const oldConfirmation = planOrThrow(
      planInput({ ledger, fact: fact({ bookingVersion: 1, status: 'CONFIRMED' }), kind: 'CONFIRMATION', now })
    )
    const oldReminder = planOrThrow(
      planInput({
        ledger,
        fact: fact({ bookingVersion: 1, status: 'CONFIRMED' }),
        kind: 'REMINDER',
        leadMinutes: 1440,
        now,
      })
    )

    const invalidated = invalidateOnBookingChange({
      ledger,
      workspaceId: WS,
      bookingId: BOOKING,
      currentVersion: 2,
      currentStatus: 'CANCELLED',
    })
    expect(invalidated.invalidated).toEqual(
      expect.arrayContaining([oldConfirmation.job.jobId, oldReminder.job.jobId])
    )

    const run = await runDueNotices({
      ledger,
      transport,
      context: context(),
      readBooking: readerReturning(cancelledFact),
      readConsent: consentReturning(true),
      workspaceId: WS,
      now: new Date('2026-10-22T00:00:00+09:00'),
    })
    expect(run.attempted).toBe(0)
    expect(transport.getAttemptCount()).toBe(0)

    const cancellation = planNotice(
      planInput({
        ledger,
        fact: cancelledFact,
        kind: 'CANCELLATION',
        renderedBody: '예약이 취소되었어요. 문의가 있으시면 사장님께 알려 주세요.',
        now,
      })
    )
    expect(cancellation.kind).toBe('PLANNED')

    const onConfirmed = planNotice(
      planInput({ ledger, fact: fact({ bookingVersion: 3, status: 'CONFIRMED' }), kind: 'CANCELLATION', now })
    )
    expect(onConfirmed.kind).toBe('REJECTED')
    if (onConfirmed.kind !== 'REJECTED') throw new Error('fixture failed')
    expect(onConfirmed.reason).toBe('BOOKING_NOT_CANCELLED')
  })
})

describe('notice-schedule · claim 직전 재검증', () => {
  it('invalidate를 아직 부르지 않아도 runDue가 최신 예약을 보고 전송 0으로 무효화한다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const now = new Date('2026-10-21T00:00:00+09:00')

    const planned = planOrThrow(
      planInput({
        ledger,
        fact: fact({ startsAt: '2026-10-22T15:00:00+09:00' }),
        kind: 'REMINDER',
        leadMinutes: 1440,
        renderedBody: '내일 15:00 예약 안내입니다.',
        now,
      })
    )

    const run = await runDueNotices({
      ledger,
      transport,
      context: context(),
      readBooking: readerReturning(fact({ bookingVersion: 2, startsAt: '2026-10-22T16:00:00+09:00' })),
      readConsent: consentReturning(true),
      workspaceId: WS,
      now: new Date('2026-10-21T15:30:00+09:00'),
    })

    expect(run.attempted).toBe(0)
    expect(transport.getAttemptCount()).toBe(0)
    expect(run.jobs).toHaveLength(1)
    expect(run.jobs[0]?.outcome).toBe('INVALIDATED')
    expect(ledger.get(WS, planned.job.jobId)?.status).toBe('INVALIDATED')
  })
})

describe('notice-schedule · 중복 계획과 동시 실행', () => {
  it('동일 계획 3회는 job 1건이고 순차/동시 runDue에도 요청은 최대 1회다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED', 'TEST_ACCEPTED', 'TEST_ACCEPTED'])
    const now = new Date('2026-10-21T09:00:00+09:00')
    const input = planInput({ ledger, now })

    const results = [planNotice(input), planNotice(input), planNotice(input)]
    expect(results.map((result) => result.kind)).toEqual(['PLANNED', 'REPLAY', 'REPLAY'])
    expect(ledger.list(WS, BOOKING)).toHaveLength(1)

    const args = {
      ledger,
      transport,
      context: context(),
      readBooking: readerReturning(fact()),
      readConsent: consentReturning(true),
      workspaceId: WS,
      now,
    }
    const [first, second] = await Promise.all([runDueNotices(args), runDueNotices(args)])
    expect(transport.getAttemptCount()).toBe(1)
    expect(first.attempted + second.attempted).toBe(1)

    await runDueNotices(args)
    expect(transport.getAttemptCount()).toBe(1)
  })

  it('같은 키 다른 본문은 CONFLICT이며 원고를 덮어쓰지 않는다', () => {
    const ledger = new TestNoticeJobLedger()
    const first = planOrThrow(planInput({ ledger }))
    const conflict = planNotice(planInput({ ledger, renderedBody: '완전히 다른 원고입니다.' }))

    expect(conflict.kind).toBe('CONFLICT')
    expect(ledger.get(WS, first.job.jobId)?.renderedBody).toBe('예약이 확정되었어요. 방문 전에 다시 안내드릴게요.')
    expect(ledger.list(WS, BOOKING)).toHaveLength(1)
  })
})

describe('notice-schedule · UNKNOWN 봉인과 reconcile', () => {
  it('타임아웃 후 재실행은 재전송하지 않고 reconcile은 조회만 한다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_UNKNOWN'])
    const now = new Date('2026-10-21T09:00:00+09:00')

    const planned = planOrThrow(planInput({ ledger, now }))
    const args = {
      ledger,
      transport,
      context: context(),
      readBooking: readerReturning(fact()),
      readConsent: consentReturning(true),
      workspaceId: WS,
      now,
    }

    const first = await runDueNotices(args)
    expect(first.jobs[0]?.outcome).toBe('UNKNOWN')
    expect(first.jobs[0]?.message).toContain('자동으로 다시 보내지 않아요')
    expect(transport.getAttemptCount()).toBe(1)
    expect(ledger.get(WS, planned.job.jobId)?.status).toBe('UNKNOWN')

    const second = await runDueNotices(args)
    expect(second.attempted).toBe(0)
    expect(transport.getAttemptCount()).toBe(1)
    expect(ledger.get(WS, planned.job.jobId)?.status).toBe('UNKNOWN')

    const job = ledger.get(WS, planned.job.jobId)
    if (!job) throw new Error('fixture failed')

    const noObservation = vi.fn(async () => null)
    const reconciledEmpty = await reconcileNotice({
      ledger,
      workspaceId: WS,
      jobId: job.jobId,
      readObservation: noObservation,
    })
    expect(noObservation).toHaveBeenCalledTimes(1)
    expect(reconciledEmpty.matches).toBe(false)
    expect(reconciledEmpty.resolution).toBe('UNKNOWN')
    expect(transport.getAttemptCount()).toBe(1)
    expect(ledger.get(WS, job.jobId)?.status).toBe('UNKNOWN')

    const scope = {
      workspaceId: WS,
      provider: 'kakao' as const,
      action: 'message' as const,
      operationKey: noticeJobKeyString(job),
    }
    const matchingFingerprint = computeRequestFingerprint(scope, new TextEncoder().encode(job.renderedBody))

    const matched = await reconcileNotice({
      ledger,
      workspaceId: WS,
      jobId: job.jobId,
      readObservation: async () => ({
        observationRef: 'test-observation:1',
        requestFingerprint: matchingFingerprint,
        observedAt: '2026-10-21T09:05:00+09:00',
      }),
    })
    expect(matched.matches).toBe(true)
    expect(matched.datasetMode).toBe('TEST')
    expect(matched.actualVerified).toBe(false)
    expect(matched.actualDeliveryCount).toBeNull()
    expect(ledger.get(WS, job.jobId)?.status).toBe('UNKNOWN')
    expect(transport.getAttemptCount()).toBe(1)

    const mismatched = await reconcileNotice({
      ledger,
      workspaceId: WS,
      jobId: job.jobId,
      readObservation: async () => ({
        observationRef: 'test-observation:2',
        requestFingerprint: 'sha256:other-fingerprint',
        observedAt: '2026-10-21T09:06:00+09:00',
      }),
    })
    expect(mismatched.matches).toBe(false)
    expect(mismatched.resolution).toBe('HUMAN_REVIEW')
    expect(ledger.get(WS, job.jobId)?.status).toBe('UNKNOWN')
  })
})

describe('notice-schedule · 시간 경계', () => {
  const base = {
    ledger: new TestNoticeJobLedger(),
    kind: 'REMINDER' as const,
    templateVersion: 'tpl-v1',
    recipientRef: 'recipient-ref-1',
    renderedBody: '방문 전 안내예요.',
    consentGranted: true,
    now: new Date('2026-10-20T00:00:00+09:00'),
  }

  it('Asia/Seoul +09:00에서 정확히 24시간 전 instant를 계산한다', () => {
    const result = planOrThrow(planInput({ ...base, fact: fact({ startsAt: '2026-10-22T15:00:00+09:00' }), leadMinutes: 1440 }))
    expect(Date.parse(result.job.scheduledAt)).toBe(Date.parse('2026-10-21T15:00:00+09:00'))
    expect(Date.parse(result.job.scheduledAt)).toBe(Date.parse('2026-10-21T06:00:00Z'))
  })

  it('offset 표기가 달라도 같은 instant면 같은 scheduledAt이다', () => {
    const seoul = planOrThrow(
      planInput({ ...base, fact: fact({ startsAt: '2026-10-22T15:00:00+09:00' }), leadMinutes: 1440 })
    )
    const utc = planOrThrow(
      planInput({
        ...base,
        ledger: new TestNoticeJobLedger(),
        fact: fact({ startsAt: '2026-10-22T06:00:00Z' }),
        leadMinutes: 1440,
      })
    )
    expect(Date.parse(utc.job.scheduledAt)).toBe(Date.parse(seoul.job.scheduledAt))
  })

  it('미국 DST 전환 구간에서도 달력 전날이 아니라 정확히 24시간 전 instant다', () => {
    const result = planOrThrow(
      planInput({
        ...base,
        now: new Date('2027-03-13T00:00:00Z'),
        fact: fact({ startsAt: '2027-03-14T09:00:00-04:00' }),
        leadMinutes: 1440,
      })
    )
    expect(Date.parse(result.job.scheduledAt)).toBe(Date.parse('2027-03-13T13:00:00Z'))
    expect(Date.parse(result.job.scheduledAt)).not.toBe(Date.parse('2027-03-13T09:00:00-05:00'))
  })

  it('이미 지난 scheduledAt은 PAST_DUE_REJECTED로 거부한다', () => {
    const result = planNotice(
      planInput({
        ...base,
        now: new Date('2026-10-21T00:00:00Z'),
        fact: fact({ startsAt: '2026-10-21T05:00:00Z' }),
        leadMinutes: 1440,
      })
    )
    expect(result.kind).toBe('REJECTED')
    if (result.kind !== 'REJECTED') throw new Error('fixture failed')
    expect(result.reason).toBe('PAST_DUE_REJECTED')
  })

  it.each(['CONFIRMATION', 'REMINDER', 'CHANGE'] as const)('방문 시작 후 %s는 거부한다', (kind) => {
    const result = planNotice(
      planInput({
        ...base,
        kind,
        leadMinutes: kind === 'REMINDER' ? 1440 : undefined,
        now: new Date('2026-10-22T07:00:00Z'),
        fact: fact({ startsAt: '2026-10-22T06:00:00Z' }),
      })
    )
    expect(result.kind).toBe('REJECTED')
    if (result.kind !== 'REJECTED') throw new Error('fixture failed')
    expect(result.reason).toBe('VISIT_ALREADY_STARTED')
  })

  it('offset 없는 ISO와 파싱 불가 시각은 거부한다', () => {
    const withoutOffset = planNotice(
      planInput({ ...base, fact: fact({ startsAt: '2026-10-22T15:00:00' }), leadMinutes: 1440 })
    )
    expect(withoutOffset.kind).toBe('REJECTED')
    if (withoutOffset.kind !== 'REJECTED') throw new Error('fixture failed')
    expect(withoutOffset.reason).toBe('STARTS_AT_WITHOUT_OFFSET')

    const unparsable = planNotice(
      planInput({ ...base, fact: fact({ startsAt: 'not-a-date' }), leadMinutes: 1440 })
    )
    expect(unparsable.kind).toBe('REJECTED')
    if (unparsable.kind !== 'REJECTED') throw new Error('fixture failed')
    expect(unparsable.reason).toBe('STARTS_AT_INVALID')
  })

  it.each([0, -1, 1.5, Number.NaN])('leadMinutes %s는 거부한다', (leadMinutes) => {
    const result = planNotice(planInput({ ...base, fact: fact(), leadMinutes }))
    expect(result.kind).toBe('REJECTED')
    if (result.kind !== 'REJECTED') throw new Error('fixture failed')
    expect(result.reason).toBe('LEAD_MINUTES_INVALID')
  })
})

describe('notice-schedule · 동의·조회 오류·workspace 격리', () => {
  it('동의가 정확히 true가 아니면 계획을 거부한다', () => {
    const result = planNotice(planInput({ consentGranted: false }))
    expect(result.kind).toBe('REJECTED')
    if (result.kind !== 'REJECTED') throw new Error('fixture failed')
    expect(result.reason).toBe('CONSENT_NOT_GRANTED')
  })

  it('본문이 비었거나 변수 placeholder가 남으면 거부한다', () => {
    const empty = planNotice(planInput({ renderedBody: '   ' }))
    expect(empty.kind).toBe('REJECTED')
    if (empty.kind !== 'REJECTED') throw new Error('fixture failed')
    expect(empty.reason).toBe('BODY_EMPTY')

    const placeholder = planNotice(planInput({ renderedBody: '{{고객명}} 사장님 안녕하세요.' }))
    expect(placeholder.kind).toBe('REJECTED')
    if (placeholder.kind !== 'REJECTED') throw new Error('fixture failed')
    expect(placeholder.reason).toBe('BODY_PLACEHOLDER_REMAINS')
  })

  it('TEST가 아닌 datasetMode는 fail-closed로 거부한다', () => {
    const actual = planNotice(planInput({ fact: fact({ datasetMode: 'ACTUAL' }) }))
    expect(actual.kind).toBe('REJECTED')
    if (actual.kind !== 'REJECTED') throw new Error('fixture failed')
    expect(actual.reason).toBe('DATASET_MODE_NOT_TEST')

    const showcase = planNotice(planInput({ fact: fact({ datasetMode: 'SHOWCASE_DEMO' }) }))
    expect(showcase.kind).toBe('REJECTED')
  })

  it('runDue: 동의 철회는 INVALIDATED, 동의 조회 오류는 HUMAN_REVIEW이며 전송 0이다', async () => {
    const now = new Date('2026-10-21T09:00:00+09:00')

    const withdrawnLedger = new TestNoticeJobLedger()
    const withdrawnTransport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const withdrawn = planOrThrow(planInput({ ledger: withdrawnLedger, now }))
    const withdrawnRun = await runDueNotices({
      ledger: withdrawnLedger,
      transport: withdrawnTransport,
      context: context(),
      readBooking: readerReturning(fact()),
      readConsent: async () => ({ ok: true, granted: false }),
      workspaceId: WS,
      now,
    })
    expect(withdrawnRun.attempted).toBe(0)
    expect(withdrawnRun.jobs[0]?.outcome).toBe('INVALIDATED')
    expect(withdrawnTransport.getAttemptCount()).toBe(0)
    expect(withdrawnLedger.get(WS, withdrawn.job.jobId)?.status).toBe('INVALIDATED')

    const errorLedger = new TestNoticeJobLedger()
    const errorTransport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const errorJob = planOrThrow(planInput({ ledger: errorLedger, now }))
    const errorRun = await runDueNotices({
      ledger: errorLedger,
      transport: errorTransport,
      context: context(),
      readBooking: readerReturning(fact()),
      readConsent: async () => ({ ok: false, error: 'CONSENT_READ_FAILED' }),
      workspaceId: WS,
      now,
    })
    expect(errorRun.attempted).toBe(0)
    expect(errorRun.jobs[0]?.outcome).toBe('HUMAN_REVIEW')
    expect(errorRun.jobs[0]?.reason).toContain('CONSENT_READ_FAILED')
    expect(errorTransport.getAttemptCount()).toBe(0)
    expect(errorLedger.get(WS, errorJob.job.jobId)?.status).toBe('HUMAN_REVIEW')
  })

  it('예약 조회 오류를 빈 목록이나 성공으로 숨기지 않는다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const now = new Date('2026-10-21T09:00:00+09:00')
    const job = planOrThrow(planInput({ ledger, now }))

    const run = await runDueNotices({
      ledger,
      transport,
      context: context(),
      readBooking: async () => ({ ok: false, error: 'BOOKING_READ_FAILED' }),
      readConsent: consentReturning(true),
      workspaceId: WS,
      now,
    })

    expect(run.jobs).toHaveLength(1)
    expect(run.jobs[0]?.outcome).toBe('HUMAN_REVIEW')
    expect(run.jobs[0]?.reason).toContain('BOOKING_READ_FAILED')
    expect(run.attempted).toBe(0)
    expect(transport.getAttemptCount()).toBe(0)
    expect(ledger.get(WS, job.job.jobId)?.status).toBe('HUMAN_REVIEW')
  })

  it('다른 workspace에서는 예약·동의에 접근하지 못하고 실행할 job도 없다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const now = new Date('2026-10-21T09:00:00+09:00')
    const job = planOrThrow(planInput({ ledger, now }))

    expect(ledger.get(WS2, job.job.jobId)).toBeUndefined()
    expect(ledger.list(WS2, BOOKING)).toEqual([])

    const bookingQueries: string[] = []
    const consentQueries: string[] = []
    const run = await runDueNotices({
      ledger,
      transport,
      context: context(),
      readBooking: async (query) => {
        bookingQueries.push(query.workspaceId)
        return { ok: false, error: 'NOT_FOUND' }
      },
      readConsent: async (query) => {
        consentQueries.push(query.workspaceId)
        return { ok: false, error: 'NOT_FOUND' }
      },
      workspaceId: WS2,
      now,
    })

    expect(run.jobs).toEqual([])
    expect(run.attempted).toBe(0)
    expect(bookingQueries).toEqual([])
    expect(consentQueries).toEqual([])
    expect(transport.getAttemptCount()).toBe(0)
  })
})

describe('notice-schedule · admission 거부는 전송 0 + 수동 대안 보존', () => {
  const now = new Date('2026-10-21T09:00:00+09:00')

  it.each([
    ['OFF', testControls({ mode: 'OFF' })],
    ['ACTUAL', testControls({ datasetMode: 'ACTUAL' })],
    ['SHOWCASE_DEMO', testControls({ datasetMode: 'SHOWCASE_DEMO' })],
    ['kill', testControls({ killSwitch: true })],
    ['foreign allowlist', testControls({ allowedWorkspaceIds: [WS2] })],
  ])('admission %s 거부 시 요청 0이고 HUMAN_REVIEW로 남긴다', async (_label, controls) => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const job = planOrThrow(planInput({ ledger, now }))

    const run = await runDueNotices({
      ledger,
      transport,
      context: context({ controls }),
      readBooking: readerReturning(fact()),
      readConsent: consentReturning(true),
      workspaceId: WS,
      now,
    })

    expect(run.attempted).toBe(0)
    expect(transport.getAttemptCount()).toBe(0)
    expect(run.jobs[0]?.outcome).toBe('HUMAN_REVIEW')
    expect(ledger.get(WS, job.job.jobId)?.status).toBe('HUMAN_REVIEW')
    expect(ledger.get(WS, job.job.jobId)?.status).not.toBe('PLANNED')
  })

  it('capability 거부는 manualAlternative를 보존하고 요청 0이다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const job = planOrThrow(planInput({ ledger, now }))

    const run = await runDueNotices({
      ledger,
      transport,
      context: context({
        evaluator: () => ({
          ready: false,
          reason: 'KAKAO_MESSAGE_UNSUPPORTED',
          manualAlternative: '사장님이 직접 안내해 주세요.',
        }),
      }),
      readBooking: readerReturning(fact()),
      readConsent: consentReturning(true),
      workspaceId: WS,
      now,
    })

    expect(run.attempted).toBe(0)
    expect(transport.getAttemptCount()).toBe(0)
    expect(run.jobs[0]?.outcome).toBe('HUMAN_REVIEW')
    expect(run.jobs[0]?.manualAlternative).toBe('사장님이 직접 안내해 주세요.')
    expect(run.jobs[0]?.reason).toContain('KAKAO_MESSAGE_UNSUPPORTED')
    expect(ledger.get(WS, job.job.jobId)?.status).toBe('HUMAN_REVIEW')
  })
})

describe('notice-schedule · 정상 접수/거절과 네트워크 차단', () => {
  let fetchSpy: MockInstance<typeof fetch>

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    fetchSpy.mockRestore()
  })

  it('TEST_ACCEPTED는 REQUEST_ACCEPTED로만 남고 배달 확인으로 승격되지 않는다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_ACCEPTED'])
    const now = new Date('2026-10-21T09:00:00+09:00')
    const job = planOrThrow(planInput({ ledger, now }))

    const run = await runDueNotices({
      ledger,
      transport,
      context: context(),
      readBooking: readerReturning(fact()),
      readConsent: consentReturning(true),
      workspaceId: WS,
      now,
    })

    expect(run.attempted).toBe(1)
    expect(run.jobs[0]?.outcome).toBe('ACCEPTED')
    expect(run.jobs[0]?.message).toBe('요청이 접수됐어요. 배달 확인 전이에요.')
    expect(run.jobs[0]?.datasetMode).toBe('TEST')
    expect(run.jobs[0]?.actualVerified).toBe(false)
    expect(run.jobs[0]?.actualDeliveryCount).toBeNull()
    expect(run.jobs[0]?.actualCostKrw).toBeNull()
    expect(ledger.get(WS, job.job.jobId)?.status).toBe('REQUEST_ACCEPTED')
    expect(ledger.get(WS, job.job.jobId)?.writeAhead).not.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('TEST_REJECTED는 REJECTED로 남고 사장님 수동 안내를 안내한다', async () => {
    const ledger = new TestNoticeJobLedger()
    const transport = new MinimalTestTransport(['TEST_REJECTED'])
    const now = new Date('2026-10-21T09:00:00+09:00')
    const job = planOrThrow(planInput({ ledger, now }))

    const run = await runDueNotices({
      ledger,
      transport,
      context: context(),
      readBooking: readerReturning(fact()),
      readConsent: consentReturning(true),
      workspaceId: WS,
      now,
    })

    expect(run.jobs[0]?.outcome).toBe('REJECTED')
    expect(run.jobs[0]?.message).toContain('사장님이 직접 안내해 주세요')
    expect(ledger.get(WS, job.job.jobId)?.status).toBe('REJECTED')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
