/**
 * 운영 예약 알림톡 Outbox 처리기 순수 주입 포트 (Pure Injected Outbox Processor)
 *
 * [현실적 한계 및 분산 환경 레이스 컨디션 고지]
 * 1. 2차 Double-Read 및 사전 검증과 실제 외부 발송(send) 호출 사이에 발생하는 예약 상태 변경/취소
 *    레이스 컨디션은 분산 아키텍처 특성상 소프트웨어 메모리 단독으로는 완전히 제거할 수 없습니다.
 * 2. 본 모듈은 원자적 CAS(markSending), 직전 버전 및 동의/승인 재검증, 선점 리스 토큰, 엄격한 상태 전이를 통해
 *    안전 방어선을 제공하나, 분산 환경의 근본적 경합 가능성은 잔존합니다.
 * 3. 이 모듈만으로 운영 연동이 완료되었다고 주장할 수 없으며, 실제 운영 환경에서는 영속 저장소 마이그레이션,
 *    솔라피 공식 템플릿 심사 완료, DLR 웹훅 원장 대조 체계가 완비되어야 합니다.
 * 4. 보안 철칙: 에러/로그/반환 결과에 고객 전화번호, 이름, 페이로드 본문, 시크릿 키 노출을 영구 차단합니다.
 */

import type { OutboxAllowlist } from './allowlist'

export type NotificationEvent =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CHANGED'
  | 'BOOKING_CANCELLED'
  | 'REMINDER_24H'
  | 'REMINDER_2H'
  | 'PAYMENT_CONFIRMED'

export interface Job {
  id: string
  workspaceId: string
  reservationId: string
  reservationUpdatedAt: string | Date
  event: NotificationEvent
  dueAt: string | Date
}

export interface ReservationSnapshot {
  workspaceId: string
  reservationId: string
  version: string | Date
  status: string
  customerId: string
  phone: string
  payload?: Record<string, unknown>
}

export interface InformationalEvidence {
  granted: boolean
  subjectPhone: string
  workspaceId: string
  reservationId: string
}

export interface TemplateApproval {
  approved: boolean
  templateId: string
}

export type OutboxState = 'BLOCKED' | 'SUPERSEDED' | 'SENT' | 'UNKNOWN'

export interface RepositoryPort {
  getCurrentReservation(
    workspaceId: string,
    reservationId: string,
    event?: NotificationEvent,
  ): Promise<ReservationSnapshot | null>
  getInformationalEvidence(
    snapshot: ReservationSnapshot,
  ): Promise<InformationalEvidence | null>
  getTemplateApproval(
    event: NotificationEvent,
  ): Promise<TemplateApproval | null>
}

export interface StorePort {
  claim(jobId: string): Promise<string | null>
  markSending(jobId: string, token: string): Promise<boolean>
  finish(
    jobId: string,
    token: string,
    state: OutboxState,
    reasonCode: string,
  ): Promise<boolean>
}

export type SendFn = (
  snapshot: ReservationSnapshot,
  job: Job,
  templateId: string,
) => Promise<{ accepted: boolean; notSent?: boolean; failureCode?: string }>

export interface OutboxProcessorDeps {
  enabled: boolean
  now: Date | (() => Date)
  repository: RepositoryPort
  store: StorePort
  send: SendFn
  allowlist?: OutboxAllowlist | ((normalizedPhone: string) => boolean)
}

