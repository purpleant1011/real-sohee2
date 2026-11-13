/**
 * KST (Asia/Seoul, UTC+9) 일시 포맷터
 *
 * [규약 및 제약사항]
 * 1. Intl 의존성 배제: Cloudflare Workers 및 격리 환경 호환을 위해 순수 계산만으로 KST 변환 수행.
 * 2. 표기 규격: 'YYYY년 M월 D일(요일) 오전|오후 H:MM' (분은 항상 2자리 패딩, 월·일·시는 1~2자리).
 * 3. 자정/정오 규약: 00:00 KST -> '오전 12:00', 12:00 KST -> '오후 12:00'.
 * 4. Fail-Closed: 잘못된 입력(non-string, 빈값, 오프셋 누락, 날짜 초과 등) 시 null 반환.
 */

const KOREAN_DAY_OF_WEEK = ['일', '월', '화', '수', '목', '금', '토'] as const

const ISO_DATETIME_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?)$/i

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export function formatKstDateTime(iso: unknown): string | null {
  if (typeof iso !== 'string') {
    return null
  }

  const trimmed = iso.trim()
  if (!trimmed) {
    return null
  }

  const match = trimmed.match(ISO_DATETIME_REGEX)
  if (!match) {
    return null
  }

  const year = parseInt(match[1], 10)
  const month = parseInt(match[2], 10)
  const day = parseInt(match[3], 10)
  const hour = parseInt(match[4], 10)
  const minute = parseInt(match[5], 10)
  const second = match[6] ? parseInt(match[6], 10) : 0

  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (hour < 0 || hour > 23) return null
  if (minute < 0 || minute > 59) return null
  if (second < 0 || second > 59) return null

  // 윤년 및 해당 월의 일수 정합성 검증
  const check = new Date(Date.UTC(year, month - 1, day))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null
  }

  let offsetMinutes = 0
  if (match[7] && match[7].toUpperCase() === 'Z') {
    offsetMinutes = 0
  } else if (match[8] && match[9]) {
    const sign = match[8] === '-' ? -1 : 1
    const offHour = parseInt(match[9], 10)
    const offMin = match[10] ? parseInt(match[10], 10) : 0
    if (offHour > 23 || offMin > 59) return null
    offsetMinutes = sign * (offHour * 60 + offMin)
  } else {
    return null
  }

  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second) -
    offsetMinutes * 60 * 1000
  const kstMs = utcMs + KST_OFFSET_MS
  const kstDate = new Date(kstMs)

  const kYear = kstDate.getUTCFullYear()
  const kMonth = kstDate.getUTCMonth() + 1
  const kDay = kstDate.getUTCDate()
  const kDow = KOREAN_DAY_OF_WEEK[kstDate.getUTCDay()]
  const kHours24 = kstDate.getUTCHours()
  const kMinutes = String(kstDate.getUTCMinutes()).padStart(2, '0')

  const period = kHours24 < 12 ? '오전' : '오후'
  const kHours12 = kHours24 % 12 === 0 ? 12 : kHours24 % 12

  return `${kYear}년 ${kMonth}월 ${kDay}일(${kDow}) ${period} ${kHours12}:${kMinutes}`
}
