/**
 * TEST 전용 안내 job 원장 · ANI-1620
 *
 * 인메모리 단일 스레드 원장이다. 운영 queue/outbox/DB SSOT가 아니며,
 * 배달 확인 상태(DELIVERED_VERIFIED 등)를 만들지 않는다. REQUEST_ACCEPTED는
 * "공급자가 요청을 접수했다"일 뿐 배달 완료가 아니다.
 *
 * 불변 키(JSON tuple):
 *   [workspaceId, bookingId, bookingVersion, kind, templateVersion, recipientRefHash, scheduledAtISO]
 * payloadFingerprint: sha256(renderedBody bytes + 위 tuple) — 길이 prefix로 구분을 명확히 한다.
 * 수신자 원문(recipientRef)은 저장하지 않고 sha256 해시만 남긴다.
 */

import { createHash } from 'node:crypto'

export type NoticeKind = 'CONFIRMATION' | 'REMINDER' | 'CHANGE' | 'CANCELLATION'

/**
 * REQUEST_ACCEPTED는 요청 접수, UNKNOWN은 결과 불명(자동 재전송 금지)이다.
 * 배달 확인 상태는 의도적으로 존재하지 않는다.
 */
export type NoticeJobStatus =
  | 'PLANNED'
  | 'CLAIMED'
  | 'REQUEST_ACCEPTED'
  | 'UNKNOWN'
  | 'INVALIDATED'
  | 'HUMAN_REVIEW'
  | 'REJECTED'

export type NoticeJob = Readonly<{
  jobId: string
  workspaceId: string
  bookingId: string
  bookingVersion: number
  kind: NoticeKind
  templateVersion: string
  recipientRefHash: string
  scheduledAt: string
  payloadFingerprint: string
  renderedBody: string
  startsAt: string
  leadMinutes: number | null
  status: NoticeJobStatus
  claimGeneration: number
  writeAhead: Readonly<{ operationKey: string; payloadFingerprint: string }> | null
  reason: string | null
}>

export type NoticeJobPlanInput = Readonly<{
  workspaceId: string
  bookingId: string
  bookingVersion: number
  kind: NoticeKind
  templateVersion: string
  recipientRef: string
  scheduledAt: string
  renderedBody: string
  startsAt: string
  leadMinutes?: number | null
}>

export type NoticeJobPlanResult =
  | Readonly<{ kind: 'PLANNED'; job: NoticeJob }>
  | Readonly<{ kind: 'REPLAY'; job: NoticeJob }>
  | Readonly<{ kind: 'CONFLICT'; job: NoticeJob }>

export type NoticeJobClaimResult =
  | Readonly<{ kind: 'CLAIMED'; job: NoticeJob }>
  | Readonly<{ kind: 'NOT_CLAIMABLE'; status: NoticeJobStatus | 'NOT_FOUND' }>

export type NoticeJobTransitionResult =
  | Readonly<{ kind: 'TRANSITIONED'; job: NoticeJob }>
  | Readonly<{ kind: 'IDEMPOTENT'; job: NoticeJob }>
  | Readonly<{ kind: 'CONFLICT'; job: NoticeJob }>
  | Readonly<{ kind: 'INVALID_TRANSITION'; status: NoticeJobStatus | 'NOT_FOUND' }>

export type NoticeJobInvalidateResult = Readonly<{
  invalidated: readonly string[]
  inFlightOrSent: readonly string[]
}>

export type NoticeJobInvalidateJobResult =
  | Readonly<{ kind: 'INVALIDATED'; job: NoticeJob }>
  | Readonly<{ kind: 'NOT_APPLICABLE'; status: NoticeJobStatus | 'NOT_FOUND' }>

type InternalNoticeJob = {
  jobId: string
  workspaceId: string
  bookingId: string
  bookingVersion: number
  kind: NoticeKind
  templateVersion: string
  recipientRefHash: string
  scheduledAt: string
  payloadFingerprint: string
  renderedBody: string
  startsAt: string
  leadMinutes: number | null
  status: NoticeJobStatus
  claimGeneration: number
  writeAhead: { operationKey: string; payloadFingerprint: string } | null
  reason: string | null
}

