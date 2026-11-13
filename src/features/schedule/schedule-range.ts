import { conflictSlotSchema, isValidIanaTimezone } from './schedule-schema'

export type ScheduleViewport = 'desktop' | 'mobile'

export type ScheduleRange = {
  viewport: ScheduleViewport
  timezone: string
  startLocalDate: string
  endLocalDateExclusive: string
  label: string
}

type CivilDate = {
  year: number
  month: number
  day: number
}

const rangeErrorMessage = '일정 범위를 계산할 수 없습니다.'
const oneHourSeconds = 60 * 60
const maximumArrayLength = 2 ** 32 - 1
const maximumArrayIndex = maximumArrayLength - 1
const absoluteInstantPattern =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/

type PreciseInstant = {
  epochSecond: number
  fraction: string
}

function toCivilDate(now: Date, timezone: string): CivilDate {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    era: 'short',
  }).formatToParts(now)
  let year: number | undefined
  let month: number | undefined
  let day: number | undefined
  let era: string | undefined

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]

    if (part.type === 'year') year = Number(part.value)
    if (part.type === 'month') month = Number(part.value)
    if (part.type === 'day') day = Number(part.value)
    if (part.type === 'era') era = part.value
  }

  if (year === undefined || month === undefined || day === undefined || era !== 'AD') {
    throw new RangeError(rangeErrorMessage)
  }

  return assertRepresentableCivilDate({ year, month, day })
}

function civilDateAsUncheckedUtcDate(value: CivilDate): Date {
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(value.year, value.month - 1, value.day)
  return date
}

function assertRepresentableCivilDate(value: CivilDate): CivilDate {
  if (
    !Number.isInteger(value.year) ||
    value.year < 1 ||
    value.year > 9_999 ||
    !Number.isInteger(value.month) ||
    value.month < 1 ||
    value.month > 12 ||
    !Number.isInteger(value.day) ||
    value.day < 1 ||
    value.day > 31
  ) {
    throw new RangeError(rangeErrorMessage)
  }

  const date = civilDateAsUncheckedUtcDate(value)

  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() !== value.year ||
    date.getUTCMonth() + 1 !== value.month ||
    date.getUTCDate() !== value.day
  ) {
    throw new RangeError(rangeErrorMessage)
  }

  return value
}

function civilDateAsUtcDate(value: CivilDate): Date {
  return civilDateAsUncheckedUtcDate(assertRepresentableCivilDate(value))
}

function addCivilDays(value: CivilDate, days: number): CivilDate {
  const date = civilDateAsUtcDate(value)
  date.setUTCDate(date.getUTCDate() + days)

  return assertRepresentableCivilDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  })
}

function startOfWeek(value: CivilDate): CivilDate {
  const sundayBasedDay = civilDateAsUtcDate(value).getUTCDay()
  const daysSinceMonday = (sundayBasedDay + 6) % 7

  return addCivilDays(value, -daysSinceMonday)
}

function formatCivilDate(value: CivilDate): string {
  assertRepresentableCivilDate(value)
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
}

function parsePreciseInstant(value: string): PreciseInstant {
  const match = absoluteInstantPattern.exec(value)

  if (match === null) {
    throw new RangeError('Invalid absolute instant')
  }

  const wholeSecond = `${match[1]}:${match[2] ?? '00'}${match[4]}`
  const epochMilliseconds = Date.parse(wholeSecond)

  if (!Number.isFinite(epochMilliseconds) || epochMilliseconds % 1_000 !== 0) {
    throw new RangeError('Invalid absolute instant')
  }

  return {
    epochSecond: epochMilliseconds / 1_000,
    fraction: match[3] ?? '',
  }
}

function compareFractions(left: string, right: string): number {
  const comparisonLength = Math.max(left.length, right.length)

  for (let index = 0; index < comparisonLength; index += 1) {
    const leftDigit = index < left.length ? left.charCodeAt(index) : 48
    const rightDigit = index < right.length ? right.charCodeAt(index) : 48

    if (leftDigit < rightDigit) return -1
    if (leftDigit > rightDigit) return 1
  }

  return 0
}

