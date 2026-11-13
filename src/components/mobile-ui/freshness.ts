/** 확인 시각의 '시점' 표기. prefix 와 붙일 때 `확인` 이 겹치지 않도록 시점만 돌려준다. 값이 없거나 해석 불가면 null. */
export function formatCheckedMoment(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  const hhmm = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(t)
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)
  if (day(t) === day(now)) return hhmm
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (day(t) === day(yesterday)) return `어제 ${hhmm}`
  const md = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(t)
  return `${md} ${hhmm}`
}

/** 확인 시각 표기. 실제 시각만 받는다 — 값이 없거나 해석 불가면 null(표시하지 않음, 임의 시각 생성 금지). */
export function formatCheckedAt(iso: string | null | undefined, now: Date = new Date()): string | null {
  const moment = formatCheckedMoment(iso, now)
  return moment ? `${moment} 확인` : null
}
