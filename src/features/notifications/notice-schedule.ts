/**
 * 예약 안내·리마인더 스케줄 서비스 (TEST 전용) · ANI-1620
 *
 * 계획(plan) → claim 직전 재검증 → 요청 → 접수/불명/거절 분리.
 * 실제 카카오 SDK/HTTP/secret/queue/cron은 쓰지 않는다. transport는
 * policy-gate/testing/minimal-transport의 TEST double만 받는다.
 *
 * 시간 규칙: 모든 시각은 offset 있는 ISO instant로만 다루고,
 * 리마인더는 leadMinutes × 60000ms의 순수 instant 산술로 계산한다.
 * 시스템 로컬 타임존/Date.setDate/'달력 전날' 해석은 쓰지 않는다.
 *
 * 사용자 문구는 업종 중립 한국어('사장님/손님')이며 내부 코드명을 노출하지 않는다.
 */

import type { Context } from '../policy-gate/testing/minimal-admission'
import type { TestTransport } from '../policy-gate/testing/minimal-transport'
import { computeRequestFingerprint } from '../policy-gate/request-fingerprint'
import {
  TestNoticeJobLedger,
  noticeJobKeyString,
  type NoticeJob,
  type NoticeJobStatus,
  type NoticeKind,
} from './notice-job-ledger'

export type BookingStatus = 'CONFIRMED' | 'CANCELLED' | 'PENDING' | 'COMPLETED' | 'UNKNOWN'
export type BookingDatasetMode = 'TEST' | 'ACTUAL' | 'SHOWCASE_DEMO'

export type BookingNoticeFact = Readonly<{
  workspaceId: string
  bookingId: string
  bookingVersion: number
  status: BookingStatus
  customerId: string
  /** offset 있는 ISO instant. 예: 2026-10-22T15:00:00+09:00 */
  startsAt: string
  serviceName: string
  locationText: string
  /** 미지정이면 TEST로 본다. ACTUAL/SHOWCASE_DEMO는 fail-closed. */
  datasetMode?: BookingDatasetMode
}>

export type ReadBooking = (query: Readonly<{ workspaceId: string; bookingId: string }>) => Promise<
  Readonly<{ ok: true; fact: BookingNoticeFact }> | Readonly<{ ok: false; error: string }>
>

export type ReadConsent = (
  query: Readonly<{ workspaceId: string; customerId: string; purpose: 'INFO' }>
) => Promise<Readonly<{ ok: true; granted: boolean }> | Readonly<{ ok: false; error: string }>>

const OFFSET_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

const MESSAGES = {
  datasetNotTest: '지금은 실제 발송 준비가 되지 않아 안내를 준비하지 않았어요.',
  bookingNotConfirmed: '확정된 예약에만 안내를 보낼 수 있어요.',
  bookingNotCancelled: '취소된 예약에만 취소 안내를 보낼 수 있어요.',
  consentNotGranted: '손님의 안내 수신 근거가 확인되지 않아 준비하지 않았어요.',
  bodyEmpty: '안내 문구가 비어 있어 준비하지 않았어요.',
  bodyPlaceholder: '안내 문구에 채워지지 않은 항목이 있어 준비하지 않았어요.',
  startsAtInvalid: '예약 시각을 읽을 수 없어 준비하지 않았어요.',
  startsAtWithoutOffset: '예약 시각에 시간대 정보가 없어 준비하지 않았어요.',
  nowInvalid: '기준 시각이 올바르지 않아 준비하지 않았어요.',
  leadMinutesInvalid: '며칠 전에 안내할지가 올바르지 않아 준비하지 않았어요.',
  visitAlreadyStarted: '이미 방문 시각이 지나 안내를 보내지 않았어요.',
  pastDue: '보낼 시각이 이미 지나 지난 안내를 몰아서 보내지 않아요.',
  accepted: '요청이 접수됐어요. 배달 확인 전이에요.',
  unknown: '발송 결과를 확인하지 못했어요. 자동으로 다시 보내지 않아요.',
  rejected: '발송이 거절됐어요. 사장님이 직접 안내해 주세요.',
  humanReview: '확인이 필요해요. 사장님이 직접 안내해 주세요.',
  invalidated: '예약이 바뀌어 이전 안내는 보내지 않았어요.',
  bookingReadError: '예약 정보를 확인하지 못했어요. 사장님이 직접 안내해 주세요.',
  consentReadError: '손님의 수신 근거를 확인하지 못했어요. 사장님이 직접 안내해 주세요.',
  noObservation: '아직 확인된 발송 결과가 없어요. 자동으로 다시 보내지 않아요.',
  observationMatched: '조회 결과가 일치해요. 그래도 배달 확인은 아니에요.',
  observationMismatched: '조회 결과가 안내 내용과 달라요. 사장님이 직접 확인해 주세요.',
  notReconcilable: '지금은 발송 결과를 조회할 수 있는 상태가 아니에요.',
  notFound: '안내 기록을 찾지 못했어요.',
} as const

