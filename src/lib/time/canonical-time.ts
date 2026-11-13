/**
 * Canonical Time & Freshness SSOT (ANI-848)
 * 
 * Strict Invariants:
 * 1. Default timezone is strictly Asia/Seoul (KST).
 * 2. If data age exceeds threshold (default 15 mins for operational runtime, 60 mins for analytical reporting),
 *    never claim "실시간".
 * 3. Consistent relative and absolute formatting across all pages.
 */

export const CANONICAL_TIMEZONE = 'Asia/Seoul'
export const DEFAULT_OPERATIONAL_FRESHNESS_THRESHOLD_MINUTES = 15
export const DEFAULT_ANALYTICAL_FRESHNESS_THRESHOLD_MINUTES = 60

export type FreshnessGrade = 'FRESH' | 'WARM' | 'STALE'

export interface FreshnessAssessment {
  isStale: boolean
  ageMinutes: number
  freshnessGrade: FreshnessGrade
  displayLabel: string
}

/**
 * Parses an input timestamp safely into a valid Date object.
 */
export function parseCanonicalDate(input: string | Date | number): Date {
  if (input instanceof Date) return input
  const d = new Date(input)
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date input: ${String(input)}`)
  }
  return d
}

/**
 * Formats a timestamp into canonical Korean standard format in Asia/Seoul:
 * e.g., "2026. 09. 06. 15:30"
 */
export function formatCanonicalDateTime(
  input: string | Date | number,
  options?: { includeSeconds?: boolean; includeYear?: boolean }
): string {
  const d = parseCanonicalDate(input)
  const includeYear = options?.includeYear ?? true
  const includeSeconds = options?.includeSeconds ?? false

  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: CANONICAL_TIMEZONE,
    year: includeYear ? 'numeric' : undefined,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: false,
  })

  return formatter.format(d)
}

/**
 * Returns human-readable relative time in Korean:
 * e.g., "방금 전", "3분 전", "2시간 전", "어제", "N일 전"
 */
export function formatRelativeTimeKorean(
  input: string | Date | number,
  baseDate: Date = new Date()
): string {
  const target = parseCanonicalDate(input)
  const diffMs = baseDate.getTime() - target.getTime()
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 0) return '방금 전'
  if (diffSec < 60) return '방금 전'

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}분 전`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}시간 전`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return '어제'
  if (diffDays < 30) return `${diffDays}일 전`

  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `${diffMonths}개월 전`

  return formatCanonicalDateTime(target, { includeYear: true, includeSeconds: false })
}

/**
 * Evaluates freshness of a dataset or snapshot.
 */
export function evaluateFreshness(
  input: string | Date | number,
  thresholdMinutes: number = DEFAULT_OPERATIONAL_FRESHNESS_THRESHOLD_MINUTES,
  baseDate: Date = new Date()
): FreshnessAssessment {
  const target = parseCanonicalDate(input)
  const ageMs = Math.max(0, baseDate.getTime() - target.getTime())
  const ageMinutes = Math.floor(ageMs / (60 * 1000))

  let freshnessGrade: FreshnessGrade
  let isStale = false

  if (ageMinutes <= 5) {
    freshnessGrade = 'FRESH'
  } else if (ageMinutes <= thresholdMinutes) {
    freshnessGrade = 'WARM'
  } else {
    freshnessGrade = 'STALE'
    isStale = true
  }

  let displayLabel: string
  if (freshnessGrade === 'FRESH') {
    displayLabel = '실시간 정상'
  } else if (freshnessGrade === 'WARM') {
    displayLabel = `${ageMinutes}분 전 동기화`
  } else {
    displayLabel = `${ageMinutes}분 전 데이터 (동기화 대기)`
  }

  return {
    isStale,
    ageMinutes,
    freshnessGrade,
    displayLabel,
  }
}

/**
 * Prevents hallucinatory claims of "실시간" if the underlying data is stale.
 */
export function sanitizeRealtimeLabel(
  intendedLabel: string,
  updatedAtIso: string,
  thresholdMinutes: number = DEFAULT_OPERATIONAL_FRESHNESS_THRESHOLD_MINUTES,
  baseDate: Date = new Date()
): string {
  const assessment = evaluateFreshness(updatedAtIso, thresholdMinutes, baseDate)

  if (assessment.isStale && (intendedLabel.includes('실시간') || intendedLabel.includes('동기화 정상'))) {
    return `${assessment.ageMinutes}분 전 기준 (동기화 지연 감지)`
  }

  return intendedLabel
}
