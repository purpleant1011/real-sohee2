export type ObservationState = 'OBSERVED' | 'NOT_OBSERVED' | 'CONNECTION_REQUIRED' | 'ERROR'

export interface ReportingPeriod {
  /** UTC, inclusive. */
  start: string
  /** UTC, exclusive. */
  end: string
}

export interface ReportingObservation {
  value: number | null
  state: ObservationState
  source: string
  period: ReportingPeriod
  observedAt: string | null
  evidenceIds: string[]
}

/**
 * 직접 선택 구간의 최대 길이(UTC 달력일, 양 끝 포함). 한 분기.
 * 초과 구간은 잘라 응답하지 않고 거절한다 — 요청과 다른 기간의 숫자를 그리지 않기 위해서다.
 * reporting 이 아래 계층이므로 상수는 여기 두고 `results-period` 가 재수출한다.
 */
export const MAX_REPORTING_RANGE_DAYS = 92

/** Shared UTC calendar boundary for home, CRM, results and scheduled reports. */
export function currentReportingEnd(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

export function formatObservation(metric: ReportingObservation, unit = '건'): string {
  if (metric.state === 'ERROR') return '조회 오류'
  if (metric.state === 'CONNECTION_REQUIRED') return '연결 필요'
  if (metric.state !== 'OBSERVED' || metric.value === null) return '아직 확인할 수 없어요'
  return `${metric.value.toLocaleString('ko-KR')}${unit}`
}

/**
 * ANI-1777: 예약·수납 읽기 모델의 확인 상태.
 *
 * CONFIRMED 만 '숫자를 그려도 되는 관측'이다. 관측 성공(state=OBSERVED)만으로는 부족하고
 * **어디서 읽었는지(source)** 를 댈 수 있어야 한다. 출처가 비어 있으면 그 숫자는 근거 없는
 * 값이므로 확인 안 됨으로 닫고 숫자를 만들지 않는다.
 */
export type ObservationConfirmation = 'CONFIRMED' | 'UNCONFIRMED' | 'ERROR' | 'CONNECTION_REQUIRED'

/** 관측은 됐지만 출처를 댈 수 없을 때(또는 근거가 없을 때) 숫자 대신 쓰는 문구. */
export const UNCONFIRMED_LABEL = '확인 안 됨'

/** 숫자를 읽은 출처. 공백은 출처 없음으로 닫는다. */
export function observationSource(metric: ReportingObservation | null | undefined): string | null {
  const source = metric?.source.trim() ?? ''
  return source === '' ? null : source
}

/** 지표의 확인 상태. 숫자는 CONFIRMED 일 때만 그린다. */
export function confirmationOf(metric: ReportingObservation | null | undefined): ObservationConfirmation {
  if (!metric) return 'UNCONFIRMED'
  if (metric.state === 'ERROR') return 'ERROR'
  if (metric.state === 'CONNECTION_REQUIRED') return 'CONNECTION_REQUIRED'
  if (metric.state !== 'OBSERVED' || metric.value === null) return 'UNCONFIRMED'
  return observationSource(metric) === null ? 'UNCONFIRMED' : 'CONFIRMED'
}

/** 확인된 값만 돌려준다. 확인할 수 없으면 null — 0 으로 대체하지 않는다. */
export function confirmedValue(metric: ReportingObservation | null | undefined): number | null {
  return confirmationOf(metric) === 'CONFIRMED' ? metric!.value : null
}

export interface ObservationTruth {
  /** 숫자를 그릴 수 있을 때만 값이 있다. */
  value: number | null
  /** 그 숫자를 읽은 원장·연동. 확인된 숫자에만 붙는다. */
  source: string | null
  confirmation: ObservationConfirmation
}

/** 읽기 모델이 숫자를 그려도 되는지 한 번에 판정한다. */
export function observationTruth(metric: ReportingObservation | null | undefined): ObservationTruth {
  const confirmation = confirmationOf(metric)
  if (confirmation !== 'CONFIRMED') return { value: null, source: null, confirmation }
  return { value: metric!.value, source: observationSource(metric), confirmation }
}
