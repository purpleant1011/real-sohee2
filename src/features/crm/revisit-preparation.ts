import { z } from 'zod'
import { resolveContactConsent, summarizeVisits, type CompletedVisitEvent, type ContactConsentEvent, type ConsentObservation } from './contact-evidence'

const ref = z.string().trim().min(1).max(200)
const timestamp = z.string().datetime({ offset: true })
const evidenceRead = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ERROR') }), z.object({ status: z.literal('OK'), events: z.array(z.unknown()) }),
])
const inputSchema = z.object({
  workspaceId: ref, channel: z.enum(['KAKAO', 'SMS', 'EMAIL']), now: timestamp,
  policy: z.object({ workspaceId: ref, version: ref, dueAfterDays: z.number().int().min(1).max(3650), confirmedBy: ref, evidenceRef: ref }),
  customers: z.discriminatedUnion('status', [
    z.object({ status: z.literal('ERROR') }),
    z.object({ status: z.literal('OK'), records: z.array(z.object({ workspaceId: ref, customerId: ref, sourceRef: ref, erasedAt: timestamp.nullable().optional() })) }),
  ]),
  visits: evidenceRead, consents: evidenceRead,
}).strict()
export type RevisitCandidate = Readonly<{
  workspaceId: string; customerId: string; policyVersion: string; lastVisitAt: string
  daysElapsed: number; completedVisitCount: number; consentState: ConsentObservation
  kind: 'OWNER_REVIEW_REVISIT' | 'REVIEW_CONSENT'; sourceRefs: readonly string[]
  outboundRecipient: null; executionAllowed: false; requiresOwnerReview: true
}>
export type RevisitPreparation = Readonly<{
  status: 'PREPARED' | 'QUERY_ERROR' | 'INVALID_INPUT'; candidateCount: number | null
  candidates: readonly RevisitCandidate[]; executionAllowed: false
  fallback: 'PUBLIC_PROMOTION_OR_OWNER_REVIEW' | 'OWNER_REVIEW' | null
}>

function failure(status: 'QUERY_ERROR' | 'INVALID_INPUT'): RevisitPreparation {
  return Object.freeze({ status, candidateCount: null, candidates: Object.freeze([]), executionAllowed: false, fallback: 'OWNER_REVIEW' })
}

/** Read-only preparation. Neither consent nor a candidate grants permission to send. */
export function prepareRevisitCandidates(input: unknown): RevisitPreparation {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('INVALID_INPUT')
  const { workspaceId, channel, now, policy, customers, visits, consents } = parsed.data
  if (policy.workspaceId !== workspaceId) return failure('INVALID_INPUT')
  if (customers.status === 'ERROR' || visits.status === 'ERROR' || consents.status === 'ERROR') return failure('QUERY_ERROR')
  const grouped = new Map<string, typeof customers.records>()
  for (const customer of customers.records.filter(item => item.workspaceId === workspaceId)) {
    const records = grouped.get(customer.customerId) ?? []
    records.push(customer)
    grouped.set(customer.customerId, records)
  }
  const candidates: RevisitCandidate[] = []
  for (const [customerId, records] of grouped) {
    if (records.some(record => record.erasedAt)) continue
    const scope = { workspaceId, customerId, channel, purpose: 'MARKETING' as const }
    const visitSummary = summarizeVisits(visits, scope, now)
    if (visitSummary.status === 'ERROR') return failure('QUERY_ERROR')
    if (visitSummary.lastVisitAt === null || visitSummary.completedVisitCount === null) continue
    const lastVisitAt = visitSummary.lastVisitAt
    const daysElapsed = Math.floor((Date.parse(now) - Date.parse(lastVisitAt)) / 86_400_000)
    if (daysElapsed < policy.dueAfterDays) continue
    const consentState = resolveContactConsent(consents, scope, now)
    // These observations require all input consent rows to have passed the shared schema.
    const consentSources = ['GRANTED', 'REVOKED', 'EXPIRED'].includes(consentState)
      ? (consents.events as readonly ContactConsentEvent[])
        .filter(event => event.workspaceId === workspaceId && event.customerId === customerId && event.channel === channel && event.purpose === 'MARKETING')
        .map(event => event.evidenceRef)
      : []
    // OBSERVED from summarizeVisits proves the input visit rows passed its schema.
    const sources = (visits.events as readonly CompletedVisitEvent[])
      .filter(event => event.workspaceId === workspaceId && event.customerId === customerId && Date.parse(event.completedAt) === Date.parse(lastVisitAt))
      .map(event => event.evidenceRef)
    candidates.push(Object.freeze({
      workspaceId, customerId, policyVersion: policy.version, lastVisitAt,
      daysElapsed, completedVisitCount: visitSummary.completedVisitCount, consentState,
      kind: consentState === 'GRANTED' ? 'OWNER_REVIEW_REVISIT' : 'REVIEW_CONSENT',
      sourceRefs: Object.freeze([...new Set([policy.evidenceRef, ...records.map(record => record.sourceRef), ...sources, ...consentSources])]),
      outboundRecipient: null, executionAllowed: false, requiresOwnerReview: true,
    }))
  }
  candidates.sort((a, b) => b.daysElapsed - a.daysElapsed || a.customerId.localeCompare(b.customerId))
  return Object.freeze({
    status: 'PREPARED', candidateCount: candidates.length, candidates: Object.freeze(candidates), executionAllowed: false,
    fallback: candidates.length === 0 ? 'PUBLIC_PROMOTION_OR_OWNER_REVIEW' : null,
  })
}
