import { describe, expect, it, vi } from 'vitest'
import {
  FIRST_VALUE_STEPS, WIRED_FIRST_VALUE_EVENTS, recordGenerationCostSettled, summarizeFirstValueObservation,
  type ObservationEvent,
} from '../first-value-observation'

const WS = 'ws-a'
const at = (minute: number) => new Date(Date.UTC(2026, 9, 22, 0, minute)).toISOString()
const ev = (event: string, minute: number, user = 'u1', workspace = WS, properties: Record<string, unknown> = {}): ObservationEvent =>
  ({ event, workspace_id: workspace, user_id: user, occurred_at: at(minute), properties })
const ALL_WIRED = new Set<string>([...FIRST_VALUE_STEPS, 'generation_cost_settled', 'trial_credit_debited'])
const stepOf = (summary: ReturnType<typeof summarizeFirstValueObservation>, name: string) => summary.steps.find((s) => s.event === name)!

describe('first value funnel: observed vs not observed', () => {
  it('declares the five requested steps in order', () => {
    expect(FIRST_VALUE_STEPS).toEqual(['signup_completed', 'photo_uploaded', 'draft_ready', 'publish_confirmed', 'publish_verified'])
  })

  it('reports every step and money metric as NOT_OBSERVED (never 0) when there are no events', () => {
    const summary = summarizeFirstValueObservation([], { workspaceId: WS, wiredEvents: ALL_WIRED })
    for (const step of summary.steps) expect(step).toMatchObject({ state: 'NOT_OBSERVED', reached: null })
    expect(summary.generationCost).toMatchObject({ state: 'NOT_OBSERVED', totalCredits: null })
    expect(summary.trialDebit).toMatchObject({ state: 'NOT_OBSERVED', totalCredits: null })
    expect(summary.costReconciliation.state).toBe('NOT_OBSERVED')
  })

  it('counts distinct users that reached each step and treats a wired step nobody reached as a real 0', () => {
    const events = [
      ev('signup_completed', 0), ev('photo_uploaded', 1), ev('photo_uploaded', 2),
      ev('signup_completed', 0, 'u2'), ev('photo_uploaded', 3, 'u2'), ev('draft_ready', 4),
    ]
    const summary = summarizeFirstValueObservation(events, { workspaceId: WS, wiredEvents: ALL_WIRED })
    expect(stepOf(summary, 'signup_completed')).toMatchObject({ state: 'OBSERVED', reached: 2 })
    expect(stepOf(summary, 'photo_uploaded')).toMatchObject({ state: 'OBSERVED', reached: 2 })
    expect(stepOf(summary, 'draft_ready')).toMatchObject({ state: 'OBSERVED', reached: 1 })
    expect(stepOf(summary, 'publish_confirmed')).toMatchObject({ state: 'OBSERVED', reached: 0 })
    expect(stepOf(summary, 'publish_verified')).toMatchObject({ state: 'NOT_OBSERVED', reached: null })
  })

  it('does not call a step 0 when its emitter is not wired in code', () => {
    const wired = new Set<string>(['signup_completed', 'draft_ready'])
    const summary = summarizeFirstValueObservation([ev('signup_completed', 0)], { workspaceId: WS, wiredEvents: wired })
    expect(stepOf(summary, 'photo_uploaded')).toMatchObject({ state: 'NOT_OBSERVED', reason: 'EMITTER_NOT_WIRED', reached: null })
  })

  it('never mixes other workspaces in (tenant isolation) and drops unattributed rows', () => {
    const events = [ev('signup_completed', 0), ev('signup_completed', 0, 'u9', 'ws-b'), { event: 'signup_completed', occurred_at: at(1), user_id: 'u8' } as ObservationEvent]
    const summary = summarizeFirstValueObservation(events, { workspaceId: WS, wiredEvents: ALL_WIRED })
    expect(stepOf(summary, 'signup_completed')).toMatchObject({ reached: 1 })
    expect(summary.excludedEvents).toBe(2)
  })

  it('ignores a user who reached a later step without the earlier one in the ordered funnel count', () => {
    const summary = summarizeFirstValueObservation([ev('signup_completed', 5), ev('photo_uploaded', 1)], { workspaceId: WS, wiredEvents: ALL_WIRED })
    expect(stepOf(summary, 'photo_uploaded')).toMatchObject({ state: 'OBSERVED', reached: 0 })
  })
})

