import { parseAsString, parseAsStringLiteral } from 'nuqs'

export const scheduleKinds = ['all', 'content', 'customer'] as const
export const scheduleStatuses = ['all', 'upcoming', 'publishing', 'completed', 'recovery'] as const

export const scheduleQueryParsers = {
  kind: parseAsStringLiteral(scheduleKinds).withDefault('all'),
  selected: parseAsString,
  status: parseAsStringLiteral(scheduleStatuses).withDefault('all'),
}

export function parseScheduleQuery(input: Readonly<Record<string, string | null | undefined>>) {
  return {
    kind: scheduleQueryParsers.kind.parse(input.kind ?? '') ?? 'all',
    selected: input.selected ? scheduleQueryParsers.selected.parse(input.selected) : null,
    status: scheduleQueryParsers.status.parse(input.status ?? '') ?? 'all',
  }
}
