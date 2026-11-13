import { SUMMARY_DAYS_BEFORE_END } from './config'

const DAY_MS = 24 * 60 * 60 * 1000

/** 남은 일수(올림). 종료일을 모르면 null("확인 전"). 이미 끝났으면 0. */
export function daysLeft(endsAt: string | null | undefined, now: Date): number | null {
  if (!endsAt) return null
  const end = new Date(endsAt).getTime()
  if (Number.isNaN(end)) return null
  return Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS))
}

/** 체험 종료 3일 전 구간(종료 당일 포함, 종료 후 제외) 판정. 종료일을 모르면 false. */
export function isTrialSummaryWindow(endsAt: string | null | undefined, now: Date): boolean {
  const left = daysLeft(endsAt, now)
  return left !== null && left > 0 && left <= SUMMARY_DAYS_BEFORE_END
}
