import type { ReportingDatasetMode } from '@/features/reporting/dataset'
import type { ObservationState, ReportingObservation, ReportingPeriod } from '@/features/reporting/observation'
import type { KpiId } from '../results-model'

/**
 * M20 근거 기록 목록 DTO. 설계는 `docs/mobile-r2/ani-1783-evidence-record-dto-design.md`.
 *
 * 원칙:
 * - 서버가 확인한 사실만 내려준다. ERROR 는 0건이 아니고, 모르는 개수는 null 이다.
 * - 레코드 id(UUID·DB id·해시·base64)는 DTO 에 넣지 않는다. `recordRef` 는 2안(링크 없음)이라 null 이다.
 * - 사용자 문구(kindLabel·summary)는 서버가 완성한다. 화면이 kind→한국어 매핑을 다시 만들지 않는다.
 * - 목록은 "전부"라고 말하지 않는다. 잘랐으면 `hasMore` 로 말한다.
 *
 * 이 모듈은 순수 어댑터다. DB·네트워크·provider 를 호출하지 않고, 원장에서 읽은 줄을 받아
 * 화면 DTO 로 바꾸는 일만 한다(쓰기 경로가 없으므로 멱등키도 필요 없다).
 */

/** 목록 상한. 설계 §10.2 결정: 20건 + hasMore, 무한 스크롤 없음. */
export const EVIDENCE_RECORD_MAX_RECORDS = 20

/** 서버가 아는 기록 종류. 모르는 값은 목록에 그리지 않고 `omittedUnknownCount` 로 센다. */
export type EvidenceRecordKind =
  | 'PUBLISH_VERIFIED'
  | 'PUBLISH_PENDING'
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELED'
  | 'COMMENT_STORED'

/** 근거 목록을 요청할 수 있는 지표 키(성과 드릴다운 `:id`). */
export type EvidenceRecordMetric = KpiId

/** 관측 상태 어휘는 주간 리포트와 같다. 화면·서버가 각자 정의하지 않는다. */
export type EvidenceRecordListState = ObservationState

/** 사용자에게 보여 줄 종류 라벨. 화면은 `kind` 가 아니라 이 문자열만 그린다. */
export const EVIDENCE_RECORD_KIND_LABEL: Record<EvidenceRecordKind, string> = {
  PUBLISH_VERIFIED: '게시 확인',
  PUBLISH_PENDING: '게시 확인 대기',
  BOOKING_CONFIRMED: '예약 확정',
  BOOKING_CANCELED: '예약 취소',
  COMMENT_STORED: '저장된 댓글',
}

/** 원장 줄에 표시명이 없을 때 쓰는 종류별 기본 요약. 개인정보·내부 경로가 아니다. */
const KIND_FALLBACK_SUMMARY: Record<EvidenceRecordKind, string> = {
  PUBLISH_VERIFIED: '게시한 게시물',
  PUBLISH_PENDING: '게시 확인을 기다리는 게시물',
  BOOKING_CONFIRMED: '예약',
  BOOKING_CANCELED: '취소된 예약',
  COMMENT_STORED: '댓글',
}

const KNOWN_KINDS: ReadonlySet<string> = new Set(Object.keys(EVIDENCE_RECORD_KIND_LABEL))
const EVIDENCE_RECORD_METRICS: ReadonlySet<string> = new Set(['published', 'inquiries', 'bookings', 'deposits'])

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
/** 표시명에 있으면 안 되는 것: URL, 이메일/핸들, 여러 줄. */
const UNSAFE_SUBJECT = /:\/\/|@|\r|\n/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const MAX_SUBJECT_LENGTH = 40

export interface EvidenceRecordSummary {
  /** 서버 발급 불투명 핸들. 2안(링크 없음)에서는 null — 원본 id 를 대신 넣지 않는다. */
  recordRef: string | null
  kind: EvidenceRecordKind
  /** 서버가 완성한 한국어 라벨. 화면은 이 문자열만 쓴다. */
  kindLabel: string
  /** 한 줄 요약. 개인정보·내부 경로·원문 금지. */
  summary: string
  /** 기록이 만들어진 시각(UTC ISO). 응답의 `checkedAt` 과 다른 값이다. */
  occurredAt: string
  /** 이동할 화면. 2안에서는 항상 null — 갈 곳 없는 링크를 지어내지 않는다. */
  detailHref: string | null
}

