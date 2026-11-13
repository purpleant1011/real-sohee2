export type ScheduleRecommendation = Readonly<{
  scheduledAtUtc: string
  scheduledLocal: string
  reason: string
}>

type RecommendationInput = Readonly<{
  now: Date
  timezone: string
  channelConnectionId: string
  existingSchedules: readonly Readonly<{
    channelConnectionId: string
    scheduledAtUtc: string
  }>[]
  customerReservations: readonly Readonly<{ startsAt: string | null }>[]
  minimumLeadMinutes?: number
}>

const halfHourMs = 30 * 60 * 1000
const conflictWindowMs = 60 * 60 * 1000

function localParts(value: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]))
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    input: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`,
  }
}

function conflicts(candidateMs: number, values: readonly string[]) {
  return values.some((value) => Math.abs(new Date(value).getTime() - candidateMs) < conflictWindowMs)
}

export function recommendScheduleTimes(input: RecommendationInput): readonly ScheduleRecommendation[] {
  const minimumLeadMinutes = input.minimumLeadMinutes ?? 60
  const earliest = input.now.getTime() + minimumLeadMinutes * 60 * 1000
  let cursor = Math.ceil(earliest / halfHourMs) * halfHourMs
  const sameChannelSchedules = input.existingSchedules
    .filter((item) => item.channelConnectionId === input.channelConnectionId)
    .map((item) => item.scheduledAtUtc)
  const customerTimes = input.customerReservations.flatMap((item) => item.startsAt ? [item.startsAt] : [])
  const reasons = [
    '게시 전 확인 시간을 충분히 확보할 수 있어요.',
    '현재 예약된 게시와 겹치지 않는 시간이에요.',
    '운영 시간 안에서 여유 있게 준비할 수 있어요.',
  ]
  const recommendations: ScheduleRecommendation[] = []
  const limit = cursor + 14 * 24 * 60 * 60 * 1000

  while (cursor <= limit && recommendations.length < 3) {
    const candidate = new Date(cursor)
    const local = localParts(candidate, input.timezone)
    const inOperatingHours = local.hour >= 9 && (local.hour < 18 || (local.hour === 18 && local.minute === 0))
    if (
      inOperatingHours
      && !conflicts(cursor, sameChannelSchedules)
      && !conflicts(cursor, customerTimes)
    ) {
      recommendations.push(Object.freeze({
        scheduledAtUtc: candidate.toISOString(),
        scheduledLocal: local.input,
        reason: reasons[recommendations.length]!,
      }))
    }
    cursor += halfHourMs
  }

  return Object.freeze(recommendations)
}