const NOTICE_KINDS: readonly NoticeKind[] = ['CONFIRMATION', 'REMINDER', 'CHANGE', 'CANCELLATION']

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function requireRef(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`NOTICE_JOB_INVALID:${field}`)
  }
  return value
}

function requireVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('NOTICE_JOB_INVALID:bookingVersion')
  }
  return value
}

function requireInstant(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`NOTICE_JOB_INVALID:${field}`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`NOTICE_JOB_INVALID:${field}`)
  return new Date(parsed).toISOString()
}

function requireNow(now: unknown): number {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('NOTICE_JOB_INVALID:now')
  }
  return now.getTime()
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

function copyJob(job: InternalNoticeJob): NoticeJob {
  return deepFreeze({
    jobId: job.jobId,
    workspaceId: job.workspaceId,
    bookingId: job.bookingId,
    bookingVersion: job.bookingVersion,
    kind: job.kind,
    templateVersion: job.templateVersion,
    recipientRefHash: job.recipientRefHash,
    scheduledAt: job.scheduledAt,
    payloadFingerprint: job.payloadFingerprint,
    renderedBody: job.renderedBody,
    startsAt: job.startsAt,
    leadMinutes: job.leadMinutes,
    status: job.status,
    claimGeneration: job.claimGeneration,
    writeAhead: job.writeAhead ? { ...job.writeAhead } : null,
    reason: job.reason,
  })
}

/** 수신자 원문 대신 저장하는 sha256 해시. 원문은 어떤 필드에도 남기지 않는다. */
export function hashRecipientRef(recipientRef: string): string {
  const raw = requireRef(recipientRef, 'recipientRef')
  return `sha256:${sha256Hex(raw)}`
}

/**
 * payloadFingerprint = sha256(renderedBody + key tuple).
 * 길이 prefix(4 bytes BE)를 붙여 본문과 tuple 경계를 모호하지 않게 한다.
 */
export function computeNoticePayloadFingerprint(
  renderedBody: string,
  keyTuple: readonly (string | number)[]
): string {
  const bodyBytes = Buffer.from(renderedBody, 'utf8')
  const tupleBytes = Buffer.from(JSON.stringify(keyTuple), 'utf8')
  const hash = createHash('sha256')
  const lengthPrefix = Buffer.alloc(4)
  lengthPrefix.writeUInt32BE(bodyBytes.length, 0)
  hash.update(lengthPrefix)
  hash.update(bodyBytes)
  lengthPrefix.writeUInt32BE(tupleBytes.length, 0)
  hash.update(lengthPrefix)
  hash.update(tupleBytes)
  return `sha256:${hash.digest('hex')}`
}

/** job의 불변 키 문자열. transport operationKey로 그대로 쓴다. */
export function noticeJobKeyString(job: NoticeJob): string {
  return JSON.stringify([
    job.workspaceId,
    job.bookingId,
    job.bookingVersion,
    job.kind,
    job.templateVersion,
    job.recipientRefHash,
    job.scheduledAt,
  ])
}

export class TestNoticeJobLedger {
  private readonly jobsByWorkspace = new Map<string, Map<string, InternalNoticeJob>>()
  private readonly keyIndex = new Map<string, Map<string, string>>()

