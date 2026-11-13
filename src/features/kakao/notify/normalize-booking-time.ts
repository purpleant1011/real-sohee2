/**
 * 예약 일시 KST(+09:00) 정규화 순수 함수
 *
 * [요구 규약]
 * 1. 시간대 없는 'YYYY-MM-DD HH:mm' / 'YYYY-MM-DDTHH:mm(:ss)' 입력은
 *    KST(+09:00)로 해석해 'YYYY-MM-DDTHH:mm:ss+09:00' 으로 정규화한다.
 * 2. Z 나 오프셋([+-]HH:mm 등)이 이미 포함된 유효한 ISO 일시는 그대로 유지한다.
 * 3. 2026-02-31 등 날짜/시간 정합성이 어긋나거나 지원하지 않는 형식은 null을 반환한다 (Fail-Closed).
 */

const WITH_TIMEZONE_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?)$/i

const NO_TIMEZONE_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false

  const check = new Date(Date.UTC(year, month - 1, day))
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() + 1 === month &&
    check.getUTCDate() === day
  )
}

function isValidTime(hour: number, minute: number, second: number): boolean {
  return (
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  )
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function normalizeBookingStartsAtKst(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null
  }

  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  // 1. Z 나 오프셋이 이미 있는 경우
  const tzMatch = trimmed.match(WITH_TIMEZONE_REGEX)
  if (tzMatch) {
    const year = parseInt(tzMatch[1], 10)
    const month = parseInt(tzMatch[2], 10)
    const day = parseInt(tzMatch[3], 10)
    const hour = parseInt(tzMatch[4], 10)
    const minute = parseInt(tzMatch[5], 10)
    const second = tzMatch[6] ? parseInt(tzMatch[6], 10) : 0

    if (!isValidCalendarDate(year, month, day)) return null
    if (!isValidTime(hour, minute, second)) return null

    if (tzMatch[8] && tzMatch[9]) {
      const offHour = parseInt(tzMatch[9], 10)
      const offMin = tzMatch[10] ? parseInt(tzMatch[10], 10) : 0
      if (offHour > 23 || offMin > 59) return null
    }

    return trimmed
  }

  // 2. 시간대 없는 경우: KST(+09:00)로 보정
  const noTzMatch = trimmed.match(NO_TIMEZONE_REGEX)
  if (noTzMatch) {
    const year = parseInt(noTzMatch[1], 10)
    const month = parseInt(noTzMatch[2], 10)
    const day = parseInt(noTzMatch[3], 10)
    const hour = parseInt(noTzMatch[4], 10)
    const minute = parseInt(noTzMatch[5], 10)
    const second = noTzMatch[6] ? parseInt(noTzMatch[6], 10) : 0

    if (!isValidCalendarDate(year, month, day)) return null
    if (!isValidTime(hour, minute, second)) return null

    return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+09:00`
  }

  return null
}