export type PlanNoticeInput = Readonly<{
  ledger: TestNoticeJobLedger
  fact: BookingNoticeFact
  kind: NoticeKind
  leadMinutes?: number
  templateVersion: string
  recipientRef: string
  renderedBody: string
  consentGranted: boolean
  now: Date
}>

export type PlanNoticeRejected = Readonly<{
  kind: 'REJECTED'
  reason: string
  message: string
  datasetMode: 'TEST'
  actualVerified: false
  actualDeliveryCount: null
  actualCostKrw: null
}>

export type PlanNoticeResult =
  | Readonly<{
      kind: 'PLANNED' | 'REPLAY' | 'CONFLICT'
      job: NoticeJob
      datasetMode: 'TEST'
      actualVerified: false
    }>
  | PlanNoticeRejected

function rejected(reason: string, message: string): PlanNoticeRejected {
  return {
    kind: 'REJECTED',
    reason,
    message,
    datasetMode: 'TEST',
    actualVerified: false,
    actualDeliveryCount: null,
    actualCostKrw: null,
  }
}

/**
 * kind별 예약 상태·동의·본문·시간을 검증한 뒤 job을 계획한다.
 * 거부는 예외가 아니라 REJECTED 결과로 돌려주고, 아무 것도 저장하지 않는다.
 */
export function planNotice(input: PlanNoticeInput): PlanNoticeResult {
  const { ledger, fact, kind, templateVersion, recipientRef, renderedBody, consentGranted, now } = input

  if (fact?.datasetMode !== undefined && fact.datasetMode !== 'TEST') {
    return rejected('DATASET_MODE_NOT_TEST', MESSAGES.datasetNotTest)
  }

  if (kind === 'CANCELLATION') {
    if (fact.status !== 'CANCELLED') return rejected('BOOKING_NOT_CANCELLED', MESSAGES.bookingNotCancelled)
  } else if (fact.status !== 'CONFIRMED') {
    return rejected('BOOKING_NOT_CONFIRMED', MESSAGES.bookingNotConfirmed)
  }

  if (consentGranted !== true) {
    return rejected('CONSENT_NOT_GRANTED', MESSAGES.consentNotGranted)
  }

  const body = typeof renderedBody === 'string' ? renderedBody.trim() : ''
  if (body.length === 0) return rejected('BODY_EMPTY', MESSAGES.bodyEmpty)
  if (body.includes('{{')) return rejected('BODY_PLACEHOLDER_REMAINS', MESSAGES.bodyPlaceholder)

  const startsAtRaw = typeof fact.startsAt === 'string' ? fact.startsAt : ''
  const startsAtMs = Date.parse(startsAtRaw)
  if (!Number.isFinite(startsAtMs)) return rejected('STARTS_AT_INVALID', MESSAGES.startsAtInvalid)
  if (!OFFSET_ISO_PATTERN.test(startsAtRaw)) {
    return rejected('STARTS_AT_WITHOUT_OFFSET', MESSAGES.startsAtWithoutOffset)
  }

  const nowMs = now instanceof Date ? now.getTime() : Number.NaN
  if (!Number.isFinite(nowMs)) return rejected('NOW_INVALID', MESSAGES.nowInvalid)

  let scheduledAtMs: number
  let leadMinutes: number | null = null

  if (kind === 'REMINDER') {
    const requestedLead = input.leadMinutes
    if (
      typeof requestedLead !== 'number' ||
      !Number.isSafeInteger(requestedLead) ||
      requestedLead <= 0
    ) {
      return rejected('LEAD_MINUTES_INVALID', MESSAGES.leadMinutesInvalid)
    }
    if (startsAtMs <= nowMs) return rejected('VISIT_ALREADY_STARTED', MESSAGES.visitAlreadyStarted)
    leadMinutes = requestedLead
    scheduledAtMs = startsAtMs - requestedLead * 60_000
    if (scheduledAtMs <= nowMs) return rejected('PAST_DUE_REJECTED', MESSAGES.pastDue)
  } else {
    if (kind !== 'CANCELLATION' && startsAtMs <= nowMs) {
      return rejected('VISIT_ALREADY_STARTED', MESSAGES.visitAlreadyStarted)
    }
    scheduledAtMs = nowMs
  }

  const planned = ledger.plan({
    workspaceId: fact.workspaceId,
    bookingId: fact.bookingId,
    bookingVersion: fact.bookingVersion,
    kind,
    templateVersion,
    recipientRef,
    scheduledAt: new Date(scheduledAtMs).toISOString(),
    renderedBody: body,
    startsAt: new Date(startsAtMs).toISOString(),
    leadMinutes,
  })

  return {
    kind: planned.kind,
    job: planned.job,
    datasetMode: 'TEST',
    actualVerified: false,
  }
}