  plan(input: NoticeJobPlanInput): NoticeJobPlanResult {
    const workspaceId = requireRef(input?.workspaceId, 'workspaceId')
    const bookingId = requireRef(input?.bookingId, 'bookingId')
    const bookingVersion = requireVersion(input?.bookingVersion)
    if (!NOTICE_KINDS.includes(input?.kind)) throw new Error('NOTICE_JOB_INVALID:kind')
    const kind = input.kind
    const templateVersion = requireRef(input?.templateVersion, 'templateVersion')
    const recipientRefHash = hashRecipientRef(input?.recipientRef)
    const scheduledAt = requireInstant(input?.scheduledAt, 'scheduledAt')
    const startsAt = requireInstant(input?.startsAt, 'startsAt')
    const renderedBody = requireRef(input?.renderedBody, 'renderedBody')
    const leadMinutes = input.leadMinutes ?? null
    if (leadMinutes !== null && (typeof leadMinutes !== 'number' || !Number.isSafeInteger(leadMinutes))) {
      throw new Error('NOTICE_JOB_INVALID:leadMinutes')
    }

    const keyTuple = [
      workspaceId,
      bookingId,
      bookingVersion,
      kind,
      templateVersion,
      recipientRefHash,
      scheduledAt,
    ] as const
    const key = JSON.stringify(keyTuple)
    const payloadFingerprint = computeNoticePayloadFingerprint(renderedBody, keyTuple)

    const jobs = this.jobsFor(workspaceId)
    const keys = this.keysFor(workspaceId)
    const existingId = keys.get(key)
    if (existingId !== undefined) {
      const existing = jobs.get(existingId)
      if (existing === undefined) throw new Error('NOTICE_JOB_INDEX_CORRUPT')
      return existing.payloadFingerprint === payloadFingerprint
        ? { kind: 'REPLAY', job: copyJob(existing) }
        : { kind: 'CONFLICT', job: copyJob(existing) }
    }

    const job: InternalNoticeJob = {
      jobId: `notice-job:${sha256Hex(key)}`,
      workspaceId,
      bookingId,
      bookingVersion,
      kind,
      templateVersion,
      recipientRefHash,
      scheduledAt,
      payloadFingerprint,
      renderedBody,
      startsAt,
      leadMinutes,
      status: 'PLANNED',
      claimGeneration: 0,
      writeAhead: null,
      reason: null,
    }
    jobs.set(job.jobId, job)
    keys.set(key, job.jobId)
    return { kind: 'PLANNED', job: copyJob(job) }
  }

  /** PLANNED + due일 때만 원자적으로 CLAIMED로 바꾼다. 두 번 호출해도 한 번만 성공한다. */
  claim(workspaceId: string, jobId: string, now: Date): NoticeJobClaimResult {
    const nowMs = requireNow(now)
    const job = this.jobsFor(workspaceId).get(jobId)
    if (job === undefined) return { kind: 'NOT_CLAIMABLE', status: 'NOT_FOUND' }
    if (job.status !== 'PLANNED') return { kind: 'NOT_CLAIMABLE', status: job.status }
    if (Date.parse(job.scheduledAt) > nowMs) return { kind: 'NOT_CLAIMABLE', status: 'PLANNED' }
    job.status = 'CLAIMED'
    job.claimGeneration += 1
    return { kind: 'CLAIMED', job: copyJob(job) }
  }

  /**
   * 예약 변경/취소 시 미전송 job만 무효화한다.
   * 이미 공급자에 요청된 REQUEST_ACCEPTED/UNKNOWN은 DB에서 취소할 수 없으므로 건드리지 않고
   * inFlightOrSent로 알린다. CANCELLATION job은 최신 CANCELLED version일 때만 유지한다.
   */
  invalidateForBooking(input: {
    workspaceId: string
    bookingId: string
    currentVersion: number
    currentStatus: string
    reason: string
  }): NoticeJobInvalidateResult {
    const invalidated: string[] = []
    const inFlightOrSent: string[] = []

    for (const job of this.jobsFor(input.workspaceId).values()) {
      if (job.bookingId !== input.bookingId) continue
      if (job.status === 'REQUEST_ACCEPTED' || job.status === 'UNKNOWN') {
        inFlightOrSent.push(job.jobId)
        continue
      }
      if (job.status !== 'PLANNED' && job.status !== 'CLAIMED') continue

      const keep =
        job.kind === 'CANCELLATION'
          ? input.currentStatus === 'CANCELLED' && job.bookingVersion === input.currentVersion
          : !(job.bookingVersion < input.currentVersion || input.currentStatus !== 'CONFIRMED')

      if (!keep) {
        job.status = 'INVALIDATED'
        job.reason = input.reason
        invalidated.push(job.jobId)
      }
    }

    return { invalidated, inFlightOrSent }
  }

  /** 단일 job 무효화(예: 같은 version에서 방문 시각만 바뀐 불일치). */
  invalidateJob(workspaceId: string, jobId: string, reason: string): NoticeJobInvalidateJobResult {
    const job = this.jobsFor(workspaceId).get(jobId)
    if (job === undefined) return { kind: 'NOT_APPLICABLE', status: 'NOT_FOUND' }
    if (job.status !== 'PLANNED' && job.status !== 'CLAIMED') {
      return { kind: 'NOT_APPLICABLE', status: job.status }
    }
    job.status = 'INVALIDATED'
    job.reason = reason
    return { kind: 'INVALIDATED', job: copyJob(job) }
  }

