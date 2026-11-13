import {
  type EvidenceRecordListDTO,
  type EvidenceRecordMetric,
  EVIDENCE_RECORD_MAX_RECORDS,
  failedEvidenceRecordList,
  isEvidenceRecordKind,
  isEvidenceRecordMetric,
  isEvidenceRecordTimestamp,
} from './evidence-record-dto'

/**
 * M20 근거 기록 응답 경계. 설계 §5(`docs/mobile-r2/ani-1783-evidence-record-dto-design.md`).
 *
 * 이 모듈이 하는 일은 하나다: 네트워크 응답(상태 코드·본문)을 화면이 그릴 수 있는 하나의 결론으로 바꾼다.
 * - 401(세션 없음)과 403(권한 없음)을 뭉개지 않는다. 둘 다 '빈 목록'이 아니다.
 * - 404·네트워크 끊김·5xx·본문 파싱 실패는 각각 다른 결론이다. 어느 것도 0건이 아니다.
 * - 본문이 온전해 보여도 경계에서 다시 검증한다. 화면이 신뢰하는 건 서버의 선언이 아니라 이 검증 결과다.
 * - 다른 사업장 응답(workspaceId 불일치)은 그리지 않는다 — 본문에 레코드가 있어도 버린다.
 *
 * 순수 함수다. fetch·env·로깅을 하지 않는다(호출부가 no-store 로 받아 넘긴다).
 */

/** 이 경로의 응답은 캐시하지 않는다(설계 §5.1). 호출부 fetch 옵션에도 같은 값을 넘긴다. */
export const EVIDENCE_RECORD_CACHE_CONTROL = 'no-store'

export type EvidenceRecordBoundaryKind =
  | 'ready'
  | 'confirmed_empty'
  | 'metric_disconnected'
  | 'not_observed'
  | 'connection_required'
  | 'excluded'
  | 'unauthorized'
  | 'missing'
  | 'offline'
  | 'error'

export type EvidenceRecordErrorReason =
  /** fetch 자체가 실패했거나 5xx 를 받았다. */
  | 'transport'
  /** 본문이 DTO 형태가 아니다(파싱·타입 오류). */
  | 'payload'
  /** 다른 사업장 응답이라 본문을 믿을 수 없다. */
  | 'workspace'
  /** 서버가 스스로 ERROR 라고 말한 응답. 0건으로 바꾸지 않는다. */
  | 'state'
  /** 개수·구성 조건이 어긋난 응답(예: 잘렸다고 하면서 전부인 척). */
  | 'inconsistent'
  /** DTO 에 있어서는 안 되는 값(원본 id·상세 링크)이 실려 왔다. */
  | 'forbidden'

export type EvidenceRecordBoundary =
  | { kind: 'ready'; data: EvidenceRecordListDTO }
  | { kind: 'confirmed_empty'; data: EvidenceRecordListDTO }
  | { kind: 'metric_disconnected'; data: EvidenceRecordListDTO }
  | { kind: 'not_observed'; data: EvidenceRecordListDTO }
  | { kind: 'connection_required'; data: EvidenceRecordListDTO }
  | { kind: 'excluded'; data: EvidenceRecordListDTO }
  /** 401: 세션 없음/만료. 403: 볼 권한 없음. 문구가 다르므로 나눈다. */
  | { kind: 'unauthorized'; reason: 'session' | 'permission'; data: EvidenceRecordListDTO }
  | { kind: 'missing'; data: EvidenceRecordListDTO }
  | { kind: 'offline'; data: EvidenceRecordListDTO }
  | { kind: 'error'; reason: EvidenceRecordErrorReason; data: EvidenceRecordListDTO }

export interface EvidenceRecordResponseInput {
  /** 요청한 사업장. 응답 본문의 workspaceId 와 같아야 한다. */
  workspaceId: string
  /** 요청한 지표. 응답 본문의 metric 과 같아야 한다. */
  metric: EvidenceRecordMetric
  /** 브라우저가 오프라인이라고 알린 경우. 상태 코드를 보기 전에 닫는다. */
  offline?: boolean
  /** 응답 상태 코드. fetch 가 던졌으면 null. */
  status: number | null
  /** 파싱한 본문. 파싱 실패면 null. */
  payload: unknown
}