export type InvalidateNoticeInput = Readonly<{
  ledger: TestNoticeJobLedger
  workspaceId: string
  bookingId: string
  currentVersion: number
  currentStatus: BookingStatus
}>

export type InvalidateNoticeResult = Readonly<{
  invalidated: readonly string[]
  inFlightOrSent: readonly string[]
  message: string
}>

/** 예약 변경/취소 시 미전송 job을 무효화하고, 이미 요청된 job은 되돌릴 수 없음을 알린다. */
export function invalidateOnBookingChange(input: InvalidateNoticeInput): InvalidateNoticeResult {
  const result = input.ledger.invalidateForBooking({
    workspaceId: input.workspaceId,
    bookingId: input.bookingId,
    currentVersion: input.currentVersion,
    currentStatus: input.currentStatus,
    reason: 'BOOKING_CHANGED_BEFORE_DISPATCH',
  })

  const parts: string[] = []
  if (result.invalidated.length > 0) parts.push('예약이 바뀌어 이전 안내는 보내지 않았어요.')
  if (result.inFlightOrSent.length > 0) {
    parts.push('이미 요청이 접수된 안내가 있어 되돌릴 수 없어요. 손님에게 직접 확인해 주세요.')
  }
  if (parts.length === 0) parts.push('보내지 않은 안내가 없어요.')

  return {
    invalidated: result.invalidated,
    inFlightOrSent: result.inFlightOrSent,
    message: parts.join(' '),
  }
}

export type NoticeJobOutcome = 'ACCEPTED' | 'UNKNOWN' | 'REJECTED' | 'INVALIDATED' | 'HUMAN_REVIEW'

export type RunDueNoticeJobResult = Readonly<{
  jobId: string
  bookingId: string
  kind: NoticeKind
  outcome: NoticeJobOutcome
  status: NoticeJobStatus | 'NOT_FOUND'
  reason: string | null
  manualAlternative: string | null
  message: string
  datasetMode: 'TEST'
  actualVerified: false
  actualDeliveryCount: null
  actualCostKrw: null
}>

export type RunDueNoticeResult = Readonly<{
  datasetMode: 'TEST'
  actualVerified: false
  /** transport에 실제 요청이 도달한 횟수(admission 거부는 0). */
  attempted: number
  jobs: readonly RunDueNoticeJobResult[]
}>

export type RunDueNoticeInput = Readonly<{
  ledger: TestNoticeJobLedger
  transport: TestTransport
  context: Context
  readBooking: ReadBooking
  readConsent: ReadConsent
  workspaceId: string
  now: Date
}>

function statusMatchesKind(kind: NoticeKind, status: BookingStatus): boolean {
  return kind === 'CANCELLATION' ? status === 'CANCELLED' : status === 'CONFIRMED'
}

