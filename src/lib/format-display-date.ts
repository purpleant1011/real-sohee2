const weekdayLabels: Readonly<Record<string, string>> = {
  Sun: '일', Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토',
}

function displayParts(value: string | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone,
  }).formatToParts(new Date(value))
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return {
    year: byType.get('year') ?? '0000',
    month: byType.get('month') ?? '00',
    day: byType.get('day') ?? '00',
    hour: byType.get('hour') ?? '00',
    minute: byType.get('minute') ?? '00',
  }
}

export function formatKoreanDateTime(value: string | Date, timezone = 'Asia/Seoul') {
  const parts = displayParts(value, timezone)
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`
}

export function formatKoreanDay(value: string | Date, timezone = 'Asia/Seoul') {
  const parts = displayParts(value, timezone)
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone })
    .format(new Date(value))
  return `${Number(parts.month)}월 ${Number(parts.day)}일 (${weekdayLabels[weekday] ?? weekday})`
}

export function formatKoreanMonthDayTime(value: string | Date, timezone = 'Asia/Seoul') {
  const parts = displayParts(value, timezone)
  return `${Number(parts.month)}월 ${Number(parts.day)}일 ${parts.hour}:${parts.minute}`
}

export function formatKoreanTime(value: string | Date, timezone = 'Asia/Seoul') {
  const parts = displayParts(value, timezone)
  return `${parts.hour}:${parts.minute}`
}
