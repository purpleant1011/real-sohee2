export const FUNNEL_STEPS = [
  'signup_completed',
  'quickstart_shop_saved',
  'quickstart_tone_saved',
  'channel_connected',
  'draft_requested',
  'draft_ready',
  'preview_viewed',
  'revise_requested',
  'publish_confirmed',
  'publish_verified',
] as const

export type FunnelStep = (typeof FUNNEL_STEPS)[number]
export type FunnelEventName =
  | FunnelStep
  | 'publish_failed' | 'vault.saved' | 'vault.save_failed'
  | 'photo_uploaded' | 'generation_cost_settled' | 'trial_credit_debited'

export interface FunnelEvent {
  event: FunnelEventName
  occurred_at: string
  user_id?: string | null
  workspace_id?: string
}

type AdminClient = {
  from: (table: string) => {
    upsert: (row: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates: boolean }) => Promise<{ error: { message?: string } | null }>
  }
}

/** Telemetry is best-effort; never let an analytics write block onboarding or publishing. */
export async function recordFunnelEvent({ admin, workspaceId, userId, event, properties = {}, dedupeKey }: {
  admin: AdminClient
  workspaceId: string
  userId: string | null
  event: FunnelEventName
  properties?: Record<string, unknown>
  dedupeKey?: string
}): Promise<void> {
  try {
    // A non-null stable key is essential: PostgreSQL UNIQUE treats multiple NULLs as distinct.
    const key = dedupeKey?.trim() || `${event}:${userId ?? 'anonymous'}:${typeof properties.missionId === 'string' ? properties.missionId : 'first'}`
    const { error } = await admin.from('funnel_events').upsert(
      { workspace_id: workspaceId, user_id: userId, event, properties, dedupe_key: key },
      { onConflict: 'workspace_id,event,dedupe_key', ignoreDuplicates: true },
    )
    if (error) console.warn('[funnel-events] write failed', event)
  } catch {
    console.warn('[funnel-events] write failed', event)
  }
}

function timestamp(value: string): number | null {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** Earliest verified publish at or after signup; negative/unpaired intervals are excluded. */
export function computeTimeToFirstPost(events: readonly FunnelEvent[]): number | null {
  // Never join another user's publish with this user's signup in a multi-user workspace.
  const signups = events.filter((e) => e.event === 'signup_completed')
    .map((e) => ({ userId: e.user_id, at: timestamp(e.occurred_at) }))
    .filter((e): e is { userId: string | null | undefined; at: number } => e.at !== null)
    .sort((a, b) => a.at - b.at)
  if (!signups.length) return null
  const verified = events.filter((e) => e.event === 'publish_verified')
    .map((e) => ({ userId: e.user_id, at: timestamp(e.occurred_at) }))
    .filter((e): e is { userId: string | null | undefined; at: number } => e.at !== null)
  for (const signup of signups) {
    const first = verified.filter((e) => e.userId === signup.userId && e.at >= signup.at)
      .sort((a, b) => a.at - b.at)[0]
    if (first) return first.at - signup.at
  }
  return null
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const ordered = [...values].sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

export interface FunnelStageSummary {
  event: FunnelStep
  reached: number
  dropped: number
  medianFromPreviousMs: number | null
}

export interface FunnelSummary {
  cohortSize: number
  stages: FunnelStageSummary[]
  publishFailed: number
  medianTimeToFirstPostMs: number | null
  withinTenMinutes: number
}

/** Cohort = distinct signed-up users. Each stage counts only the earliest event after the preceding stage. */
export function summarizeFunnel(events: readonly FunnelEvent[]): FunnelSummary {
  const byUser = new Map<string, FunnelEvent[]>()
  for (const event of events) {
    // Events without a user cannot be attributed to a signup cohort reliably.
    if (!event.user_id || timestamp(event.occurred_at) === null) continue
    const group = byUser.get(event.user_id) ?? []
    group.push(event)
    byUser.set(event.user_id, group)
  }

  const reached = Array<number>(FUNNEL_STEPS.length).fill(0)
  const durations = FUNNEL_STEPS.map(() => [] as number[])
  const firstPostTimes: number[] = []
  let cohortSize = 0
  let publishFailed = 0
  let withinTenMinutes = 0

  for (const group of byUser.values()) {
    const sorted = [...group].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
    const signup = sorted.find((e) => e.event === 'signup_completed')
    if (!signup) continue
    cohortSize++
    const signupAt = Date.parse(signup.occurred_at)
    if (sorted.some((e) => e.event === 'publish_failed' && Date.parse(e.occurred_at) >= signupAt)) publishFailed++

    let previous = signupAt
    reached[0]++
    for (let i = 1; i < FUNNEL_STEPS.length; i++) {
      const current = sorted.find((e) => e.event === FUNNEL_STEPS[i] && Date.parse(e.occurred_at) >= previous)
      if (!current) {
        // Revisions are optional: users may confirm a correct first draft immediately.
        if (FUNNEL_STEPS[i] === 'revise_requested') continue
        break
      }
      const at = Date.parse(current.occurred_at)
      reached[i]++
      durations[i].push(at - previous)
      previous = at
    }
    const firstPost = computeTimeToFirstPost(sorted.filter((e) => Date.parse(e.occurred_at) >= signupAt))
    if (firstPost !== null) {
      firstPostTimes.push(firstPost)
      if (firstPost <= 600_000) withinTenMinutes++
    }
  }

  return {
    cohortSize,
    stages: FUNNEL_STEPS.map((event, i) => ({
      event,
      reached: reached[i],
      dropped: event === 'revise_requested' || i === FUNNEL_STEPS.length - 1 ? 0 : Math.max(0, reached[i] - reached[i + (event === 'preview_viewed' ? 2 : 1)]),
      medianFromPreviousMs: median(durations[i]),
    })),
    publishFailed,
    medianTimeToFirstPostMs: median(firstPostTimes),
    withinTenMinutes,
  }
}