/**
 * 최신 예약 사실로 다시 계산한 scheduledAt. null이면 job과 불일치(변경)다.
 * 같은 version이라도 방문 시각이 바뀌었으면 불일치로 본다.
 */
function expectedScheduledAtFor(job: NoticeJob, fact: BookingNoticeFact): number | null {
  const startsAtRaw = typeof fact.startsAt === 'string' ? fact.startsAt : ''
  if (!OFFSET_ISO_PATTERN.test(startsAtRaw)) return null
  const startsAtMs = Date.parse(startsAtRaw)
  if (!Number.isFinite(startsAtMs)) return null
  if (startsAtMs !== Date.parse(job.startsAt)) return null
  if (job.kind === 'REMINDER') {
    if (job.leadMinutes === null) return null
    return startsAtMs - job.leadMinutes * 60_000
  }
  return Date.parse(job.scheduledAt)
}

function makeJobResult(
  job: NoticeJob,
  outcome: NoticeJobOutcome,
  status: NoticeJobStatus | 'NOT_FOUND',
  reason: string | null,
  manualAlternative: string | null,
  message: string
): RunDueNoticeJobResult {
  return {
    jobId: job.jobId,
    bookingId: job.bookingId,
    kind: job.kind,
    outcome,
    status,
    reason,
    manualAlternative,
    message,
    datasetMode: 'TEST',
    actualVerified: false,
    actualDeliveryCount: null,
    actualCostKrw: null,
  }
}

/**
 * workspace의 due job을 순서대로 처리한다.
 * claim(CAS) → 최신 예약 → 동의 → write-ahead → TEST transport 순이며,
 * 어떤 단계에서든 불확실하면 전송하지 않고 HUMAN_REVIEW/INVALIDATED로 남긴다.
 * 두 번(또는 동시에) 호출해도 같은 job의 transport 요청은 최대 1회다.
 */