type PayloadValidation =
  | { ok: true; data: EvidenceRecordListDTO }
  | { ok: false; reason: 'payload' | 'workspace' | 'inconsistent' | 'forbidden' }

const STATES: ReadonlySet<string> = new Set(['OBSERVED', 'NOT_OBSERVED', 'CONNECTION_REQUIRED', 'ERROR'])
const DATASET_MODES: ReadonlySet<string> = new Set(['ACTUAL', 'EXCLUDED', 'UNKNOWN'])
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const UNSAFE_COPY = /:\/\/|@/

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isOptionalTimestamp(value: unknown): value is string | null {
  return value === null || isEvidenceRecordTimestamp(value)
}

/** 사용자 문구에 id·URL·내부 경로가 섞였는지. 섞였으면 그리지 않는다. */
function cleanCopy(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (value.trim() === '') return false
  if (UUID_PATTERN.test(value) || UNSAFE_COPY.test(value)) return false
  return value.length <= 80
}

/**
 * 응답 본문을 DTO 로 검증한다. 서버 선언을 그대로 믿지 않는다.
 *
 * 거부 조건(설계 §5):
 * - state 가 OBSERVED 가 아니면 totalCount 는 null, records 는 빈 배열, hasMore 는 true 다.
 *   (ERROR 에 숫자 0 을 담아 보내면 거부한다 — 실패를 0건으로 읽게 만들기 때문)
 * - OBSERVED 면 totalCount 가 숫자이고 records 는 totalCount 를 넘지 않는다.
 * - hasMore=false 는 "이게 전부"라는 선언이므로 records.length === totalCount 일 때만 받는다.
 * - recordRef·detailHref 는 2안에서 null 이다. 값이 실려 오면 거부한다(원본 id 노출 방지).
 * - ACTUAL 이 아닌데 레코드를 담아 보내면 거부한다(예시 기록을 실제 근거처럼 읽게 된다).
 */
export function validateEvidenceRecordListDTO(
  payload: unknown,
  expected: { workspaceId: string; metric?: EvidenceRecordMetric },
): PayloadValidation {
  if (!isObject(payload)) return { ok: false, reason: 'payload' }
  // 다른 사업장 응답은 형태를 보기 전에 닫는다. 본문의 어떤 레코드도 화면에 닿지 않는다.
  if (payload.workspaceId !== expected.workspaceId) return { ok: false, reason: 'workspace' }

  const metric = payload.metric
  if (!isEvidenceRecordMetric(metric)) return { ok: false, reason: 'payload' }
  if (expected.metric !== undefined && metric !== expected.metric) return { ok: false, reason: 'inconsistent' }

  const state = payload.state
  const datasetMode = payload.datasetMode
  if (typeof state !== 'string' || !STATES.has(state)) return { ok: false, reason: 'payload' }
  if (typeof datasetMode !== 'string' || !DATASET_MODES.has(datasetMode)) return { ok: false, reason: 'payload' }
  if (typeof payload.metricConnected !== 'boolean') return { ok: false, reason: 'payload' }
  if (!isOptionalTimestamp(payload.checkedAt) || !isOptionalTimestamp(payload.observedAt)) {
    return { ok: false, reason: 'payload' }
  }
  if (!isCount(payload.omittedUnknownCount)) return { ok: false, reason: 'payload' }
  if (typeof payload.hasMore !== 'boolean') return { ok: false, reason: 'payload' }

  const period = payload.period
  if (!isObject(period) || typeof period.start !== 'string' || typeof period.end !== 'string') {
    return { ok: false, reason: 'payload' }
  }
  // 관측이 성립한 응답은 UTC 경계가 필수다. 실패 응답은 기간을 모를 수 있다.
  if (state === 'OBSERVED' && (!isEvidenceRecordTimestamp(period.start) || !isEvidenceRecordTimestamp(period.end))) {
    return { ok: false, reason: 'payload' }
  }

  const records = payload.records
  if (!Array.isArray(records)) return { ok: false, reason: 'payload' }
  if (records.length > EVIDENCE_RECORD_MAX_RECORDS) return { ok: false, reason: 'inconsistent' }

  const totalCount = payload.totalCount
  if (state === 'OBSERVED') {
    if (!isCount(totalCount)) return { ok: false, reason: 'inconsistent' }
    if (records.length > totalCount) return { ok: false, reason: 'inconsistent' }
    // "더 없음"이라고 말하려면 실제로 전부 갖고 있어야 한다.
    if (payload.hasMore === false && records.length !== totalCount) return { ok: false, reason: 'inconsistent' }
  } else {
    // 실패·미관측 응답에 숫자나 목록이 실려 오면, 화면은 그걸 0건/목록으로 그리게 된다.
    if (totalCount !== null) return { ok: false, reason: 'inconsistent' }
    if (records.length !== 0) return { ok: false, reason: 'inconsistent' }
    if (payload.hasMore !== true) return { ok: false, reason: 'inconsistent' }
  }

  // 실제 기록(ACTUAL)이 아니면 목록을 실을 수 없다. 예시를 실제 근거처럼 읽게 된다.
  if (datasetMode !== 'ACTUAL' && records.length !== 0) return { ok: false, reason: 'inconsistent' }

  for (const record of records) {
    if (!isObject(record)) return { ok: false, reason: 'payload' }
    if (!isEvidenceRecordKind(record.kind)) return { ok: false, reason: 'payload' }
    if (!isEvidenceRecordTimestamp(record.occurredAt)) return { ok: false, reason: 'payload' }
    // 2안: 원본 id·상세 링크는 null 이어야 한다.
    if (record.recordRef !== null) return { ok: false, reason: 'forbidden' }
    if (record.detailHref !== null) return { ok: false, reason: 'forbidden' }
    if (!cleanCopy(record.kindLabel) || !cleanCopy(record.summary)) return { ok: false, reason: 'forbidden' }
  }

  return { ok: true, data: payload as unknown as EvidenceRecordListDTO }
}

