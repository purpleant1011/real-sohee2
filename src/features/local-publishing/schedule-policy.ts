export type LocalScheduleState = 'not_due' | 'auto_execute' | 'reconfirmation_required'

const AUTO_EXECUTE_GRACE_MS = 30 * 60 * 1000

export function classifyLocalSchedule(now: string, publishAt: string): LocalScheduleState {
  const observedAtMs = Date.parse(now)
  const scheduledAtMs = Date.parse(publishAt)

  if (!Number.isFinite(observedAtMs) || !Number.isFinite(scheduledAtMs)) {
    throw new Error('INVALID_SCHEDULE_TIME')
  }

  const delayMs = observedAtMs - scheduledAtMs
  if (delayMs < 0) return 'not_due'
  return delayMs <= AUTO_EXECUTE_GRACE_MS ? 'auto_execute' : 'reconfirmation_required'
}
