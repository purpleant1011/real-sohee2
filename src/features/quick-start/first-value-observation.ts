import { recordFunnelEvent, type FunnelEventName } from './funnel-events'
import type { QuickPostReservation } from './quick-post-credits'

/**
 * ANI-1602: first-value funnel (signup -> photo -> generation -> approval -> publish) and
 * generation cost / trial credit observation, read from the workspace-scoped `funnel_events` table.
 *
 * Honesty contract: "no events" is NOT "0". A metric is only a real number when an emitter for it is wired in
 * production code and the funnel actually reached the preceding step; otherwise it is NOT_OBSERVED (미관측).
 */
export const FIRST_VALUE_STEPS = ['signup_completed', 'photo_uploaded', 'draft_ready', 'publish_confirmed', 'publish_verified'] as const
export type FirstValueStep = (typeof FIRST_VALUE_STEPS)[number]

/** User-facing labels live next to the codes so screens never print the English event names. */
export const FIRST_VALUE_STEP_LABELS: Record<FirstValueStep, string> = {
  signup_completed: '가입',
  photo_uploaded: '사진 올리기',
  draft_ready: '홍보물 만들기',
  publish_confirmed: '승인',
  publish_verified: '게시 확인',
}

export const COST_EVENT = 'generation_cost_settled' as const
export const TRIAL_EVENT = 'trial_credit_debited' as const

/**
 * Events that production code really emits. Keep this list truthful: adding an event here without an emitter
 * would turn "미관측" into a fake 0. `trial_credit_debited` has no emitter yet (the settle RPC does not report
 * whether the credits were trial or paid), so it stays out until that attribution exists.
 */
export const WIRED_FIRST_VALUE_EVENTS: ReadonlySet<string> = new Set<string>([
  'signup_completed', 'photo_uploaded', 'draft_ready', 'publish_confirmed', 'publish_verified', COST_EVENT,
])

export interface ObservationEvent {
  event: string
  workspace_id?: string | null
  user_id?: string | null
  occurred_at: string
  properties?: Record<string, unknown> | null
}

export type NotObservedReason = 'EMITTER_NOT_WIRED' | 'NO_EVENTS' | 'PRECEDING_STEP_NOT_REACHED' | 'INSUFFICIENT_INPUT'

export type StepObservation =
  | { event: FirstValueStep; label: string; state: 'OBSERVED'; reached: number }
  | { event: FirstValueStep; label: string; state: 'NOT_OBSERVED'; reached: null; reason: NotObservedReason }

export type CreditObservation =
  | { state: 'OBSERVED'; settledCount: number; totalCredits: number; invalidCount: number }
  | { state: 'NOT_OBSERVED'; settledCount: null; totalCredits: null; invalidCount: number; reason: NotObservedReason }

export type ReconciliationObservation =
  | { state: 'OBSERVED'; mismatchedReservations: string[] }
  | { state: 'NOT_OBSERVED'; mismatchedReservations: null; reason: NotObservedReason }

export interface FirstValueObservation {
  workspaceId: string
  steps: StepObservation[]
  generationCost: CreditObservation
  trialDebit: CreditObservation
  costReconciliation: ReconciliationObservation
  /** Rows dropped because they belonged to another workspace or carried no workspace at all. */
  excludedEvents: number
}