export interface EvidenceRecordListDTO {
  workspaceId: string
  metric: EvidenceRecordMetric
  state: EvidenceRecordListState
  datasetMode: ReportingDatasetMode
  /** 이 지표를 집계하는 원천이 연결되어 있는지. '고객 문의'(저장된 댓글)는 false 다. */
  metricConnected: boolean
  /** UTC 경계. 관측을 읽지 못했으면 빈 문자열일 수 있으므로 화면은 ERROR 에서 기간을 그리지 않는다. */
  period: ReportingPeriod
  /** 집계·readback 을 마친 시각. 읽을 수 없으면 null("확인 시각을 읽지 못했어요"). */
  checkedAt: string | null
  /** 관측이 성립한 시각. 미관측이면 null. */
  observedAt: string | null
  /** OBSERVED 일 때만 숫자. 그 밖에는 null (0 아님). */
  totalCount: number | null
  /** 잘라 보낸 목록. 최대 `EVIDENCE_RECORD_MAX_RECORDS` 건. */
  records: EvidenceRecordSummary[]
  /** 목록에 그리지 못한 기록(모르는 종류·시각 불명)의 수. 0 이 정상. */
  omittedUnknownCount: number
  /** totalCount 보다 records 가 적은가. 모르면 true — 모른다고 말한다. */
  hasMore: boolean
}

/** 서버 원장에서 읽은 기록 한 줄. id 는 받지 않는다(화면 DTO 에 평문 id 금지). */
export interface EvidenceRecordSourceRow {
  kind: unknown
  occurredAt: unknown
  /** 사용자에게 보여 줄 대상 표시명(채널·예약 등). 서버가 완성한 문구만 넣는다. */
  subject?: unknown
}

export interface EvidenceRecordInput {
  workspaceId: string
  metric: EvidenceRecordMetric
  datasetMode: ReportingDatasetMode
  /** 지표 관측. null 이면 관측 자체를 읽지 못한 것 → 숫자·목록 없이 ERROR. */
  observation: ReportingObservation | null
  /** 관측이 없을 때 쓸 기간 경계. */
  period: ReportingPeriod | null
  /** 집계·readback 을 마친 시각. */
  checkedAt: string | null
  /** 원장에서 읽은 기록 줄. null 이면 기록 원장을 읽지 못한 것 → ERROR(0건 아님). */
  rows: readonly EvidenceRecordSourceRow[] | null
  /** 원장이 기간 전체를 읽었는지. false·미지정이면 잘렸다고 말한다(hasMore=true). */
  complete?: boolean
}

export function isEvidenceRecordKind(value: unknown): value is EvidenceRecordKind {
  return typeof value === 'string' && KNOWN_KINDS.has(value)
}

export function isEvidenceRecordMetric(value: unknown): value is EvidenceRecordMetric {
  return typeof value === 'string' && EVIDENCE_RECORD_METRICS.has(value)
}

export function isEvidenceRecordTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value))
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function validPeriod(period: ReportingPeriod | null | undefined): ReportingPeriod | null {
  if (!period || !isEvidenceRecordTimestamp(period.start) || !isEvidenceRecordTimestamp(period.end)) return null
  return { start: period.start, end: period.end }
}

/**
 * 표시명은 서버가 완성했더라도 경계에서 한 번 더 막는다.
 * UUID·URL·이메일·핸들·여러 줄이 섞이면 버리고 종류별 기본 문구로 닫는다(개인정보·id 비노출).
 */
function safeSubject(value: unknown, kind: EvidenceRecordKind): string {
  const fallback = KIND_FALLBACK_SUMMARY[kind]
  if (typeof value !== 'string') return fallback
  const subject = value.trim()
  if (subject === '' || subject.length > MAX_SUBJECT_LENGTH) return fallback
  if (UUID_PATTERN.test(subject) || UNSAFE_SUBJECT.test(subject)) return fallback
  return subject
}

/**
 * 지표 관측 + 원장 줄 → 근거 기록 목록.
 *
 * fail-closed 규칙(설계 §5):
 * - ACTUAL 이 아니거나 집계하지 않는 지표면 목록·숫자를 모두 숨긴다.
 * - ERROR·NOT_OBSERVED·CONNECTION_REQUIRED 는 totalCount=null 이다. 0 으로 바꾸지 않는다.
 * - OBSERVED 인데 기록 원장을 읽지 못했으면(rows=null) ERROR 다(빈 목록 아님).
 * - 원장이 기간 전체를 읽었다고 말했는데 줄 수가 evidenceCount 와 다르면 ERROR 다(수가 어긋난 목록).
 * - 모르는 종류·시각 불명 줄은 버리되 `omittedUnknownCount` 로 센다(조용히 버리지 않는다).
 */
