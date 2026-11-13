import { describe, expect, it } from 'vitest'
import {
  TestNoticeJobLedger,
  noticeJobKeyString,
  type NoticeJobPlanInput,
} from './notice-job-ledger'

const WS = '11111111-2222-3333-4444-555555555555'
const WS2 = '22222222-3333-4444-5555-666666666666'
const BOOKING = 'booking-1'
const RAW_RECIPIENT = 'recipient-raw-010-1234-5678'

function input(overrides: Partial<NoticeJobPlanInput> = {}): NoticeJobPlanInput {
  return {
    workspaceId: WS,
    bookingId: BOOKING,
    bookingVersion: 1,
    kind: 'REMINDER',
    templateVersion: 'tpl-v1',
    recipientRef: RAW_RECIPIENT,
    scheduledAt: '2026-10-21T06:00:00.000Z',
    renderedBody: '내일 15:00 예약 안내입니다.',
    startsAt: '2026-10-22T06:00:00.000Z',
    leadMinutes: 1440,
    ...overrides,
  }
}

function planned(ledger: TestNoticeJobLedger, overrides: Partial<NoticeJobPlanInput> = {}) {
  const result = ledger.plan(input(overrides))
  if (result.kind !== 'PLANNED') throw new Error(`fixture failed: ${result.kind}`)
  return result.job
}