function validCredits(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function ts(value: string): number | null {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function summarizeCredits(events: ObservationEvent[], wired: boolean): { observation: CreditObservation; byReservation: Map<string, number> } {
  const byReservation = new Map<string, number>()
  let invalid = 0
  for (const event of events) {
    const reservationId = event.properties?.reservationId
    const credits = event.properties?.credits
    if (typeof reservationId !== 'string' || !reservationId || !validCredits(credits)) { invalid++; continue }
    if (!byReservation.has(reservationId)) byReservation.set(reservationId, credits)
  }
  if (!wired && !byReservation.size) {
    return { byReservation, observation: { state: 'NOT_OBSERVED', settledCount: null, totalCredits: null, invalidCount: invalid, reason: 'EMITTER_NOT_WIRED' } }
  }
  if (!byReservation.size) {
    return { byReservation, observation: { state: 'NOT_OBSERVED', settledCount: null, totalCredits: null, invalidCount: invalid, reason: 'NO_EVENTS' } }
  }
  const totalCredits = [...byReservation.values()].reduce((sum, credits) => sum + credits, 0)
  return { byReservation, observation: { state: 'OBSERVED', settledCount: byReservation.size, totalCredits, invalidCount: invalid } }
}

export function summarizeFirstValueObservation(
  allEvents: readonly ObservationEvent[],
  { workspaceId, wiredEvents = WIRED_FIRST_VALUE_EVENTS }: { workspaceId: string; wiredEvents?: ReadonlySet<string> },
): FirstValueObservation {
  // Tenant isolation is enforced here again so a mis-scoped query can never leak another workspace into a total.
  const events = allEvents.filter((event) => event.workspace_id === workspaceId && ts(event.occurred_at) !== null)
  const excludedEvents = allEvents.filter((event) => event.workspace_id !== workspaceId).length

  const signupAt = new Map<string, number>()
  for (const event of events) {
    if (event.event !== 'signup_completed' || !event.user_id) continue
    const at = ts(event.occurred_at)!
    const known = signupAt.get(event.user_id)
    if (known === undefined || at < known) signupAt.set(event.user_id, at)
  }

  const steps: StepObservation[] = []
  FIRST_VALUE_STEPS.forEach((step, index) => {
    const label = FIRST_VALUE_STEP_LABELS[step]
    const users = new Set<string>()
    let anonymousSignups = 0
    for (const event of events) {
      if (event.event !== step) continue
      if (step === 'signup_completed') {
        if (event.user_id) users.add(event.user_id)
        else anonymousSignups++
        continue
      }
      const signedUpAt = event.user_id ? signupAt.get(event.user_id) : undefined
      // Later steps only count users whose signup is on record, at or after that signup (no orphan joins).
      if (event.user_id && signedUpAt !== undefined && ts(event.occurred_at)! >= signedUpAt) users.add(event.user_id)
    }
    const reached = users.size + anonymousSignups
    if (reached > 0) { steps.push({ event: step, label, state: 'OBSERVED', reached }); return }
    if (!wiredEvents.has(step)) { steps.push({ event: step, label, state: 'NOT_OBSERVED', reached: null, reason: 'EMITTER_NOT_WIRED' }); return }
    const previous = index > 0 ? steps[index - 1] : undefined
    if (!previous) { steps.push({ event: step, label, state: 'NOT_OBSERVED', reached: null, reason: 'NO_EVENTS' }); return }
    if (previous.state === 'OBSERVED' && previous.reached > 0) { steps.push({ event: step, label, state: 'OBSERVED', reached: 0 }); return }
    steps.push({ event: step, label, state: 'NOT_OBSERVED', reached: null, reason: 'PRECEDING_STEP_NOT_REACHED' })
  })

  const cost = summarizeCredits(events.filter((event) => event.event === COST_EVENT), wiredEvents.has(COST_EVENT))
  const trial = summarizeCredits(events.filter((event) => event.event === TRIAL_EVENT), wiredEvents.has(TRIAL_EVENT))

  let costReconciliation: ReconciliationObservation = { state: 'NOT_OBSERVED', mismatchedReservations: null, reason: 'INSUFFICIENT_INPUT' }
  if (cost.observation.state === 'OBSERVED' && trial.observation.state === 'OBSERVED') {
    const mismatched = [...cost.byReservation].filter(([id, credits]) => trial.byReservation.get(id) !== credits).map(([id]) => id)
    for (const id of trial.byReservation.keys()) if (!cost.byReservation.has(id)) mismatched.push(id)
    costReconciliation = { state: 'OBSERVED', mismatchedReservations: mismatched.sort() }
  }

  return { workspaceId, steps, generationCost: cost.observation, trialDebit: trial.observation, costReconciliation, excludedEvents }
}

type FunnelAdmin = Parameters<typeof recordFunnelEvent>[0]['admin']

/** Called only after the settle RPC returned a verified `settled` reservation. Best-effort: never blocks billing. */
export async function recordGenerationCostSettled({ admin, workspaceId, userId, reservation }: {
  admin: FunnelAdmin
  workspaceId: string
  userId: string | null
  reservation: QuickPostReservation
}): Promise<void> {
  try {
    await recordFunnelEvent({
      admin, workspaceId, userId, event: COST_EVENT as FunnelEventName,
      properties: { reservationId: reservation.reservationId, credits: reservation.requestedCredits, operationKey: reservation.operationKey },
      dedupeKey: `${COST_EVENT}:${reservation.reservationId}`,
    })
  } catch {
    console.warn('[first-value-observation] cost event write failed')
  }
}

/** Called only after the asset row was confirmed with its rights status. Best-effort: never blocks the upload. */
export async function recordPhotoUploaded({ admin, workspaceId, userId, assetId }: {
  admin: FunnelAdmin
  workspaceId: string
  userId: string | null
  assetId: string
}): Promise<void> {
  try {
    await recordFunnelEvent({
      admin, workspaceId, userId, event: 'photo_uploaded',
      properties: { assetId }, dedupeKey: `photo_uploaded:${assetId}`,
    })
  } catch {
    console.warn('[first-value-observation] photo event write failed')
  }
}
