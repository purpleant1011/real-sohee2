import { MAX_REPORTING_RANGE_DAYS, currentReportingEnd, type ReportingPeriod } from '@/features/reporting/observation'

export { MAX_REPORTING_RANGE_DAYS }

/**
 * M20 성과의 기간 선택(ANI-1706, 직접 선택 서버 측 ANI-1782).
 *
 * 프리셋 '이번 주'·'지난주'는 **기존 주간 읽기 API 에 기준 시각을 넘기는 것**이다.
 * 직접 선택은 같은 API 에 `?start=&end=` 구간을 넘긴다. 새 API·쓰기 경로·저장소는 만들지 않는다.
 * 구간은 UTC 달력일(양 끝 포함)이며, 최종 판정은 서버가 한다.
 */
export type ResultsPeriod = 'current' | 'previous'

export const RESULTS_PERIOD_OPTIONS = [
  { value: 'current', label: '이번 주' },
  { value: 'previous', label: '지난주' },
] as const satisfies ReadonlyArray<{ value: ResultsPeriod; label: string }>

export const DEFAULT_RESULTS_PERIOD: ResultsPeriod = 'current'

/** 주소·서버 파라미터는 신뢰하지 않는다. 두 값이 아니면 기간을 정하지 않은 것으로 본다. */
export function isResultsPeriod(value: string | null | undefined): value is ResultsPeriod {
  return value === 'current' || value === 'previous'
}

/**
 * 기간을 주소에 남기는 쿼리. '이번 주'는 기본값이라 주소를 더럽히지 않는다.
 * 지난주는 새로고침·뒤로가기에서도 유지돼야 하므로 쿼리로 남긴다.
 * 직접 구간이 있으면 구간 쿼리만 낸다 — 서버는 구간과 period 가 함께 오면 400 으로 닫는다.
 */
export function resultsPeriodSearch(period: ResultsPeriod, range: ResultsRange | null = null): string {
  if (range) return resultsRangeSearch(range)
  return period === 'previous' ? '?period=previous' : ''
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 주간 리포트 서비스에 넘길 기준 시각(`generateReport` 의 `baseDate`).
 * 서비스는 `[baseDate − 7일, baseDate)` 를 집계하므로, 지난주는 이번 주 종료 시각에서
 * 정확히 7일을 뺀 값이다. 기간 라벨은 응답이 스스로 말하므로 화면이 기간을 지어내지 않는다.
 */
export function resultsPeriodBaseDate(period: ResultsPeriod, now: Date = new Date()): Date {
  const end = currentReportingEnd(now)
  return period === 'previous' ? new Date(end.getTime() - WEEK_MS) : end
}

/** 400 본문. 사용자 문구 한 줄이며 내부 파라미터명·영문 코드를 싣지 않는다. */
export const RESULTS_RANGE_ERROR = '조회 기간을 확인해 주세요.'

/** 직접 선택 구간. `YYYY-MM-DD` 달력일(UTC), 시작과 끝 모두 포함. */
export interface ResultsRange { start: string; end: string }

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 실제로 존재하는 달력일만 참이다. `Date` 는 '2026-02-30' 을 3월 2일로 넘기므로
 * 되돌렸을 때 같은 문자열이 나오는지(round-trip)까지 확인한다.
 */
function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !CALENDAR_DAY.test(value)) return false
  const time = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === value
}

/** 달력일의 UTC 자정(ms). `Date.UTC` 는 0~99년을 1900년대로 읽으므로 연·월·일을 `setUTCFullYear` 로 넣는다. */
function utcDayMs(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(0).setUTCFullYear(year, month - 1, date)
}

/** 주소·요청 값이 달력일 두 개로 된 구간 모양인지 본다. 값이 실제로 조회 가능한지(길이·미래)는 `resultsRangeProblem` 이 본다. */
export function isResultsRange(value: unknown): value is ResultsRange {
  if (typeof value !== 'object' || value === null) return false
  const { start, end } = value as { start?: unknown; end?: unknown }
  return isCalendarDay(start) && isCalendarDay(end)
}

/** 주소에서 구간을 읽는다. 시작·종료가 각각 한 번씩 있고 형식이 맞을 때만 값을 낸다. 중복 키는 어느 값인지 모호하므로 거절한다. */
export function parseResultsRange(search: URLSearchParams): ResultsRange | null {
  const starts = search.getAll('start')
  const ends = search.getAll('end')
  if (starts.length !== 1 || ends.length !== 1) return null
  const range = { start: starts[0], end: ends[0] }
  return isResultsRange(range) ? range : null
}

/** 구간을 주소 쿼리로 남긴다. `URLSearchParams` 로 인코딩해 쿼리를 끼워 넣지 못하게 한다. */
export function resultsRangeSearch(range: ResultsRange | null): string {
  if (!range) return ''
  return `?${new URLSearchParams({ start: range.start, end: range.end }).toString()}`
}

/** 구간을 서비스 기간(UTC 반개구간)으로 바꾼다. 시작은 시작일 0시, 끝은 종료일 다음 날 0시(배타). 기존 `gte`/`lt` 조회와 같은 모양이다. */
export function resultsRangePeriod(range: ResultsRange): ReportingPeriod {
  return {
    start: `${range.start}T00:00:00.000Z`,
    end: new Date(utcDayMs(range.end) + DAY_MS).toISOString(),
  }
}

/** 구간이 거절되는 이유. 화면은 이 코드로 사유 한 줄을 고르고, 서버는 문구 하나로 닫는다. */
export type ResultsRangeIssue = 'INVALID' | 'REVERSED' | 'TOO_LONG' | 'FUTURE'

/**
 * 규칙: 실제 달력일 두 개, 시작 ≤ 종료, 길이 ≤ MAX_REPORTING_RANGE_DAYS,
 * 종료 다음 날 0시 ≤ 이번 주 종료 시각(오늘까지만, 미래 금지).
 */
export function resultsRangeIssue(range: ResultsRange, now: Date = new Date()): ResultsRangeIssue | null {
  if (!isResultsRange(range)) return 'INVALID'
  const startMs = utcDayMs(range.start)
  const endMs = utcDayMs(range.end)
  if (endMs < startMs) return 'REVERSED'
  const days = (endMs - startMs) / DAY_MS + 1
  if (days > MAX_REPORTING_RANGE_DAYS) return 'TOO_LONG'
  if (endMs + DAY_MS > currentReportingEnd(now).getTime()) return 'FUTURE'
  return null
}

/**
 * 서버가 받는 구간이면 null, 아니면 사용자 문구. 어긋나도 다른 기간으로 줄이지 않는다.
 * 사유별 문구는 화면(`results-view`)이 고르고, 400 본문은 하나로 고정한다.
 */
export function resultsRangeProblem(range: ResultsRange, now: Date = new Date()): string | null {
  return resultsRangeIssue(range, now) === null ? null : RESULTS_RANGE_ERROR
}
