import { describe, expect, it } from 'vitest'
import { prepareRevisitCandidates } from './revisit-preparation'

const now = '2026-10-21T10:00:00Z'
const customer = { workspaceId: 'A', customerId: 'customer-1', sourceRef: 'customer-observation-1', phone: 'private-fixture-phone' }
const visit = { workspaceId: 'A', customerId: 'customer-1', bookingId: 'booking-1', eventId: 'visit-1', completedAt: '2026-09-28T10:00:00Z', source: 'OWNER_CONFIRMED', actorRef: 'owner-A', evidenceRef: 'visit-receipt-1' }
const grant = { workspaceId: 'A', customerId: 'customer-1', channel: 'KAKAO', purpose: 'MARKETING', id: 'consent-1', action: 'GRANTED', occurredAt: '2026-09-01T00:00:00Z', evidenceRef: 'consent-receipt-1', actorRef: 'customer-1', source: 'CUSTOMER_FORM' }
const input = {
  workspaceId: 'A', channel: 'KAKAO', now,
  policy: { workspaceId: 'A', version: 'revisit-1', dueAfterDays: 20, confirmedBy: 'owner-A', evidenceRef: 'policy-receipt-1' },
  customers: { status: 'OK', records: [customer] }, visits: { status: 'OK', events: [visit] }, consents: { status: 'OK', events: [grant] },
}

describe('ANI-1629 revisit candidates are non-executable preparation only', () => {
  it('prepares only actual visit and marketing consent evidence without recipient data', () => {
    const result = prepareRevisitCandidates(input)
    expect(result.status).toBe('PREPARED')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ customerId: 'customer-1', lastVisitAt: visit.completedAt, daysElapsed: 23, completedVisitCount: 1, consentState: 'GRANTED', kind: 'OWNER_REVIEW_REVISIT', outboundRecipient: null, executionAllowed: false, requiresOwnerReview: true })
    expect(JSON.stringify(result)).not.toContain(customer.phone)
    expect(JSON.stringify(result)).not.toContain('15%')
    expect(result.candidates[0].sourceRefs).toContain(visit.evidenceRef)
    expect(result.candidates[0].sourceRefs).toContain(grant.evidenceRef)
  })
  it('does not infer visits from bookings or create customers for empty businesses', () => {
    expect(prepareRevisitCandidates({ ...input, visits: { status: 'OK', events: [] } }).candidates).toEqual([])
    const empty = prepareRevisitCandidates({ ...input, customers: { status: 'OK', records: [] } })
    expect(empty.candidates).toEqual([])
    expect(empty.candidateCount).toBe(0)
    expect(empty.fallback).toBe('PUBLIC_PROMOTION_OR_OWNER_REVIEW')
  })
  it.each(['absent', 'revoked', 'expired'])('with %s consent produces only a non-addressable consent review', state => {
    const consents = state === 'absent' ? [] : state === 'revoked' ? [grant, { ...grant, id: 'withdrawal-1', action: 'REVOKED', occurredAt: now, source: 'CUSTOMER_WITHDRAWAL' }] : [{ ...grant, expiresAt: now }]
    const result = prepareRevisitCandidates({ ...input, consents: { status: 'OK', events: consents } })
    expect(result.candidates[0]).toMatchObject({ kind: 'REVIEW_CONSENT', outboundRecipient: null, executionAllowed: false })
  })
  it('does not share consent between businesses, customers or channels', () => {
    for (const change of [{ workspaceId: 'B' }, { customerId: 'other' }, { channel: 'SMS' }, { purpose: 'INFO' }]) {
      expect(prepareRevisitCandidates({ ...input, consents: { status: 'OK', events: [{ ...grant, ...change }] } }).candidates[0].kind).toBe('REVIEW_CONSENT')
    }
  })
  it('dedupes within a business and never merges a same-ID customer across businesses', () => {
    const result = prepareRevisitCandidates({ ...input, customers: { status: 'OK', records: [customer, customer, { ...customer, workspaceId: 'B' }] } })
    expect(result.candidateCount).toBe(1)
    expect(result.candidates[0].workspaceId).toBe('A')
  })
  it('excludes erased customers even when another duplicate row is active', () => {
    expect(prepareRevisitCandidates({ ...input, customers: { status: 'OK', records: [customer, { ...customer, erasedAt: now }] } }).candidateCount).toBe(0)
  })
  it('never replaces elapsed time with an arbitrary 21-day maintenance cycle', () => {
    const recent = { ...visit, completedAt: '2026-10-19T10:00:00Z' }
    expect(prepareRevisitCandidates({ ...input, visits: { status: 'OK', events: [recent] } }).candidateCount).toBe(0)
    const result = prepareRevisitCandidates({ ...input, policy: { ...input.policy, dueAfterDays: 1 }, visits: { status: 'OK', events: [recent] } })
    expect(result.candidates[0].daysElapsed).toBe(2)
  })
  it.each(['customers', 'visits', 'consents'])('keeps %s read failure distinct from observed zero', field => {
    const result = prepareRevisitCandidates({ ...input, [field]: { status: 'ERROR' } })
    expect(result).toMatchObject({ status: 'QUERY_ERROR', candidateCount: null, candidates: [] })
  })
  it('rejects invalid or cross-business owner policies', () => {
    expect(prepareRevisitCandidates({ ...input, policy: { ...input.policy, workspaceId: 'B' } }).status).toBe('INVALID_INPUT')
    expect(prepareRevisitCandidates({ ...input, policy: { ...input.policy, dueAfterDays: -1 } }).status).toBe('INVALID_INPUT')
  })
  it('returns immutable preparation and does not infer consent from a phone', () => {
    const result = prepareRevisitCandidates({ ...input, consents: { status: 'OK', events: [] } })
    expect(Object.isFrozen(result.candidates[0])).toBe(true)
    expect(result.candidates[0].consentState).toBe('NOT_OBSERVED')
    expect(result.executionAllowed).toBe(false)
  })
})