export const OUTBOX_REASON = {
  DISABLED: 'DISABLED',
  NOT_DUE: 'NOT_DUE',
  INVALID_SCHEDULE: 'INVALID_SCHEDULE',
  INVALID_VERSION: 'INVALID_VERSION',
  CLAIM_FAILED: 'CLAIM_FAILED',
  READ_FAILED: 'READ_FAILED',
  RESERVATION_NOT_FOUND: 'RESERVATION_NOT_FOUND',
  WORKSPACE_MISMATCH: 'WORKSPACE_MISMATCH',
  RESERVATION_MISMATCH: 'RESERVATION_MISMATCH',
  STALE_RESERVATION: 'STALE_RESERVATION',
  STATUS_MISMATCH: 'STATUS_MISMATCH',
  INVALID_PHONE: 'INVALID_PHONE',
  NOT_ALLOWLISTED: 'NOT_ALLOWLISTED',
  EVIDENCE_MISSING: 'EVIDENCE_MISSING',
  EVIDENCE_NOT_GRANTED: 'EVIDENCE_NOT_GRANTED',
  EVIDENCE_PHONE_MISMATCH: 'EVIDENCE_PHONE_MISMATCH',
  EVIDENCE_WORKSPACE_MISMATCH: 'EVIDENCE_WORKSPACE_MISMATCH',
  EVIDENCE_RESERVATION_MISMATCH: 'EVIDENCE_RESERVATION_MISMATCH',
  TEMPLATE_NOT_APPROVED: 'TEMPLATE_NOT_APPROVED',
  TEMPLATE_ID_BLANK: 'TEMPLATE_ID_BLANK',
  CHANGED_BEFORE_SEND: 'CHANGED_BEFORE_SEND',
  STATUS_CHANGED_BEFORE_SEND: 'STATUS_CHANGED_BEFORE_SEND',
  RESERVATION_DISAPPEARED: 'RESERVATION_DISAPPEARED',
  CAS_LOSS: 'CAS_LOSS',
  SEND_PRECHECK_FAILED: 'SEND_PRECHECK_FAILED',
  SEND_EXCEPTION: 'SEND_EXCEPTION',
  SEND_REJECTED: 'SEND_REJECTED',
  POST_SEND_RECORD_FAILED: 'POST_SEND_RECORD_FAILED',
  SENT_SUCCESS: 'SENT_SUCCESS',
} as const

export type OutboxReasonCode =
  | (typeof OUTBOX_REASON)[keyof typeof OUTBOX_REASON]
  | `SEND_REJECTED_${string}`

export type ProcessOutcomeStatus =
  | 'DISABLED'
  | 'NOT_DUE'
  | 'CLAIM_FAILED'
  | 'BLOCKED'
  | 'SUPERSEDED'
  | 'CAS_LOST'
  | 'UNKNOWN'
  | 'SENT'

export interface ProcessOutcome {
  status: ProcessOutcomeStatus
  reasonCode: OutboxReasonCode
  leaseToken?: string
  finishRecorded?: boolean
}

/**
 * 전화번호 010 정규화 (국내 010 및 +82 10 지원, 11자리 고정 반환)
 * 악성 문자 또는 허용되지 않은 구분자가 포함된 경우 null 반환 (임의 비숫자 무차별 삭제 금지)
 */
export function normalize010Phone(phone: string): string | null {
  if (!phone || typeof phone !== 'string') return null
  const trimmed = phone.trim()
  if (!trimmed) return null

  // 오직 숫자, 공백, 하이픈, 그리고 맨 앞의 '+' 만 허용
  if (!/^\+?[\d\s-]+$/.test(trimmed)) {
    return null
  }

  // '+' 기호는 오직 맨 처음에만 허용
  if (trimmed.includes('+') && !trimmed.startsWith('+')) {
    return null
  }

  const cleaned = trimmed.replace(/[\s-]/g, '')

  if (cleaned.startsWith('+82')) {
    const national = cleaned.slice(3)
    if (national.startsWith('10') && national.length === 10 && /^\d+$/.test(national)) {
      return `010${national.slice(2)}`
    }
    if (national.startsWith('010') && national.length === 11 && /^\d+$/.test(national)) {
      return national
    }
    return null
  }

  if (cleaned.startsWith('+')) {
    return null
  }

  if (/^010\d{8}$/.test(cleaned)) {
    return cleaned
  }

  return null
}

const ISO_CALENDAR_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2})(?::?(\d{2}))?)$/

/**
 * 타임스탬프 유효성, 타임존 오프셋 및 달력 날짜 rollover 엄격 검증
 */