describe('generation cost and trial credit observation', () => {
  const cost = (reservationId: string, credits: unknown, minute = 5) => ev('generation_cost_settled', minute, 'u1', WS, { reservationId, credits })

  it('sums settled credits once per reservation and quarantines invalid rows', () => {
    const events = [cost('r1', 30), cost('r1', 30, 6), cost('r2', 20), cost('r3', -5), cost('r4', 'x'), ev('generation_cost_settled', 7, 'u1', WS, { credits: 9 })]
    const summary = summarizeFirstValueObservation(events, { workspaceId: WS, wiredEvents: ALL_WIRED })
    expect(summary.generationCost).toMatchObject({ state: 'OBSERVED', settledCount: 2, totalCredits: 50, invalidCount: 3 })
  })

  it('reports a genuine 0 only when a zero-credit settlement was recorded', () => {
    const summary = summarizeFirstValueObservation([cost('r1', 0)], { workspaceId: WS, wiredEvents: ALL_WIRED })
    expect(summary.generationCost).toMatchObject({ state: 'OBSERVED', totalCredits: 0, settledCount: 1 })
  })

  it('keeps cost NOT_OBSERVED when the emitter is not wired even if no event exists', () => {
    const summary = summarizeFirstValueObservation([], { workspaceId: WS, wiredEvents: new Set(FIRST_VALUE_STEPS) })
    expect(summary.generationCost).toMatchObject({ state: 'NOT_OBSERVED', reason: 'EMITTER_NOT_WIRED' })
  })

  it('reconciles trial debit against generation cost only when both are observed', () => {
    const debit = (reservationId: string, credits: number) => ev('trial_credit_debited', 6, 'u1', WS, { reservationId, credits })
    const match = summarizeFirstValueObservation([cost('r1', 30), debit('r1', 30)], { workspaceId: WS, wiredEvents: ALL_WIRED })
    expect(match.trialDebit).toMatchObject({ state: 'OBSERVED', totalCredits: 30 })
    expect(match.costReconciliation).toMatchObject({ state: 'OBSERVED', mismatchedReservations: [] })
    const mismatch = summarizeFirstValueObservation([cost('r1', 30), debit('r1', 20)], { workspaceId: WS, wiredEvents: ALL_WIRED })
    expect(mismatch.costReconciliation).toMatchObject({ state: 'OBSERVED', mismatchedReservations: ['r1'] })
    const partial = summarizeFirstValueObservation([cost('r1', 30)], { workspaceId: WS, wiredEvents: ALL_WIRED })
    expect(partial.costReconciliation.state).toBe('NOT_OBSERVED')
  })
})

describe('emitter wiring registry', () => {
  it('only claims events that production code actually emits', () => {
    expect(WIRED_FIRST_VALUE_EVENTS.has('photo_uploaded')).toBe(true)
    expect(WIRED_FIRST_VALUE_EVENTS.has('generation_cost_settled')).toBe(true)
    // No emitter exists for trial-credit attribution yet; it must stay unobserved rather than read as 0.
    expect(WIRED_FIRST_VALUE_EVENTS.has('trial_credit_debited')).toBe(false)
  })

  it('records a settled generation cost idempotently keyed on the reservation', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const admin = { from: vi.fn(() => ({ upsert })) }
    await recordGenerationCostSettled({
      admin: admin as never, workspaceId: WS, userId: 'u1',
      reservation: { reservationId: 'r1', state: 'settled', requestedCredits: 30, operationKey: 'quick-post:m:1:both', isReplay: false },
    })
    expect(admin.from).toHaveBeenCalledWith('funnel_events')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: WS, event: 'generation_cost_settled', dedupe_key: 'generation_cost_settled:r1', properties: expect.objectContaining({ reservationId: 'r1', credits: 30 }) }),
      expect.objectContaining({ onConflict: 'workspace_id,event,dedupe_key', ignoreDuplicates: true }),
    )
  })

  it('never throws into the credit settlement path when the telemetry write fails', async () => {
    const admin = { from: () => ({ upsert: () => Promise.reject(new Error('db down')) }) }
    await expect(recordGenerationCostSettled({
      admin: admin as never, workspaceId: WS, userId: null,
      reservation: { reservationId: 'r1', state: 'settled', requestedCredits: 30, operationKey: 'k', isReplay: false },
    })).resolves.toBeUndefined()
  })
})
