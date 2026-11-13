import { describe, expect, it } from 'vitest'
import { auditLocalPresence, sanitizeOpaqueRef, type PresenceAuditInput } from './audit'

const at = '2026-10-21T00:00:00Z'
function input(): PresenceAuditInput {
  return { workspaceId: 'shop-a', datasetMode: 'TEST', now: at, maxAgeMs: 86400000, expectedListingId: 'listing-a',
    facts: Object.fromEntries(Object.entries({ name: '우리 가게', address: '서울 성수동', hours: '09:00-18:00', phone: '02-123-4567' }).map(([key, value]) => [key, { value, confirmedAt: at, sourceRef: `fact:${key}` }])),
    listing: { workspaceId: 'shop-a', listingId: 'listing-a', identityEvidenceRef: 'review:1', sourceUrl: 'https://maps.google.com/place/a?utm_source=test', observedAt: at, state: 'OBSERVED', fields: { name: '우리 가게', address: '서울 성수동', hours: '09:00-18:00', phone: '021234567' } },
    ctas: [{ kind: 'booking', expectedUrl: 'https://example.com/shop/a', observedUrl: 'https://example.com/shop/a?utm_source=maps', destinationWorkspaceId: 'shop-a', statusCode: 200, observedAt: at, evidenceRef: 'readback:1' }],
  }
}
describe('read-only local presence audit', () => {
  it('reports consistency only for matching, fresh evidence and bound CTA destinations', () => {
    const report = auditLocalPresence(input())
    expect(report.state).toBe('CONSISTENT')
    expect(report.verificationLevel).toBe('IMPORTED_EVIDENCE_ONLY')
    expect(report.datasetMode).toBe('TEST')
    expect(report.sourceUrl).toBe('https://maps.google.com/place/a')
  })
  it('proposes a manual address correction with provenance, never an external write', () => {
    const data = input(); data.listing.fields.address = '다른 주소'
    const report = auditLocalPresence(data)
    expect(report.state).toBe('REVIEW_REQUIRED')
    expect(report.findings.find(f => f.field === 'address')).toMatchObject({ state: 'DISCREPANCY', sourceRef: 'fact:address', manualOnly: true })
    expect(JSON.stringify(report)).not.toContain('다른 주소')
  })
  it.each(['other-shop', 'wrong-listing'])('rejects identity mismatch (%s)', mode => {
    const data = input()
    if (mode === 'other-shop') data.listing.workspaceId = mode
    else data.listing.listingId = mode
    expect(auditLocalPresence(data).state).toBe('INSUFFICIENT_EVIDENCE')
    expect(auditLocalPresence(data).findings.every(f => f.state !== 'MATCH')).toBe(true)
  })
  it('does not make stale or missing values green', () => {
    const data = input(); data.listing.observedAt = '2026-10-01T00:00:00Z'
    expect(auditLocalPresence(data).findings[0].state).toBe('STALE')
    const missing = input(); missing.listing.fields.hours = null
    expect(auditLocalPresence(missing).findings.find(f => f.field === 'hours')?.state).toBe('NOT_OBSERVED')
  })
  it('distinguishes source read errors and missing internal confirmations', () => {
    const failed = input(); failed.listing.state = 'ERROR'
    expect(auditLocalPresence(failed).findings[0].state).toBe('ERROR')
    const missing = input(); delete missing.facts.name
    expect(auditLocalPresence(missing).findings.find(f => f.field === 'name')?.state).toBe('NOT_OBSERVED')
  })
  it.each(['https://127.0.0.1/a', 'https://localhost./a', 'https://user:secret@example.com/a', 'https://example.com/a?token=secret', 'http://example.com/a'])('rejects unsafe CTA without exposing it (%s)', url => {
    const data = input(); data.ctas[0].observedUrl = url
    expect(auditLocalPresence(data).findings.find(f => f.field === 'booking')?.state).toBe('ERROR')
    expect(JSON.stringify(auditLocalPresence(data))).not.toContain('secret')
  })
  it('rejects wrong destination business, error status, query mismatch, and future evidence', () => {
    for (const patch of [{ destinationWorkspaceId: 'shop-b' }, { statusCode: 404 }, { observedUrl: 'https://example.com/shop/a?business=b' }, { observedAt: '2027-01-01T00:00:00Z' }]) {
      const data = input(); Object.assign(data.ctas[0], patch)
      expect(auditLocalPresence(data).state).not.toBe('CONSISTENT')
    }
  })
  it('keeps absent CTA and identity proof unverified', () => {
    const data = input(); data.ctas = []
    expect(auditLocalPresence(data).state).toBe('INSUFFICIENT_EVIDENCE')
    data.listing.identityEvidenceRef = ''
    expect(auditLocalPresence(data).findings[0].state).toBe('NOT_OBSERVED')
  })
  it('rejects credential-bearing URLs and non-opaque identifiers in evidence references', () => {
    const credUrl = 'https://evidence.example/proof?token=SYNTHETIC_MARKER'
    const invalidFact = input()
    invalidFact.facts.name = { value: '우리 가게', confirmedAt: at, sourceRef: credUrl }
    expect(() => auditLocalPresence(invalidFact)).toThrow('AUDIT_INPUT_INVALID')

    const invalidCta = input()
    invalidCta.ctas[0].evidenceRef = credUrl
    expect(() => auditLocalPresence(invalidCta)).toThrow('AUDIT_INPUT_INVALID')

    const invalidListing = input()
    invalidListing.listing.identityEvidenceRef = credUrl
    expect(() => auditLocalPresence(invalidListing)).toThrow('AUDIT_INPUT_INVALID')

    const spaceRef = input()
    spaceRef.facts.name = { value: '우리 가게', confirmedAt: at, sourceRef: 'fact: invalid id' }
    expect(() => auditLocalPresence(spaceRef)).toThrow('AUDIT_INPUT_INVALID')
  })
  it('drops a reference at the output boundary instead of echoing it to stdout', () => {
    expect(sanitizeOpaqueRef('fact:name')).toBe('fact:name')
    expect(sanitizeOpaqueRef('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(sanitizeOpaqueRef('receipt:1')).toBe('receipt:1')
    expect(sanitizeOpaqueRef('')).toBe('')
    expect(sanitizeOpaqueRef(null)).toBeNull()
    expect(sanitizeOpaqueRef(undefined)).toBeNull()
    // Any value that could carry a credential, path or free text never reaches the report.
    expect(sanitizeOpaqueRef('https://evidence.example/proof?token=SYNTHETIC_MARKER')).toBeNull()
    expect(sanitizeOpaqueRef('fact: invalid id')).toBeNull()
    expect(sanitizeOpaqueRef('a'.repeat(257))).toBeNull()
  })
})