function parseTimestamp(v: string | Date): { valid: true; date: Date } | { valid: false } {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { valid: false }
    return { valid: true, date: v }
  }

  if (typeof v === 'string') {
    const trimmed = v.trim()
    const match = trimmed.match(ISO_CALENDAR_REGEX)
    if (!match) {
      return { valid: false }
    }

    const year = parseInt(match[1], 10)
    const month = parseInt(match[2], 10)
    const day = parseInt(match[3], 10)
    const hour = parseInt(match[4], 10)
    const minute = parseInt(match[5], 10)
    const second = parseInt(match[6], 10)

    // 월 검증 (1 ~ 12)
    if (month < 1 || month > 12) {
      return { valid: false }
    }

    // 윤년 및 월별 일수 검증 (JS Date rollover 차단)
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if (day < 1 || day > daysInMonth[month - 1]) {
      return { valid: false }
    }

    // 시간, 분, 초 검증 (00~23시, 00~59분, 00~59초)
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
      return { valid: false }
    }

    // 타임존 오프셋 검증 (UTC -14:00 ~ +14:00)
    if (match[7] !== 'Z' && match[9]) {
      const offHour = parseInt(match[9], 10)
      const offMin = match[10] ? parseInt(match[10], 10) : 0
      if (offHour < 0 || offHour > 14 || offMin < 0 || offMin > 59) {
        return { valid: false }
      }
      if (offHour === 14 && offMin > 0) {
        return { valid: false }
      }
    }

    const d = new Date(trimmed)
    if (Number.isNaN(d.getTime())) {
      return { valid: false }
    }
    return { valid: true, date: d }
  }

  return { valid: false }
}

/**
 * 버전 정규화 (유효 타임스탬프 검증 및 PostgreSQL 마이크로초 절삭 방지 raw string 보존)
 */
function normalizeVersion(v: string | Date): string | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    return v.toISOString()
  }

  if (typeof v === 'string') {
    const parsed = parseTimestamp(v)
    if (!parsed.valid) return null
    return v.trim()
  }

  return null
}

/**
 * 이벤트와 DB 예약 status 정합성 검사
 * DB reservations 테이블에는 CHANGED 상태가 없으며, 변경 후에도 status는 CONFIRMED 상태를 유지한다.
 */
function isStatusMatchingEvent(event: NotificationEvent, status: string): boolean {
  const normStatus = (status || '').toUpperCase()
  switch (event) {
    case 'BOOKING_CONFIRMED':
    case 'BOOKING_CHANGED':
    case 'REMINDER_24H':
    case 'REMINDER_2H':
    case 'PAYMENT_CONFIRMED':
      return normStatus === 'CONFIRMED'
    case 'BOOKING_CANCELLED':
      return normStatus === 'CANCELLED'
    default:
      return false
  }
}

/**
 * 안전한 finish 호출 (예외 방어)
 */
async function safeFinish(
  store: StorePort,
  jobId: string,
  token: string,
  state: OutboxState,
  reasonCode: OutboxReasonCode,
): Promise<boolean> {
  try {
    return await store.finish(jobId, token, state, reasonCode)
  } catch {
    return false
  }
}

/**
 * 예약 Outbox 작업 순수 처리 함수
 */
