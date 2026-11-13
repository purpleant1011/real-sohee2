import { z } from 'zod'

const localDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/
const numericOffsetTimezonePattern = /^[+-]\d{2}(?::?\d{2})?$/

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return days[month - 1] ?? 0
}

function hasRealCalendarDateTime(match: RegExpExecArray): boolean {
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  )
}

function isValidLocalDateTime(value: string): boolean {
  const match = localDateTimePattern.exec(value)

  return match !== null && hasRealCalendarDateTime(match)
}

export function isValidIanaTimezone(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    numericOffsetTimezonePattern.test(value)
  ) {
    return false
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

export const scheduleSchema = z.object({
  workspaceId: z.string().uuid(),
  approvalId: z.string().uuid(),
  versionId: z.string().uuid(),
  channelConnectionId: z.string().uuid(),
  scheduledLocal: z.string().refine(isValidLocalDateTime),
  timezone: z.string().refine(isValidIanaTimezone),
})

export const conflictSlotSchema = z.object({
  scheduleId: z.string().uuid().optional(),
  channelConnectionId: z.string().uuid(),
  scheduledAtUtc: z.union([
    z.string().datetime({ offset: true }),
    z.string().datetime({ offset: true, precision: -1 }),
  ]),
})

export type ScheduleInput = z.infer<typeof scheduleSchema>
export type ConflictSlot = z.infer<typeof conflictSlotSchema>