function failed(input: EvidenceRecordResponseInput): EvidenceRecordListDTO {
  return failedEvidenceRecordList(input.workspaceId, input.metric)
}

/**
 * 상태 코드 + 본문 → 화면 결론.
 *
 * 우선순위: 오프라인 → 401 → 403 → 404 → 5xx/전송 실패 → 200 본문 검증 → 상태 조합.
 */
export function evidenceRecordBoundary(input: EvidenceRecordResponseInput): EvidenceRecordBoundary {
  if (input.offline === true) return { kind: 'offline', data: failed(input) }

  const status = input.status
  if (status === 401) return { kind: 'unauthorized', reason: 'session', data: failed(input) }
  if (status === 403) return { kind: 'unauthorized', reason: 'permission', data: failed(input) }
  if (status === 404) return { kind: 'missing', data: failed(input) }
  if (status === null) return { kind: 'error', reason: 'transport', data: failed(input) }
  if (status >= 500) return { kind: 'error', reason: 'transport', data: failed(input) }
  if (status !== 200) return { kind: 'error', reason: 'payload', data: failed(input) }

  const validated = validateEvidenceRecordListDTO(input.payload, {
    workspaceId: input.workspaceId,
    metric: input.metric,
  })
  if (!validated.ok) {
    if (validated.reason === 'workspace') {
      // 검증 실패 시 본문을 내려보내지 않는다. 다른 사업장 레코드가 화면에 닿을 경로를 만들지 않는다.
      return { kind: 'error', reason: 'workspace', data: failedEvidenceRecordList('', input.metric) }
    }
    return { kind: 'error', reason: validated.reason, data: failed(input) }
  }

  const data = validated.data
  if (data.datasetMode !== 'ACTUAL') return { kind: 'excluded', data }
  if (!data.metricConnected) return { kind: 'metric_disconnected', data }

  if (data.state === 'ERROR') return { kind: 'error', reason: 'state', data }
  if (data.state === 'CONNECTION_REQUIRED') return { kind: 'connection_required', data }
  if (data.state === 'NOT_OBSERVED') return { kind: 'not_observed', data }

  // 여기부터 OBSERVED. 0건은 이때만 말할 수 있다.
  if (data.totalCount === 0) return { kind: 'confirmed_empty', data }
  return { kind: 'ready', data }
}
