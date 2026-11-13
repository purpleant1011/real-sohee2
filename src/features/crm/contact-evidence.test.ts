import { describe, expect, it } from 'vitest'
import { resolveContactConsent, summarizeVisits } from './contact-evidence'

const now = '2026-10-21T10:00:00Z'
const scope = { workspaceId: 'a', customerId: 'c', channel: 'KAKAO' as const, purpose: 'MARKETING' as const }
const grant = { ...scope, id: 'event-1', action: 'GRANTED' as const, occurredAt: '2026-10-20T10:00:00Z', evidenceRef: 'consent-receipt-1', actorRef: 'customer-c', source: 'CUSTOMER_FORM' as const }
const visit = { workspaceId: 'a', customerId: 'c', bookingId: 'b', eventId: 'v1', completedAt: '2026-10-20T10:00:00Z', evidenceRef: 'owner-confirmation-1', actorRef: 'owner-a', source: 'OWNER_CONFIRMED' as const }

describe('contact purpose consent projection', () => {
  it('does not infer consent from a phone number or absent events', () => {
    expect(resolveContactConsent({ status: 'OK', events: [] }, scope, now)).toBe('NOT_OBSERVED')
  })
  it('grants only the exact tenant customer channel and purpose', () => {
    expect(resolveContactConsent({ status: 'OK', events: [grant] }, scope, now)).toBe('GRANTED')
    for (const change of [{ workspaceId: 'other' }, { customerId: 'other' }, { channel: 'SMS' }, { purpose: 'INFO' }]) {
      expect(resolveContactConsent({ status: 'OK', events: [{ ...grant, ...change }] }, scope, now)).toBe('NOT_OBSERVED')
    }
  })
  it('a later withdrawal invalidates a grant independent of array ordering', () => {
    const revoke = { ...grant, id: 'event-2', action: 'REVOKED', occurredAt: '2026-10-21T09:00:00Z' }
    expect(resolveContactConsent({ status: 'OK', events: [revoke, grant] }, scope, now)).toBe('REVOKED')
  })
  it('gives withdrawal priority at equal timestamps', () => {
    expect(resolveContactConsent({ status: 'OK', events: [grant, { ...grant, id: 'revoke', action: 'REVOKED' }] }, scope, now)).toBe('REVOKED')
  })
  it('does not pick an arbitrary grant when same-time expiry terms conflict', () => {
    const expired = { ...grant, id: 'expired-grant', expiresAt: now }
    const results = [[grant, expired], [expired, grant]].map(events =>
      resolveContactConsent({ status: 'OK', events }, scope, now))
    expect(results).toEqual(['UNKNOWN', 'UNKNOWN'])
  })
  it('rejects missing proof and conflicting duplicate IDs', () => {
    expect(resolveContactConsent({ status: 'OK', events: [{ ...grant, evidenceRef: '' }] }, scope, now)).toBe('UNKNOWN')
    expect(resolveContactConsent({ status: 'OK', events: [grant, { ...grant, action: 'REVOKED' }] }, scope, now)).toBe('UNKNOWN')
  })
  it('does not reinterpret withdrawal evidence as a marketing grant', () => {
    expect(resolveContactConsent({ status: 'OK', events: [{ ...grant, source: 'CUSTOMER_WITHDRAWAL' }] }, scope, now)).toBe('UNKNOWN')
  })
  it('fails closed on expired, future or unavailable evidence', () => {
    expect(resolveContactConsent({ status: 'OK', events: [{ ...grant, expiresAt: now }] }, scope, now)).toBe('EXPIRED')
    expect(resolveContactConsent({ status: 'OK', events: [{ ...grant, occurredAt: '2027-01-01T00:00:00Z' }] }, scope, now)).toBe('UNKNOWN')
    expect(resolveContactConsent({ status: 'ERROR' }, scope, now)).toBe('UNKNOWN')
  })
})

describe('actual visits only, no booking-based retention fiction', () => {
  it('represents known zero separately from query error', () => {
    expect(summarizeVisits({ status: 'OK', events: [] }, scope, now)).toEqual({ status: 'OBSERVED', completedVisitCount: 0, lastVisitAt: null })
    expect(summarizeVisits({ status: 'ERROR' }, scope, now)).toEqual({ status: 'ERROR', completedVisitCount: null, lastVisitAt: null })
  })
  it('counts one actual booking once and does not merge another tenant/customer', () => {
    expect(summarizeVisits({ status: 'OK', events: [visit, visit, { ...visit, eventId: 'v2' }, { ...visit, workspaceId: 'b' }, { ...visit, customerId: 'd' }] }, scope, now)).toMatchObject({ completedVisitCount: 1, lastVisitAt: visit.completedAt })
  })
  it('does not turn a booked status or future event into a completed visit', () => {
    for (const change of [{ source: 'BOOKED' }, { completedAt: '2027-01-01T00:00:00Z' }, { evidenceRef: '' }]) {
      expect(summarizeVisits({ status: 'OK', events: [{ ...visit, ...change }] }, scope, now).status).toBe('ERROR')
    }
  })
})
