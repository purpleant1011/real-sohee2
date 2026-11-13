// Execution state is not an independent verification of the business outcome.
const STATUSES = [
  'queued', 'running', 'planning', 'executing', 'verifying', 'cancel_requested',
  'awaiting_approval', 'succeeded', 'completed', 'needs_attention', 'failed',
  'cancelled', 'partially_completed',
] as const

export type ActivityRunStatus = typeof STATUSES[number]
export const isActivityRunStatus = (value: unknown): value is ActivityRunStatus =>
  typeof value === 'string' && (STATUSES as readonly string[]).includes(value)

export const isActivityRunActive = (status: ActivityRunStatus): boolean =>
  ['queued', 'running', 'planning', 'executing', 'verifying', 'cancel_requested'].includes(status)
