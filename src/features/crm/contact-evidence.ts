import { z } from 'zod'

const ref = z.string().trim().min(1).max(200)
const timestamp = z.string().datetime({ offset: true })
const customerScope = z.object({ workspaceId: ref, customerId: ref })
const consentScope = customerScope.extend({ channel: z.enum(['KAKAO', 'SMS', 'EMAIL']), purpose: z.enum(['INFO', 'MARKETING', 'INBOUND_CONSULTATION']) })
const consentEvent = consentScope.extend({
  id: ref, action: z.enum(['GRANTED', 'REVOKED']), occurredAt: timestamp,
  expiresAt: timestamp.optional(), evidenceRef: ref, actorRef: ref,
  source: z.enum(['CUSTOMER_FORM', 'OWNER_RECORDED_EVIDENCE', 'CUSTOMER_WITHDRAWAL']),
}).strict()
const visitEvent = customerScope.extend({
  bookingId: ref, eventId: ref, completedAt: timestamp, evidenceRef: ref, actorRef: ref,
  source: z.enum(['OWNER_CONFIRMED', 'VERIFIED_VISIT_EVENT']),
}).strict()
export type ContactScope = z.infer<typeof consentScope>
export type ContactConsentEvent = z.infer<typeof consentEvent>
export type CompletedVisitEvent = z.infer<typeof visitEvent>
export type EvidenceRead = Readonly<{ status: 'ERROR' }> | Readonly<{ status: 'OK'; events: readonly unknown[] }>
export type ConsentObservation = 'GRANTED' | 'REVOKED' | 'NOT_OBSERVED' | 'EXPIRED' | 'UNKNOWN'

function sameCustomer(event: { workspaceId: string; customerId: string }, scope: { workspaceId: string; customerId: string }) {
  return event.workspaceId === scope.workspaceId && event.customerId === scope.customerId
}

/** Projection of trusted repository evidence; GRANTED is not legal/provider send authorization. */
export function resolveContactConsent(read: EvidenceRead, scopeInput: unknown, now: string): ConsentObservation {
  const scope = consentScope.safeParse(scopeInput)
  const clock = timestamp.safeParse(now)
  if (read.status === 'ERROR' || !scope.success || !clock.success) return 'UNKNOWN'
  const parsed = z.array(consentEvent).safeParse(read.events)
  if (!parsed.success) return 'UNKNOWN'
  const events = parsed.data.filter(event => sameCustomer(event, scope.data) && event.channel === scope.data.channel && event.purpose === scope.data.purpose)
  const seen = new Map<string, ContactConsentEvent>()
  for (const event of events) {
    if (event.source === 'CUSTOMER_WITHDRAWAL' && event.action !== 'REVOKED') return 'UNKNOWN'
    if (Date.parse(event.occurredAt) > Date.parse(now) ||
        (event.expiresAt && Date.parse(event.expiresAt) < Date.parse(event.occurredAt))) return 'UNKNOWN'
    const previous = seen.get(event.id)
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) return 'UNKNOWN'
    seen.set(event.id, event)
  }
  events.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) ||
    Number(b.action === 'REVOKED') - Number(a.action === 'REVOKED'))
  const latest = events[0]
  if (!latest) return 'NOT_OBSERVED'
  if (latest.action === 'REVOKED') return 'REVOKED'
  const simultaneousGrants = events.filter(event => Date.parse(event.occurredAt) === Date.parse(latest.occurredAt))
  if (new Set(simultaneousGrants.map(event => event.expiresAt ? Date.parse(event.expiresAt) : null)).size > 1) return 'UNKNOWN'
  if (latest.expiresAt && Date.parse(latest.expiresAt) <= Date.parse(now)) return 'EXPIRED'
  return 'GRANTED'
}

export type VisitObservation = Readonly<{
  status: 'OBSERVED' | 'ERROR'; completedVisitCount: number | null; lastVisitAt: string | null
}>

/** Counts actual visit confirmations, never elapsed reservations or payment evidence. */
export function summarizeVisits(read: EvidenceRead, scopeInput: unknown, now: string): VisitObservation {
  const unavailable: VisitObservation = { status: 'ERROR', completedVisitCount: null, lastVisitAt: null }
  const scope = customerScope.safeParse(scopeInput)
  if (read.status === 'ERROR' || !scope.success || !timestamp.safeParse(now).success) return unavailable
  const parsed = z.array(visitEvent).safeParse(read.events)
  if (!parsed.success) return unavailable
  const bookings = new Map<string, CompletedVisitEvent>()
  const eventIds = new Map<string, CompletedVisitEvent>()
  for (const event of parsed.data.filter(event => sameCustomer(event, scope.data))) {
    if (Date.parse(event.completedAt) > Date.parse(now)) return unavailable
    const previousEvent = eventIds.get(event.eventId)
    if (previousEvent && JSON.stringify(previousEvent) !== JSON.stringify(event)) return unavailable
    eventIds.set(event.eventId, event)
    const previous = bookings.get(event.bookingId)
    if (previous && previous.completedAt !== event.completedAt) return unavailable
    bookings.set(event.bookingId, event)
  }
  const latest = [...bookings.values()].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0]
  return { status: 'OBSERVED', completedVisitCount: bookings.size, lastVisitAt: latest?.completedAt ?? null }
}
