import type { VaultPeriod } from './types'

export interface PeriodBoundsResult {
  start: string | null
  end: string | null
  isUnscheduled: boolean
  isAll: boolean
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function toKstDateParts(date: Date): { year: number; month: number; date: number; day: number; kstMillis: number } {
  const kstMillis = date.getTime() + KST_OFFSET_MS
  const kst = new Date(kstMillis)
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    date: kst.getUTCDate(),
    day: kst.getUTCDay(),
    kstMillis,
  }
}

function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getLastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Calculates date bounds in KST (UTC+9) for vault query filtering.
 *
 * Boundary rules:
 * - Sunday 23:59:59 KST belongs to the ending week.
 * - Monday 00:00:00 KST starts the next week.
 * - Returns date strings in 'YYYY-MM-DD' format.
 */
export function periodBounds(
  period: VaultPeriod,
  now: Date | string | number = new Date(),
  ym?: string,
): PeriodBoundsResult {
  if (period === 'unscheduled') {
    return { start: null, end: null, isUnscheduled: true, isAll: false }
  }

  if (period === 'all') {
    return { start: null, end: null, isUnscheduled: false, isAll: true }
  }

  const nowDate = now instanceof Date ? now : new Date(now)
  const { year, month, day, kstMillis } = toKstDateParts(nowDate)

  if (period === 'month') {
    if (ym && /^\d{4}-\d{2}$/.test(ym)) {
      const [yStr, mStr] = ym.split('-')
      const targetYear = Number(yStr)
      const targetMonth = Number(mStr)
      const lastDay = getLastDayOfMonth(targetYear, targetMonth)
      return {
        start: `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`,
        end: `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
        isUnscheduled: false,
        isAll: false,
      }
    }

    const lastDay = getLastDayOfMonth(year, month)
    return {
      start: `${year}-${String(month).padStart(2, '0')}-01`,
      end: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      isUnscheduled: false,
      isAll: false,
    }
  }

  // Monday = 1, Sunday = 0
  const diffToMonday = day === 0 ? -6 : 1 - day
  const oneDayMs = 24 * 60 * 60 * 1000

  const thisMondayMillis = kstMillis + diffToMonday * oneDayMs
  const thisSundayMillis = thisMondayMillis + 6 * oneDayMs

  if (period === 'this_week') {
    return {
      start: formatUtcDate(new Date(thisMondayMillis)),
      end: formatUtcDate(new Date(thisSundayMillis)),
      isUnscheduled: false,
      isAll: false,
    }
  }

  if (period === 'next_week') {
    const nextMondayMillis = thisMondayMillis + 7 * oneDayMs
    const nextSundayMillis = thisSundayMillis + 7 * oneDayMs
    return {
      start: formatUtcDate(new Date(nextMondayMillis)),
      end: formatUtcDate(new Date(nextSundayMillis)),
      isUnscheduled: false,
      isAll: false,
    }
  }

  return { start: null, end: null, isUnscheduled: false, isAll: true }
}