describe('TestNoticeJobLedger · job 불변 키와 지문', () => {
  it('계획 시 수신자 원문을 저장하지 않고 sha256 해시만 남긴다', () => {
    const ledger = new TestNoticeJobLedger()
    const job = planned(ledger)

    expect(job.status).toBe('PLANNED')
    expect(job.claimGeneration).toBe(0)
    expect(job.recipientRefHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(job.payloadFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(JSON.stringify(job)).not.toContain(RAW_RECIPIENT)
    expect(Object.values(job).some((value) => typeof value === 'string' && value.includes('010-1234-5678'))).toBe(false)
  })

  it('같은 키·같은 지문 3회는 REPLAY이며 job은 1건이다', () => {
    const ledger = new TestNoticeJobLedger()
    const first = ledger.plan(input())
    const second = ledger.plan(input())
    const third = ledger.plan(input())

    expect(first.kind).toBe('PLANNED')
    expect(second.kind).toBe('REPLAY')
    expect(third.kind).toBe('REPLAY')
    expect(second.kind === 'REPLAY' ? second.job.jobId : null).toBe(first.kind === 'PLANNED' ? first.job.jobId : null)
    expect(ledger.list(WS, BOOKING)).toHaveLength(1)
  })

  it('같은 키·다른 본문은 CONFLICT이며 기존 원고를 덮어쓰지 않는다', () => {
    const ledger = new TestNoticeJobLedger()
    const first = ledger.plan(input())
    const conflict = ledger.plan(input({ renderedBody: '완전히 다른 본문' }))

    expect(conflict.kind).toBe('CONFLICT')
    expect(conflict.job.jobId).toBe(first.job.jobId)
    expect(ledger.list(WS, BOOKING)).toHaveLength(1)
    expect(ledger.get(WS, first.job.jobId)?.renderedBody).toBe('내일 15:00 예약 안내입니다.')
  })

  it('workspace는 격리되며 다른 workspace에서는 같은 jobId를 볼 수 없다', () => {
    const ledger = new TestNoticeJobLedger()
    const mine = planned(ledger)
    const other = ledger.plan(input({ workspaceId: WS2 }))

    expect(other.kind).toBe('PLANNED')
    expect(other.job.jobId).not.toBe(mine.jobId)
    expect(ledger.get(WS2, mine.jobId)).toBeUndefined()
    expect(ledger.list(WS2, BOOKING)).toHaveLength(1)
    expect(ledger.list(WS, BOOKING)).toHaveLength(1)
  })

  it('반환된 job은 deep-freeze 복사본이라 외부 변이가 원장을 바꾸지 않는다', () => {
    const ledger = new TestNoticeJobLedger()
    const job = planned(ledger)

    expect(Object.isFrozen(job)).toBe(true)
    try {
      ;(job as { status: string }).status = 'HUMAN_REVIEW'
    } catch {
      // frozen object assignment throws in strict mode
    }
    expect(ledger.get(WS, job.jobId)?.status).toBe('PLANNED')
    expect(noticeJobKeyString(job)).toContain(WS)
  })
})

describe('TestNoticeJobLedger · claim CAS', () => {
  it('due 전에는 NOT_CLAIMABLE이고 due 시점에 한 번만 CLAIMED가 된다', () => {
    const ledger = new TestNoticeJobLedger()
    const job = planned(ledger)

    expect(ledger.claim(WS, job.jobId, new Date('2026-10-21T05:59:00.000Z'))).toEqual({
      kind: 'NOT_CLAIMABLE',
      status: 'PLANNED',
    })

    const first = ledger.claim(WS, job.jobId, new Date('2026-10-21T06:00:00.000Z'))
    expect(first.kind).toBe('CLAIMED')
    if (first.kind !== 'CLAIMED') throw new Error('fixture failed')
    expect(first.job.claimGeneration).toBe(1)

    expect(ledger.claim(WS, job.jobId, new Date('2026-10-21T06:00:00.000Z'))).toEqual({
      kind: 'NOT_CLAIMABLE',
      status: 'CLAIMED',
    })
    expect(ledger.claim(WS2, job.jobId, new Date('2026-10-21T06:00:00.000Z'))).toEqual({
      kind: 'NOT_CLAIMABLE',
      status: 'NOT_FOUND',
    })
  })

  it('동기 원자 메서드라 연속 호출에서도 CLAIMED는 1회뿐이다', () => {
    const ledger = new TestNoticeJobLedger()
    const job = planned(ledger)
    const now = new Date('2026-10-21T06:00:00.000Z')
    const results = [ledger.claim(WS, job.jobId, now), ledger.claim(WS, job.jobId, now)]
    expect(results.filter((result) => result.kind === 'CLAIMED')).toHaveLength(1)
  })
})

describe('TestNoticeJobLedger · 상태 전이', () => {
  it('CLAIMED가 아니면 전이를 거부한다', () => {
    const ledger = new TestNoticeJobLedger()
    const job = planned(ledger)

    expect(ledger.markRequestAccepted(WS, job.jobId)).toEqual({
      kind: 'INVALID_TRANSITION',
      status: 'PLANNED',
    })
    expect(ledger.markUnknown(WS, job.jobId)).toEqual({ kind: 'INVALID_TRANSITION', status: 'PLANNED' })
    expect(ledger.markHumanReview(WS, job.jobId, 'REVIEW')).toEqual({
      kind: 'INVALID_TRANSITION',
      status: 'PLANNED',
    })
    expect(ledger.markRejected(WS, job.jobId, 'REJECTED')).toEqual({
      kind: 'INVALID_TRANSITION',
      status: 'PLANNED',
    })
  })

  it('CLAIMED에서만 REQUEST_ACCEPTED/UNKNOWN/HUMAN_REVIEW/REJECTED로 전이한다', () => {
    const ledger = new TestNoticeJobLedger()
    const now = new Date('2026-10-21T06:00:00.000Z')

    const accepted = planned(ledger, { kind: 'CONFIRMATION', templateVersion: 'tpl-a', scheduledAt: '2026-10-21T00:00:00.000Z' })
    ledger.claim(WS, accepted.jobId, now)
    expect(ledger.markRequestAccepted(WS, accepted.jobId).kind).toBe('TRANSITIONED')
    expect(ledger.get(WS, accepted.jobId)?.status).toBe('REQUEST_ACCEPTED')
    expect(ledger.get(WS, accepted.jobId)?.status).not.toBe('DELIVERED')

    const unknown = planned(ledger, { kind: 'CONFIRMATION', templateVersion: 'tpl-b', scheduledAt: '2026-10-21T00:00:00.000Z' })
    ledger.claim(WS, unknown.jobId, now)
    expect(ledger.markUnknown(WS, unknown.jobId).kind).toBe('TRANSITIONED')
    expect(ledger.get(WS, unknown.jobId)?.status).toBe('UNKNOWN')

    const review = planned(ledger, { kind: 'CONFIRMATION', templateVersion: 'tpl-c', scheduledAt: '2026-10-21T00:00:00.000Z' })
    ledger.claim(WS, review.jobId, now)
    expect(ledger.markHumanReview(WS, review.jobId, 'NEEDS_OWNER').kind).toBe('TRANSITIONED')
    expect(ledger.get(WS, review.jobId)?.status).toBe('HUMAN_REVIEW')
    expect(ledger.get(WS, review.jobId)?.reason).toBe('NEEDS_OWNER')

    const rejected = planned(ledger, { kind: 'CONFIRMATION', templateVersion: 'tpl-d', scheduledAt: '2026-10-21T00:00:00.000Z' })
    ledger.claim(WS, rejected.jobId, now)
    expect(ledger.markRejected(WS, rejected.jobId, 'TEST_REJECTED').kind).toBe('TRANSITIONED')
    expect(ledger.get(WS, rejected.jobId)?.status).toBe('REJECTED')
  })

  it('writeAhead는 CLAIMED에서만 기록되고 같은 값 재기록은 IDEMPOTENT, 다른 값은 CONFLICT다', () => {
    const ledger = new TestNoticeJobLedger()
    const job = planned(ledger)

    expect(ledger.writeAhead(WS, job.jobId, 'op-key', 'sha256:aaa').kind).toBe('INVALID_TRANSITION')

    ledger.claim(WS, job.jobId, new Date('2026-10-21T06:00:00.000Z'))
    const first = ledger.writeAhead(WS, job.jobId, 'op-key', 'sha256:aaa')
    expect(first.kind).toBe('TRANSITIONED')
    if (first.kind !== 'TRANSITIONED') throw new Error('fixture failed')
    expect(first.job.writeAhead).toEqual({ operationKey: 'op-key', payloadFingerprint: 'sha256:aaa' })

    expect(ledger.writeAhead(WS, job.jobId, 'op-key', 'sha256:aaa').kind).toBe('IDEMPOTENT')
    expect(ledger.writeAhead(WS, job.jobId, 'op-key', 'sha256:bbb').kind).toBe('CONFLICT')
    expect(ledger.get(WS, job.jobId)?.writeAhead?.payloadFingerprint).toBe('sha256:aaa')
  })
})

describe('TestNoticeJobLedger · 예약 변경 무효화', () => {
  it('이전 version의 미전송 job만 INVALIDATED하고 이미 요청된 job은 inFlightOrSent로 알린다', () => {
    const ledger = new TestNoticeJobLedger()
    const now = new Date('2026-10-21T06:00:00.000Z')

    const plannedJob = planned(ledger, { kind: 'CONFIRMATION', templateVersion: 'tpl-p', scheduledAt: '2026-10-21T00:00:00.000Z' })
    const claimedJob = planned(ledger)
    ledger.claim(WS, claimedJob.jobId, now)
    const acceptedJob = planned(ledger, { kind: 'CHANGE', templateVersion: 'tpl-a', scheduledAt: '2026-10-21T00:00:00.000Z' })
    ledger.claim(WS, acceptedJob.jobId, now)
    ledger.markRequestAccepted(WS, acceptedJob.jobId)
    const unknownJob = planned(ledger, { kind: 'CHANGE', templateVersion: 'tpl-u', scheduledAt: '2026-10-21T00:00:00.000Z' })
    ledger.claim(WS, unknownJob.jobId, now)
    ledger.markUnknown(WS, unknownJob.jobId)

    const result = ledger.invalidateForBooking({
      workspaceId: WS,
      bookingId: BOOKING,
      currentVersion: 2,
      currentStatus: 'CONFIRMED',
      reason: 'BOOKING_CHANGED',
    })

    expect(result.invalidated).toEqual(expect.arrayContaining([plannedJob.jobId, claimedJob.jobId]))
    expect(result.invalidated).not.toContain(acceptedJob.jobId)
    expect(result.inFlightOrSent).toEqual(expect.arrayContaining([acceptedJob.jobId, unknownJob.jobId]))
    expect(ledger.get(WS, plannedJob.jobId)?.status).toBe('INVALIDATED')
    expect(ledger.get(WS, claimedJob.jobId)?.status).toBe('INVALIDATED')
    expect(ledger.get(WS, acceptedJob.jobId)?.status).toBe('REQUEST_ACCEPTED')
    expect(ledger.get(WS, unknownJob.jobId)?.status).toBe('UNKNOWN')
  })

  it('취소된 예약은 확정/리마인더 job을 모두 무효화한다', () => {
    const ledger = new TestNoticeJobLedger()
    const confirmation = planned(ledger, { kind: 'CONFIRMATION', templateVersion: 'tpl-c', scheduledAt: '2026-10-21T00:00:00.000Z' })
    const reminder = planned(ledger)

    const result = ledger.invalidateForBooking({
      workspaceId: WS,
      bookingId: BOOKING,
      currentVersion: 2,
      currentStatus: 'CANCELLED',
      reason: 'BOOKING_CANCELLED',
    })

    expect(result.invalidated).toEqual(expect.arrayContaining([confirmation.jobId, reminder.jobId]))
    expect(ledger.get(WS, reminder.jobId)?.status).toBe('INVALIDATED')
  })

  it('CANCELLATION job은 최신 CANCELLED version일 때만 유지된다', () => {
    const ledger = new TestNoticeJobLedger()
    const cancellation = planned(ledger, {
      kind: 'CANCELLATION',
      bookingVersion: 2,
      scheduledAt: '2026-10-21T00:00:00.000Z',
      renderedBody: '예약이 취소되었어요.',
    })

    const kept = ledger.invalidateForBooking({
      workspaceId: WS,
      bookingId: BOOKING,
      currentVersion: 2,
      currentStatus: 'CANCELLED',
      reason: 'BOOKING_CHANGED',
    })
    expect(kept.invalidated).not.toContain(cancellation.jobId)
    expect(ledger.get(WS, cancellation.jobId)?.status).toBe('PLANNED')

    const dropped = ledger.invalidateForBooking({
      workspaceId: WS,
      bookingId: BOOKING,
      currentVersion: 3,
      currentStatus: 'CANCELLED',
      reason: 'BOOKING_CHANGED',
    })
    expect(dropped.invalidated).toContain(cancellation.jobId)
    expect(ledger.get(WS, cancellation.jobId)?.status).toBe('INVALIDATED')
  })

  it('다른 예약/workspace의 job은 건드리지 않는다', () => {
    const ledger = new TestNoticeJobLedger()
    const mine = planned(ledger)
    const otherBooking = planned(ledger, { bookingId: 'booking-2' })
    const otherWorkspace = planned(ledger, { workspaceId: WS2 })

    const result = ledger.invalidateForBooking({
      workspaceId: WS,
      bookingId: BOOKING,
      currentVersion: 2,
      currentStatus: 'CONFIRMED',
      reason: 'BOOKING_CHANGED',
    })

    expect(result.invalidated).toEqual([mine.jobId])
    expect(ledger.get(WS, otherBooking.jobId)?.status).toBe('PLANNED')
    expect(ledger.get(WS2, otherWorkspace.jobId)?.status).toBe('PLANNED')
  })
})

describe('TestNoticeJobLedger · due 조회', () => {
  it('PLANNED이면서 due인 job만 시각 순으로 돌려준다', () => {
    const ledger = new TestNoticeJobLedger()
    const late = planned(ledger, { templateVersion: 'tpl-late', scheduledAt: '2026-10-21T07:00:00.000Z' })
    const early = planned(ledger, { templateVersion: 'tpl-early', scheduledAt: '2026-10-21T05:00:00.000Z' })
    const future = planned(ledger, { templateVersion: 'tpl-future', scheduledAt: '2026-10-21T09:00:00.000Z' })
    const claimed = planned(ledger, { templateVersion: 'tpl-claimed', scheduledAt: '2026-10-21T04:00:00.000Z' })
    ledger.claim(WS, claimed.jobId, new Date('2026-10-21T04:00:00.000Z'))

    const due = ledger.listDue(WS, new Date('2026-10-21T08:00:00.000Z'))
    expect(due.map((job) => job.jobId)).toEqual([early.jobId, late.jobId])
    expect(due.map((job) => job.jobId)).not.toContain(future.jobId)
    expect(due.map((job) => job.jobId)).not.toContain(claimed.jobId)
    expect(ledger.listDue(WS2, new Date('2026-10-21T08:00:00.000Z'))).toEqual([])
  })
})