export function toEvidenceRecordList(input: EvidenceRecordInput): EvidenceRecordListDTO {
  const metricConnected = input.metric !== 'inquiries'
  const checkedAt = isEvidenceRecordTimestamp(input.checkedAt) ? input.checkedAt : null
  const period = validPeriod(input.observation?.period) ?? validPeriod(input.period) ?? { start: '', end: '' }
  const base: EvidenceRecordListDTO = {
    workspaceId: input.workspaceId,
    metric: input.metric,
    state: 'ERROR',
    datasetMode: input.datasetMode,
    metricConnected,
    period,
    checkedAt,
    observedAt: null,
    totalCount: null,
    records: [],
    omittedUnknownCount: 0,
    hasMore: true,
  }
  const failed = (state: EvidenceRecordListState): EvidenceRecordListDTO => ({ ...base, state })

  if (typeof input.workspaceId !== 'string' || input.workspaceId.trim() === '') return failed('ERROR')
  if (!isEvidenceRecordMetric(input.metric)) return failed('ERROR')
  // 1) 실제 기록(ACTUAL)이 아니면 숫자·목록을 모두 숨긴다.
  if (input.datasetMode !== 'ACTUAL') return failed('NOT_OBSERVED')
  // 2) 애초에 집계하지 않는 지표(고객 문의 ← 저장된 댓글)는 '연결 안 됨'과도 구분한다.
  if (!metricConnected) return failed('NOT_OBSERVED')

  const observation = input.observation
  if (!observation) return failed('ERROR')

  // 3) 조회 실패는 0건이 아니다.
  if (observation.state === 'ERROR') return failed('ERROR')
  if (observation.state === 'CONNECTION_REQUIRED') return failed('CONNECTION_REQUIRED')
  if (observation.state !== 'OBSERVED') return failed('NOT_OBSERVED')

  const evidenceIds = observation.evidenceIds
  if (!Array.isArray(evidenceIds) || !evidenceIds.every(id => typeof id === 'string')) return failed('ERROR')
  // 드릴다운이 보여 준 "연결된 기록 N건"과 같은 수를 쓴다. 두 수가 다르면 화면에서 어긋난다.
  const totalCount = evidenceIds.length

  const rows = input.rows
  // 관측은 있는데 기록 원장을 읽지 못한 것은 빈 목록이 아니라 조회 실패다.
  if (rows === null) return failed('ERROR')
  if (input.complete === true && rows.length !== totalCount) return failed('ERROR')

  const observedAt = isEvidenceRecordTimestamp(observation.observedAt) ? observation.observedAt : null
  const records: EvidenceRecordSummary[] = []
  let omittedUnknownCount = 0
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      omittedUnknownCount += 1
      continue
    }
    const kind = row.kind
    const occurredAt = row.occurredAt
    if (!isEvidenceRecordKind(kind) || !isEvidenceRecordTimestamp(occurredAt)) {
      omittedUnknownCount += 1
      continue
    }
    records.push({
      recordRef: null,
      kind,
      kindLabel: EVIDENCE_RECORD_KIND_LABEL[kind],
      summary: safeSubject(row.subject, kind),
      occurredAt,
      detailHref: null,
    })
  }
  // 원장이 준 기록이 집계된 수보다 많으면 어느 쪽도 믿을 수 없다.
  if (records.length > totalCount) return failed('ERROR')

  records.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
  const visible = records.slice(0, EVIDENCE_RECORD_MAX_RECORDS)
  return {
    ...base,
    state: 'OBSERVED',
    observedAt,
    totalCount,
    records: visible,
    omittedUnknownCount,
    hasMore: input.complete !== true || totalCount > visible.length,
  }
}

/** 경계 모듈이 실패 응답을 만들 때 쓰는 최소 DTO. 숫자·목록은 비어 있고 state 만 ERROR 다. */
export function failedEvidenceRecordList(
  workspaceId: string,
  metric: EvidenceRecordMetric,
  checkedAt: string | null = null,
): EvidenceRecordListDTO {
  return {
    workspaceId,
    metric,
    state: 'ERROR',
    datasetMode: 'UNKNOWN',
    metricConnected: metric !== 'inquiries',
    period: { start: '', end: '' },
    checkedAt: isEvidenceRecordTimestamp(checkedAt) ? checkedAt : null,
    observedAt: null,
    totalCount: null,
    records: [],
    omittedUnknownCount: 0,
    hasMore: true,
  }
}

export { isCount as isEvidenceRecordCount }
