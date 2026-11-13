/**
 * D-7 — 고객에게 나가는 예약 안내 시각은 **사업장 timezone** 으로 표기한다.
 *
 * 결함: `service.ts` 가 `startsAt.slice(0, 16)` 로 UTC ISO 문자열을 그대로 잘라 써서
 * 14:00(KST) 슬롯이 `2026-10-29 05:00` 으로 고객에게 전달됐다. 9시간 어긋난 시각은
 * 예약 안내에서 치명적이다(손님이 9시간 일찍 온다).
 *
 * 원칙:
 * - 하드코딩 `+9` 금지. `Intl.DateTimeFormat` 에 `timeZone` 을 넘겨 계산한다.
 * - 서버 로컬 TZ 와 무관하게 같은 결과여야 한다(CI 러너는 UTC).
 */

const KST = 'Asia/Seoul'

export interface SlotTimeFormatInput {
  startsAt: string
  timezone?: string | null
}

/**
 * `10월 29일 (목) 오후 2:00` 형태. 사업장 timezone 이 한국이 아니면 끝에 시간대를 덧붙인다.
 * 값이 올바르지 않으면 원본 문자열을 그대로 돌려준다(추측해서 다른 시각을 만들지 않는다).
 */
export function formatSlotTimeForCustomer(input: SlotTimeFormatInput): string {
  const timezone = input.timezone?.trim() || KST
  const ms = Date.parse(input.startsAt)
  if (!Number.isFinite(ms)) return input.startsAt

  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    }).formatToParts(new Date(ms))
  } catch {
    // Unknown IANA zone: do not invent a time, hand back what we were given.
    return input.startsAt
  }

  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  const month = pick('month')
  const day = pick('day')
  const hourRaw = pick('hour')
  const minute = pick('minute')
  const weekdayEn = pick('weekday')
  if (!month || !day || !hourRaw || !minute || !weekdayEn) return input.startsAt

  const weekdayKo = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayEn)
  if (weekdayKo < 0) return input.startsAt

  // hour12:false renders midnight as 24 in some ICU builds; normalise before splitting AM/PM.
  const hour24 = Number(hourRaw) % 24
  const meridiem = hour24 < 12 ? '오전' : '오후'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  const zoneSuffix = timezone === KST ? '' : ` (${timezone})`

  return `${Number(month)}월 ${Number(day)}일 (${'일월화수목금토'[weekdayKo]}) ${meridiem} ${hour12}:${minute}${zoneSuffix}`
}

export { KST as DEFAULT_SLOT_TIMEZONE }