export async function runDueNotices(input: RunDueNoticeInput): Promise<RunDueNoticeResult> {
  const { ledger, transport, context, readBooking, readConsent, workspaceId } = input
  const now = input.now
  const nowMs = now.getTime()
  const jobs: RunDueNoticeJobResult[] = []
  let attempted = 0

  const statusOf = (job: NoticeJob): NoticeJobStatus => ledger.get(workspaceId, job.jobId)?.status ?? job.status

  for (const due of ledger.listDue(workspaceId, now)) {
    // 1. 원자적 claim. 이미 CLAIMED/전송됨/무효면 건너뛴다.
    const claim = ledger.claim(workspaceId, due.jobId, now)
    if (claim.kind !== 'CLAIMED') continue
    const job = claim.job

    // 2. claim 직전 최신 예약 재조회. 오류를 빈 결과로 숨기지 않는다.
    const booking = await readBooking({ workspaceId, bookingId: job.bookingId })
    if (!booking.ok) {
      ledger.markHumanReview(workspaceId, job.jobId, `BOOKING_READ_ERROR:${booking.error}`)
      jobs.push(
        makeJobResult(
          job,
          'HUMAN_REVIEW',
          statusOf(job),
          `BOOKING_READ_ERROR:${booking.error}`,
          null,
          MESSAGES.bookingReadError
        )
      )
      continue
    }

    const fact = booking.fact
    if (fact.workspaceId !== workspaceId || fact.bookingId !== job.bookingId) {
      ledger.markHumanReview(workspaceId, job.jobId, 'BOOKING_SCOPE_MISMATCH')
      jobs.push(
        makeJobResult(job, 'HUMAN_REVIEW', statusOf(job), 'BOOKING_SCOPE_MISMATCH', null, MESSAGES.humanReview)
      )
      continue
    }

    if (fact.datasetMode !== undefined && fact.datasetMode !== 'TEST') {
      ledger.markHumanReview(workspaceId, job.jobId, 'DATASET_MODE_NOT_TEST')
      jobs.push(
        makeJobResult(job, 'HUMAN_REVIEW', statusOf(job), 'DATASET_MODE_NOT_TEST', null, MESSAGES.humanReview)
      )
      continue
    }

    // 3. version/상태/방문 시각이 계획과 같은지 확인. 다르면 전송 0.
    const expectedScheduledAt = expectedScheduledAtFor(job, fact)
    const matchesPlan =
      fact.bookingVersion === job.bookingVersion &&
      statusMatchesKind(job.kind, fact.status) &&
      expectedScheduledAt !== null &&
      expectedScheduledAt === Date.parse(job.scheduledAt)

    if (!matchesPlan) {
      ledger.invalidateForBooking({
        workspaceId,
        bookingId: job.bookingId,
        currentVersion: fact.bookingVersion,
        currentStatus: fact.status,
        reason: 'BOOKING_CHANGED_BEFORE_DISPATCH',
      })
      if (statusOf(job) === 'CLAIMED') {
        ledger.invalidateJob(workspaceId, job.jobId, 'BOOKING_CHANGED_BEFORE_DISPATCH')
      }
      jobs.push(
        makeJobResult(
          job,
          'INVALIDATED',
          statusOf(job),
          'BOOKING_CHANGED_BEFORE_DISPATCH',
          null,
          MESSAGES.invalidated
        )
      )
      continue
    }

    // 방문 시각이 지난 리마인더는 과거 catch-up하지 않는다.
    if (job.kind === 'REMINDER' && nowMs > Date.parse(job.startsAt)) {
      ledger.invalidateJob(workspaceId, job.jobId, 'VISIT_ALREADY_STARTED')
      jobs.push(
        makeJobResult(job, 'INVALIDATED', statusOf(job), 'VISIT_ALREADY_STARTED', null, MESSAGES.visitAlreadyStarted)
      )
      continue
    }

    // 4. INFO 목적 수신 근거 재확인. 철회는 무효화, 조회 오류는 사람 확인.
    const consent = await readConsent({ workspaceId, customerId: fact.customerId, purpose: 'INFO' })
    if (!consent.ok) {
      ledger.markHumanReview(workspaceId, job.jobId, `CONSENT_READ_ERROR:${consent.error}`)
      jobs.push(
        makeJobResult(
          job,
          'HUMAN_REVIEW',
          statusOf(job),
          `CONSENT_READ_ERROR:${consent.error}`,
          null,
          MESSAGES.consentReadError
        )
      )
      continue
    }
    if (consent.granted !== true) {
      ledger.invalidateJob(workspaceId, job.jobId, 'CONSENT_WITHDRAWN')
      jobs.push(makeJobResult(job, 'INVALIDATED', statusOf(job), 'CONSENT_WITHDRAWN', null, MESSAGES.invalidated))
      continue
    }

    // 5. 요청 전 write-ahead. 같은 키/같은 지문이면 재기록해도 요청은 1회다.
    const operationKey = noticeJobKeyString(job)
    const writeAhead = ledger.writeAhead(workspaceId, job.jobId, operationKey, job.payloadFingerprint)
    if (writeAhead.kind !== 'TRANSITIONED' && writeAhead.kind !== 'IDEMPOTENT') {
      ledger.markHumanReview(workspaceId, job.jobId, 'WRITE_AHEAD_CONFLICT')
      jobs.push(
        makeJobResult(job, 'HUMAN_REVIEW', statusOf(job), 'WRITE_AHEAD_CONFLICT', null, MESSAGES.humanReview)
      )
      continue
    }

    // 6. TEST transport. admission 거부는 전송 0이며 PLANNED로 되돌리지 않는다.
    const submit = await transport.submit(context, {
      scope: { workspaceId, provider: 'kakao', action: 'message', operationKey },
      payload: new TextEncoder().encode(job.renderedBody),
    })

    if (submit.kind === 'DENIED') {
      ledger.markHumanReview(workspaceId, job.jobId, submit.reason)
      jobs.push(
        makeJobResult(
          job,
          'HUMAN_REVIEW',
          statusOf(job),
          submit.reason,
          submit.manualAlternative,
          submit.manualAlternative ?? MESSAGES.humanReview
        )
      )
      continue
    }

    attempted += 1

    switch (submit.status) {
      case 'TEST_ACCEPTED':
        ledger.markRequestAccepted(workspaceId, job.jobId)
        jobs.push(makeJobResult(job, 'ACCEPTED', statusOf(job), null, null, MESSAGES.accepted))
        break
      case 'TEST_UNKNOWN':
      case 'TEST_IN_FLIGHT':
        ledger.markUnknown(workspaceId, job.jobId, 'TEST_RESULT_UNKNOWN')
        jobs.push(makeJobResult(job, 'UNKNOWN', statusOf(job), 'TEST_RESULT_UNKNOWN', null, MESSAGES.unknown))
        break
      case 'TEST_REJECTED':
        ledger.markRejected(workspaceId, job.jobId, 'TEST_REJECTED')
        jobs.push(makeJobResult(job, 'REJECTED', statusOf(job), 'TEST_REJECTED', null, MESSAGES.rejected))
        break
      case 'TEST_CONFLICT':
      default:
        ledger.markHumanReview(workspaceId, job.jobId, `TRANSPORT_${submit.status}`)
        jobs.push(
          makeJobResult(job, 'HUMAN_REVIEW', statusOf(job), `TRANSPORT_${submit.status}`, null, MESSAGES.humanReview)
        )
        break
    }
  }

  return { datasetMode: 'TEST', actualVerified: false, attempted, jobs }
}