export async function processNotificationJob(
  job: Job,
  deps: OutboxProcessorDeps,
): Promise<ProcessOutcome> {
  // 1. 비활성화 여부 검사 (claim 호출 금지)
  if (!deps.enabled) {
    return {
      status: 'DISABLED',
      reasonCode: OUTBOX_REASON.DISABLED,
    }
  }

  // 2. 실행 예정 시점 및 현재 시각 유효성 검사 (타임존 오프셋 누락 / Invalid Date / 달력 rollover 검사)
  const nowRaw = typeof deps.now === 'function' ? deps.now() : deps.now
  const nowParsed = parseTimestamp(nowRaw)
  const dueParsed = parseTimestamp(job.dueAt)

  if (!nowParsed.valid || !dueParsed.valid) {
    return {
      status: 'BLOCKED',
      reasonCode: OUTBOX_REASON.INVALID_SCHEDULE,
    }
  }

  // 3. 작업 버전 타임스탬프 검증 (claim 전 검사)
  const jobVersionNorm = normalizeVersion(job.reservationUpdatedAt)
  if (!jobVersionNorm) {
    return {
      status: 'BLOCKED',
      reasonCode: OUTBOX_REASON.INVALID_VERSION,
    }
  }

  if (nowParsed.date.getTime() < dueParsed.date.getTime()) {
    return {
      status: 'NOT_DUE',
      reasonCode: OUTBOX_REASON.NOT_DUE,
    }
  }

  // 4. 작업 선점 (Claim) - 예외 발생 시 PII 노출 방지 및 CLAIM_FAILED 안전 반환
  let leaseToken: string | null = null
  try {
    leaseToken = await deps.store.claim(job.id)
  } catch {
    return {
      status: 'CLAIM_FAILED',
      reasonCode: OUTBOX_REASON.CLAIM_FAILED,
    }
  }

  if (!leaseToken) {
    return {
      status: 'CLAIM_FAILED',
      reasonCode: OUTBOX_REASON.CLAIM_FAILED,
    }
  }

  // 간결한 finish 정산 헬퍼
  const settle = async (
    state: OutboxState,
    reasonCode: OutboxReasonCode,
    outcomeStatus: ProcessOutcomeStatus = state,
  ): Promise<ProcessOutcome> => {
    const finishRecorded = await safeFinish(
      deps.store,
      job.id,
      leaseToken,
      state,
      reasonCode,
    )
    return {
      status: outcomeStatus,
      reasonCode,
      leaseToken,
      finishRecorded,
    }
  }

  // 5. 최신 예약 조회 및 1차 정합성 검증 (저장소 예외 방어)
  let snapshot: ReservationSnapshot | null = null
  try {
    snapshot = await deps.repository.getCurrentReservation(
      job.workspaceId,
      job.reservationId,
      job.event,
    )
  } catch {
    return settle('BLOCKED', OUTBOX_REASON.READ_FAILED)
  }

  if (!snapshot) {
    return settle('BLOCKED', OUTBOX_REASON.RESERVATION_NOT_FOUND)
  }

  if (
    snapshot.workspaceId !== job.workspaceId ||
    snapshot.reservationId !== job.reservationId
  ) {
    return settle('BLOCKED', OUTBOX_REASON.WORKSPACE_MISMATCH)
  }

  // 스냅샷 버전 검증 (유효하지 않은 타임스탬프 또는 Date 객체 방어)
  const snapshotVersionNorm = normalizeVersion(snapshot.version)
  if (!snapshotVersionNorm) {
    return settle('BLOCKED', OUTBOX_REASON.INVALID_VERSION)
  }

  // 버전 정합성 검증 (raw string exact match로 마이크로초 절삭 방지 및 fail-closed 유지)
  if (snapshotVersionNorm !== jobVersionNorm) {
    return settle('SUPERSEDED', OUTBOX_REASON.STALE_RESERVATION)
  }

  // 이벤트와 예약 상태 부합 검사 (BOOKING_CHANGED는 CONFIRMED와 매칭)
  if (!isStatusMatchingEvent(job.event, snapshot.status)) {
    return settle('SUPERSEDED', OUTBOX_REASON.STATUS_MISMATCH)
  }

  // 전화번호 010 정규화 검사 (악성 문자 차단)
  const normalizedPhone = normalize010Phone(snapshot.phone)
  if (!normalizedPhone) {
    return settle('BLOCKED', OUTBOX_REASON.INVALID_PHONE)
  }

  // 5.5. 시험 발송용 허용목록(Allowlist) 게이트 검사 (claim 이후 markSending 이전 차단, 외부 호출 0)
  if (deps.allowlist) {
    const isAllowed =
      typeof deps.allowlist === 'function'
        ? deps.allowlist(normalizedPhone)
        : deps.allowlist.isAllowed(normalizedPhone)
    if (!isAllowed) {
      return settle('BLOCKED', OUTBOX_REASON.NOT_ALLOWLISTED)
    }
  }

  // 6. 정보성 수신 근거(동의) 1차 검증 (거부/absence != granted, 예외 방어)
  let evidence: InformationalEvidence | null = null
  try {
    evidence = await deps.repository.getInformationalEvidence(snapshot)
  } catch {
    return settle('BLOCKED', OUTBOX_REASON.READ_FAILED)
  }

  if (!evidence) {
    return settle('BLOCKED', OUTBOX_REASON.EVIDENCE_MISSING)
  }

  if (evidence.granted !== true) {
    return settle('BLOCKED', OUTBOX_REASON.EVIDENCE_NOT_GRANTED)
  }

  if (evidence.workspaceId !== snapshot.workspaceId) {
    return settle('BLOCKED', OUTBOX_REASON.EVIDENCE_WORKSPACE_MISMATCH)
  }

  if (evidence.reservationId !== snapshot.reservationId) {
    return settle('BLOCKED', OUTBOX_REASON.EVIDENCE_RESERVATION_MISMATCH)
  }

  const evidencePhone = normalize010Phone(evidence.subjectPhone)
  if (!evidencePhone || evidencePhone !== normalizedPhone) {
    return settle('BLOCKED', OUTBOX_REASON.EVIDENCE_PHONE_MISMATCH)
  }

  // 7. 템플릿 심사 승인 여부 1차 검증 (예외 방어)
  let approval: TemplateApproval | null = null
  try {
    approval = await deps.repository.getTemplateApproval(job.event)
  } catch {
    return settle('BLOCKED', OUTBOX_REASON.READ_FAILED)
  }

  if (!approval || approval.approved !== true) {
    return settle('BLOCKED', OUTBOX_REASON.TEMPLATE_NOT_APPROVED)
  }

  const templateId = (approval.templateId || '').trim()
  if (templateId.length === 0) {
    return settle('BLOCKED', OUTBOX_REASON.TEMPLATE_ID_BLANK)
  }

  // 8. Double-Read 직전 변경 감지 및 식별자/전화번호/동의/승인 전수 재검증 (예외 방어)
  let secondSnapshot: ReservationSnapshot | null = null
  try {
    secondSnapshot = await deps.repository.getCurrentReservation(
      job.workspaceId,
      job.reservationId,
      job.event,
    )
  } catch {
    return settle('BLOCKED', OUTBOX_REASON.READ_FAILED)
  }

  if (!secondSnapshot) {
    return settle('SUPERSEDED', OUTBOX_REASON.RESERVATION_DISAPPEARED)
  }

  // 2차 스냅샷 버전 검증
  const secondVersionNorm = normalizeVersion(secondSnapshot.version)
  if (!secondVersionNorm) {
    return settle('BLOCKED', OUTBOX_REASON.INVALID_VERSION)
  }

  // 버전 변경 감지 (raw string exact)
  if (secondVersionNorm !== snapshotVersionNorm) {
    return settle('SUPERSEDED', OUTBOX_REASON.CHANGED_BEFORE_SEND)
  }

  // 상태 변경 감지
  if (!isStatusMatchingEvent(job.event, secondSnapshot.status)) {
    return settle('SUPERSEDED', OUTBOX_REASON.STATUS_CHANGED_BEFORE_SEND)
  }

  // 2차 스냅샷 identity 및 수신 번호/고객 ID 불일치 감지 (미검증 번호 발송 차단)
  const secondPhone = normalize010Phone(secondSnapshot.phone)
  if (
    secondSnapshot.workspaceId !== job.workspaceId ||
    secondSnapshot.reservationId !== job.reservationId ||
    secondSnapshot.customerId !== snapshot.customerId ||
    !secondPhone ||
    secondPhone !== normalizedPhone
  ) {
    return settle('BLOCKED', OUTBOX_REASON.CHANGED_BEFORE_SEND)
  }

  // 2차 스냅샷 기준 정보성 수신 근거 재검증 (철회/번호 변경 차단, 예외 방어)
  let secondEvidence: InformationalEvidence | null = null
  try {
    secondEvidence = await deps.repository.getInformationalEvidence(secondSnapshot)
  } catch {
    return settle('BLOCKED', OUTBOX_REASON.READ_FAILED)
  }

  if (!secondEvidence) {
    return settle('BLOCKED', OUTBOX_REASON.EVIDENCE_MISSING)
  }
  if (secondEvidence.granted !== true) {
    return settle('BLOCKED', OUTBOX_REASON.EVIDENCE_NOT_GRANTED)
  }
  if (
    secondEvidence.workspaceId !== secondSnapshot.workspaceId ||
    secondEvidence.reservationId !== secondSnapshot.reservationId
  ) {
    return settle('BLOCKED', OUTBOX_REASON.EVIDENCE_WORKSPACE_MISMATCH)
  }
  const secondEvidencePhone = normalize010Phone(secondEvidence.subjectPhone)
  if (!secondEvidencePhone || secondEvidencePhone !== secondPhone) {
    return settle('BLOCKED', OUTBOX_REASON.EVIDENCE_PHONE_MISMATCH)
  }

  // send 직전 템플릿 심사 승인 재검증 (승인 취소 차단, 예외 방어)
  let latestApproval: TemplateApproval | null = null
  try {
    latestApproval = await deps.repository.getTemplateApproval(job.event)
  } catch {
    return settle('BLOCKED', OUTBOX_REASON.READ_FAILED)
  }

  if (!latestApproval || latestApproval.approved !== true) {
    return settle('BLOCKED', OUTBOX_REASON.TEMPLATE_NOT_APPROVED)
  }
  const latestTemplateId = (latestApproval.templateId || '').trim()
  if (latestTemplateId.length === 0 || latestTemplateId !== templateId) {
    return settle('BLOCKED', OUTBOX_REASON.TEMPLATE_ID_BLANK)
  }

  // 9. markSending CAS 획득 (에러 발생 시 고객 정보 누출 방지 및 발송 차단)
  let sendingAcquired = false
  try {
    sendingAcquired = await deps.store.markSending(job.id, leaseToken)
  } catch {
    return {
      status: 'CAS_LOST',
      reasonCode: OUTBOX_REASON.CAS_LOSS,
      leaseToken,
    }
  }

  if (!sendingAcquired) {
    return {
      status: 'CAS_LOST',
      reasonCode: OUTBOX_REASON.CAS_LOSS,
      leaseToken,
    }
  }

  // 10. send 딱 1회 호출
  let sendResult: { accepted: boolean; notSent?: boolean; failureCode?: string }
  try {
    sendResult = await deps.send(secondSnapshot, job, latestTemplateId)
  } catch {
    // send throw: 미접수 단정 금지, 자동 재시도 금지, UNKNOWN 반환
    return settle('UNKNOWN', OUTBOX_REASON.SEND_EXCEPTION)
  }

  if (sendResult.notSent === true) {
    // 사전검증 실패로 외부 호출이 전혀 발생하지 않은 경우 BLOCKED로 안전하게 종결
    return settle('BLOCKED', OUTBOX_REASON.SEND_PRECHECK_FAILED)
  }

  if (!sendResult.accepted) {
    // accepted false: 미접수 단정 금지, 자동 재시도 금지, UNKNOWN 반환
    let reasonCode: OutboxReasonCode = OUTBOX_REASON.SEND_REJECTED
    if (sendResult.failureCode && typeof sendResult.failureCode === 'string') {
      const candidate = `SEND_REJECTED_${sendResult.failureCode}`.slice(0, 64)
      if (/^[A-Z0-9_]{1,64}$/.test(candidate)) {
        reasonCode = candidate as OutboxReasonCode
      }
    }
    return settle('UNKNOWN', reasonCode)
  }

  // 11. 발송 접수 성공 후 영속화 finish
  const finishSuccess = await safeFinish(
    deps.store,
    job.id,
    leaseToken,
    'SENT',
    OUTBOX_REASON.SENT_SUCCESS,
  )

  if (!finishSuccess) {
    // 발송은 접수되었으나 상태 기록 실패 -> 재발송 절대 금지! UNKNOWN으로 반환
    return {
      status: 'UNKNOWN',
      reasonCode: OUTBOX_REASON.POST_SEND_RECORD_FAILED,
      leaseToken,
      finishRecorded: false,
    }
  }

  return {
    status: 'SENT',
    reasonCode: OUTBOX_REASON.SENT_SUCCESS,
    leaseToken,
    finishRecorded: true,
  }
}