  markRequestAccepted(workspaceId: string, jobId: string): NoticeJobTransitionResult {
    return this.transition(workspaceId, jobId, 'REQUEST_ACCEPTED', null)
  }

  markUnknown(workspaceId: string, jobId: string, reason: string | null = null): NoticeJobTransitionResult {
    return this.transition(workspaceId, jobId, 'UNKNOWN', reason)
  }

  markHumanReview(workspaceId: string, jobId: string, reason: string | null = null): NoticeJobTransitionResult {
    return this.transition(workspaceId, jobId, 'HUMAN_REVIEW', reason)
  }

  markRejected(workspaceId: string, jobId: string, reason: string | null = null): NoticeJobTransitionResult {
    return this.transition(workspaceId, jobId, 'REJECTED', reason)
  }

  /** 요청 직전 write-ahead 기록. 같은 값 재기록은 IDEMPOTENT, 다른 값은 CONFLICT다. */
  writeAhead(
    workspaceId: string,
    jobId: string,
    operationKey: string,
    payloadFingerprint: string
  ): NoticeJobTransitionResult {
    const job = this.jobsFor(workspaceId).get(jobId)
    if (job === undefined) return { kind: 'INVALID_TRANSITION', status: 'NOT_FOUND' }
    if (job.status !== 'CLAIMED') return { kind: 'INVALID_TRANSITION', status: job.status }
    if (job.writeAhead !== null) {
      return job.writeAhead.operationKey === operationKey &&
        job.writeAhead.payloadFingerprint === payloadFingerprint
        ? { kind: 'IDEMPOTENT', job: copyJob(job) }
        : { kind: 'CONFLICT', job: copyJob(job) }
    }
    job.writeAhead = { operationKey, payloadFingerprint }
    return { kind: 'TRANSITIONED', job: copyJob(job) }
  }

  listDue(workspaceId: string, now: Date): readonly NoticeJob[] {
    const nowMs = requireNow(now)
    return [...this.jobsFor(workspaceId).values()]
      .filter((job) => job.status === 'PLANNED' && Date.parse(job.scheduledAt) <= nowMs)
      .sort((left, right) => {
        const diff = Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt)
        return diff !== 0 ? diff : left.jobId.localeCompare(right.jobId)
      })
      .map((job) => copyJob(job))
  }

  get(workspaceId: string, jobId: string): NoticeJob | undefined {
    const job = this.jobsFor(workspaceId).get(jobId)
    return job === undefined ? undefined : copyJob(job)
  }

  list(workspaceId: string, bookingId: string): readonly NoticeJob[] {
    return [...this.jobsFor(workspaceId).values()]
      .filter((job) => job.bookingId === bookingId)
      .sort((left, right) => {
        const diff = Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt)
        return diff !== 0 ? diff : left.jobId.localeCompare(right.jobId)
      })
      .map((job) => copyJob(job))
  }

  private transition(
    workspaceId: string,
    jobId: string,
    next: NoticeJobStatus,
    reason: string | null
  ): NoticeJobTransitionResult {
    const job = this.jobsFor(workspaceId).get(jobId)
    if (job === undefined) return { kind: 'INVALID_TRANSITION', status: 'NOT_FOUND' }
    if (job.status !== 'CLAIMED') return { kind: 'INVALID_TRANSITION', status: job.status }
    job.status = next
    job.reason = reason
    return { kind: 'TRANSITIONED', job: copyJob(job) }
  }

  private jobsFor(workspaceId: string): Map<string, InternalNoticeJob> {
    let jobs = this.jobsByWorkspace.get(workspaceId)
    if (jobs === undefined) {
      jobs = new Map()
      this.jobsByWorkspace.set(workspaceId, jobs)
    }
    return jobs
  }

  private keysFor(workspaceId: string): Map<string, string> {
    let keys = this.keyIndex.get(workspaceId)
    if (keys === undefined) {
      keys = new Map()
      this.keyIndex.set(workspaceId, keys)
    }
    return keys
  }
}