export type NoticeObservationReading = Readonly<{
  observationRef: string
  requestFingerprint: string
  observedAt: string
}>

export type ReadNoticeObservation = (
  query: Readonly<{ workspaceId: string; operationKey: string }>
) => Promise<NoticeObservationReading | null>

export type ReconcileNoticeInput = Readonly<{
  ledger: TestNoticeJobLedger
  workspaceId: string
  jobId: string
  readObservation: ReadNoticeObservation
}>

export type ReconcileNoticeResult = Readonly<{
  kind: 'RECONCILED' | 'NOT_RECONCILABLE'
  matches: boolean
  resolution: 'UNKNOWN' | 'HUMAN_REVIEW' | 'NONE'
  jobStatus: NoticeJobStatus | 'NOT_FOUND'
  observationRef: string | null
  datasetMode: 'TEST'
  actualVerified: false
  actualDeliveryCount: null
  actualCostKrw: null
  message: string
}>

/**
 * 발송 결과 대사. transport 요청(submit)은 절대 하지 않고 주입된 조회만 쓴다.
 * UNKNOWN job은 UNKNOWN으로 유지하며, 관측이 job과 일치해도 '배달 확인' 상태를 만들지 않는다.
 */
export async function reconcileNotice(input: ReconcileNoticeInput): Promise<ReconcileNoticeResult> {
  const { ledger, workspaceId, jobId, readObservation } = input
  const job = ledger.get(workspaceId, jobId)

  const base = {
    datasetMode: 'TEST' as const,
    actualVerified: false as const,
    actualDeliveryCount: null,
    actualCostKrw: null,
  }

  if (job === undefined) {
    return {
      ...base,
      kind: 'NOT_RECONCILABLE',
      matches: false,
      resolution: 'NONE',
      jobStatus: 'NOT_FOUND',
      observationRef: null,
      message: MESSAGES.notFound,
    }
  }

  if (job.status !== 'UNKNOWN' && job.status !== 'REQUEST_ACCEPTED') {
    return {
      ...base,
      kind: 'NOT_RECONCILABLE',
      matches: false,
      resolution: 'NONE',
      jobStatus: job.status,
      observationRef: null,
      message: MESSAGES.notReconcilable,
    }
  }

  const operationKey = noticeJobKeyString(job)
  const reading = await readObservation({ workspaceId, operationKey })

  if (reading === null) {
    return {
      ...base,
      kind: 'RECONCILED',
      matches: false,
      resolution: 'UNKNOWN',
      jobStatus: job.status,
      observationRef: null,
      message: MESSAGES.noObservation,
    }
  }

  const expected = computeRequestFingerprint(
    { workspaceId, provider: 'kakao', action: 'message', operationKey },
    new TextEncoder().encode(job.renderedBody)
  )
  const matches = reading.requestFingerprint === expected

  return {
    ...base,
    kind: 'RECONCILED',
    matches,
    resolution: matches ? 'UNKNOWN' : 'HUMAN_REVIEW',
    jobStatus: job.status,
    observationRef: reading.observationRef,
    message: matches ? MESSAGES.observationMatched : MESSAGES.observationMismatched,
  }
}
