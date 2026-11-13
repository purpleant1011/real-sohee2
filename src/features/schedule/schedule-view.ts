import type { InternalScheduleTask, ScheduleAttempt, ScheduleEntry } from './repository'

export type ScheduleStatusFilter = 'all' | 'upcoming' | 'publishing' | 'completed' | 'recovery'

export type ScheduleStatusCounts = Readonly<Record<ScheduleStatusFilter, number>>

export type ScheduleDayGroup = Readonly<{
  key: string
  label: string
  items: readonly ScheduleEntry[]
}>

export type DailyScheduleSummary = Readonly<{
  plannedCount: number
  completedCount: number
  needsAttentionCount: number
  completedChannels: readonly Readonly<{ channel: string; count: number }>[]
}>

export type DailyScheduleProjection = Readonly<{
  summary: DailyScheduleSummary
  activeSchedules: readonly ScheduleEntry[]
  completedSchedules: readonly ScheduleEntry[]
  activeInternalTasks: readonly InternalScheduleTask[]
  completedInternalTasks: readonly InternalScheduleTask[]
}>

type BuildDailyScheduleSummaryInput = Readonly<{
  selectedDate: string
  timezone: string
  schedules: readonly ScheduleEntry[]
  attempts: Readonly<Record<string, ScheduleAttempt>>
  planCount: number
  readyCount: number
  additionalAttentionCount: number
}>

const localDateFormatterCache = new Map<string, Intl.DateTimeFormat>()

function localDate(value: string, timezone: string) {
  let formatter = localDateFormatterCache.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    localDateFormatterCache.set(timezone, formatter)
  }
  const parts = formatter.formatToParts(new Date(value))
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${read('year')}-${read('month')}-${read('day')}`
}

function isValidCivilDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
}

export function resolveScheduleDate(candidate: string | undefined, now: Date, timezone: string) {
  if (candidate && isValidCivilDate(candidate)) return candidate
  return localDate(now.toISOString(), timezone)
}

export function scheduleActivityAt(schedule: ScheduleEntry, attempt?: ScheduleAttempt) {
  if (
    (schedule.status === 'published' || attempt?.status === 'succeeded')
    && attempt?.finished_at
  ) return attempt.finished_at
  return schedule.publish_at
}

export function isScheduleOnDate(
  schedule: ScheduleEntry,
  attempt: ScheduleAttempt | undefined,
  selectedDate: string,
  timezone: string,
) {
  return localDate(scheduleActivityAt(schedule, attempt), timezone) === selectedDate
}

export function buildDailyScheduleSummary(input: BuildDailyScheduleSummaryInput): DailyScheduleSummary {
  return buildDailyScheduleProjection(input).summary
}

export function buildDailyScheduleProjection(input: Pick<BuildDailyScheduleSummaryInput,
  'selectedDate' | 'timezone' | 'schedules' | 'attempts'> & Readonly<{
    internalTasks?: readonly InternalScheduleTask[]
  }>): DailyScheduleProjection {
  let plannedCount = 0
  let completedCount = 0
  let needsAttentionCount = 0
  const completedChannelCounts = new Map<string, number>()
  const activeSchedules: ScheduleEntry[] = []
  const completedSchedules: ScheduleEntry[] = []
  const activeInternalTasks: InternalScheduleTask[] = []
  const completedInternalTasks: InternalScheduleTask[] = []

  for (const schedule of input.schedules) {
    const attempt = input.attempts[schedule.id]
    if (!isScheduleOnDate(schedule, attempt, input.selectedDate, input.timezone)) continue
    const completed = schedule.status === 'published' || attempt?.status === 'succeeded'
    const needsAttention = schedule.status === 'failed' || schedule.status === 'unknown'
      || attempt?.status === 'failed' || attempt?.status === 'unknown'

    if (completed) {
      completedCount += 1
      completedSchedules.push(schedule)
      completedChannelCounts.set(schedule.channel, (completedChannelCounts.get(schedule.channel) ?? 0) + 1)
    } else if (schedule.status !== 'cancelled') {
      plannedCount += 1
      activeSchedules.push(schedule)
    }
    if (needsAttention) needsAttentionCount += 1
  }

  for (const task of input.internalTasks ?? []) {
    if (localDate(task.occurredAt, input.timezone) !== input.selectedDate || task.state === 'cancelled') continue
    if (task.state === 'completed') {
      completedCount += 1
      completedInternalTasks.push(task)
    } else {
      plannedCount += 1
      activeInternalTasks.push(task)
      if (task.state === 'needs_attention') needsAttentionCount += 1
    }
  }

  const byActivityTime = (left: ScheduleEntry, right: ScheduleEntry) => (
    scheduleActivityAt(left, input.attempts[left.id]).localeCompare(scheduleActivityAt(right, input.attempts[right.id]))
  )

  return Object.freeze({
    summary: Object.freeze({
      plannedCount,
      completedCount,
      needsAttentionCount,
      completedChannels: Object.freeze([...completedChannelCounts].map(([channel, count]) => Object.freeze({ channel, count }))),
    }),
    activeSchedules: Object.freeze(activeSchedules.sort(byActivityTime)),
    completedSchedules: Object.freeze(completedSchedules.sort(byActivityTime)),
    activeInternalTasks: Object.freeze(activeInternalTasks.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))),
    completedInternalTasks: Object.freeze(completedInternalTasks.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))),
  })
}

export function scheduleStatusFilter(status: ScheduleEntry['status']): Exclude<ScheduleStatusFilter, 'all'> {
  if (status === 'scheduled') return 'upcoming'
  if (status === 'publishing') return 'publishing'
  if (status === 'published' || status === 'cancelled') return 'completed'
  return 'recovery'
}

export function countScheduleStatuses(schedules: readonly ScheduleEntry[]): ScheduleStatusCounts {
  const counts: Record<ScheduleStatusFilter, number> = {
    all: schedules.length,
    upcoming: 0,
    publishing: 0,
    completed: 0,
    recovery: 0,
  }
  for (const schedule of schedules) counts[scheduleStatusFilter(schedule.status)] += 1
  return Object.freeze(counts)
}

function localDay(schedule: ScheduleEntry) {
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: schedule.timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'long',
  })
  const parts = Object.fromEntries(formatter.formatToParts(new Date(schedule.publish_at)).map((part) => [part.type, part.value]))
  const month = Number(parts.month)
  const day = Number(parts.day)
  return {
    key: `${parts.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    label: `${month}월 ${day}일 ${parts.weekday}`,
  }
}

export function groupSchedulesByDay(schedules: readonly ScheduleEntry[]): readonly ScheduleDayGroup[] {
  const sorted = [...schedules].sort((left, right) => left.publish_at.localeCompare(right.publish_at))
  const groups = new Map<string, { label: string; items: ScheduleEntry[] }>()
  for (const schedule of sorted) {
    const day = localDay(schedule)
    const group = groups.get(day.key)
    if (group) group.items.push(schedule)
    else groups.set(day.key, { label: day.label, items: [schedule] })
  }
  return Object.freeze([...groups.entries()].map(([key, group]) => Object.freeze({
    key,
    label: group.label,
    items: Object.freeze(group.items),
  })))
}