function isWithinOneHour(left: PreciseInstant, right: PreciseInstant): boolean {
  const wholeSecondDifference = Math.abs(left.epochSecond - right.epochSecond)

  if (wholeSecondDifference < oneHourSeconds) return true
  if (wholeSecondDifference > oneHourSeconds) return false

  const later = left.epochSecond > right.epochSecond ? left : right
  const earlier = later === left ? right : left

  return compareFractions(later.fraction, earlier.fraction) <= 0
}

export function getScheduleRange(
  viewport: ScheduleViewport,
  now: Date,
  timezone: string,
): ScheduleRange {
  try {
    if (
      (viewport !== 'desktop' && viewport !== 'mobile') ||
      !(now instanceof Date) ||
      !Number.isFinite(now.getTime()) ||
      !isValidIanaTimezone(timezone)
    ) {
      throw new RangeError(rangeErrorMessage)
    }

    const today = toCivilDate(now, timezone)
    const start = viewport === 'desktop' ? startOfWeek(today) : today
    const endExclusive = addCivilDays(start, viewport === 'desktop' ? 7 : 30)
    const inclusiveEnd = addCivilDays(endExclusive, -1)
    const rangeName = viewport === 'desktop' ? '이번 주' : '다가오는 30일'
    const startLocalDate = formatCivilDate(start)
    const endLocalDateExclusive = formatCivilDate(endExclusive)

    return {
      viewport,
      timezone,
      startLocalDate,
      endLocalDateExclusive,
      label: `${rangeName} · ${startLocalDate}~${formatCivilDate(inclusiveEnd)} · ${timezone}`,
    }
  } catch {
    throw new RangeError(rangeErrorMessage)
  }
}

export function detectOneHourConflict(existing: unknown, candidate: unknown): boolean {
  try {
    const parsedCandidate = conflictSlotSchema.safeParse(candidate)

    if (!parsedCandidate.success || !Array.isArray(existing)) {
      return true
    }

    const collectionLength = existing.length

    if (
      !Number.isSafeInteger(collectionLength) ||
      collectionLength < 0 ||
      collectionLength > maximumArrayLength
    ) {
      return true
    }

    const ownKeys = Reflect.ownKeys(existing)
    const ownIndexKeys = new Set<string>()

    for (let keyIndex = 0; keyIndex < ownKeys.length; keyIndex += 1) {
      const key = ownKeys[keyIndex]

      if (typeof key !== 'string' || key.length === 0) {
        continue
      }

      const numericKey = Number(key)

      if (
        Number.isInteger(numericKey) &&
        numericKey >= 0 &&
        numericKey <= maximumArrayIndex &&
        String(numericKey) === key
      ) {
        if (numericKey >= collectionLength) {
          return true
        }

        ownIndexKeys.add(key)
      }
    }

    if (ownIndexKeys.size !== collectionLength) {
      return true
    }

    const candidateSlot = parsedCandidate.data
    const candidateTime = parsePreciseInstant(candidateSlot.scheduledAtUtc)

    for (let index = 0; index < collectionLength; index += 1) {
      if (!ownIndexKeys.has(String(index)) || !Object.hasOwn(existing, index)) {
        return true
      }

      const parsedExisting = conflictSlotSchema.safeParse(existing[index])

      if (!parsedExisting.success) {
        return true
      }

      const existingSlot = parsedExisting.data

      if (
        candidateSlot.scheduleId !== undefined &&
        candidateSlot.scheduleId === existingSlot.scheduleId
      ) {
        continue
      }

      if (
        candidateSlot.channelConnectionId === existingSlot.channelConnectionId &&
        isWithinOneHour(parsePreciseInstant(existingSlot.scheduledAtUtc), candidateTime)
      ) {
        return true
      }
    }

    return false
  } catch {
    return true
  }
}
