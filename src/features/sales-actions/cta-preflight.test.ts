import { describe, expect, it } from 'vitest'
import type { PresenceAuditInput } from '@/features/local-presence/audit'
import type { ConversionDestinationView } from '@/features/conversion-destination/destination'
import { ctaPreflight } from './cta-preflight'

const at = '2026-10-21T00:00:00Z'
const destination: ConversionDestinationView = { kind: 'BOOKING_URL', href: 'https://example.com/shop/a?campaignTag=c1', label: '예약', evidenceSource: 'OWNER_CONFIRMATION', networkVerified: false, revision: 1 }
function presence(): PresenceAuditInput {
  return { workspaceId: 'A', datasetMode: 'ACTUAL', now: at, maxAgeMs: 86400000, expectedListingId: 'l1',
    facts: Object.fromEntries(Object.entries({ name: '우리 가게', address: '서울 성수동', hours: '09:00-18:00', phone: '02-123-4567' }).map(([k, v]) => [k, { value: v, confirmedAt: at, sourceRef: `fact:${k}` }])),
    listing: { workspaceId: 'A', listingId: 'l1', identityEvidenceRef: 'review:1', sourceUrl: 'https://maps.google.com/place/a', observedAt: at, state: 'OBSERVED', fields: { name: '우리 가게', address: '서울 성수동', hours: '09:00-18:00', phone: '021234567' } },
    ctas: [{ kind: 'booking', expectedUrl: 'https://example.com/shop/a', observedUrl: 'https://example.com/shop/a', destinationWorkspaceId: 'A', statusCode: 200, observedAt: at, evidenceRef: 'readback:1' }] }
}
const run = (d: ConversionDestinationView | null, p: PresenceAuditInput | null) => ctaPreflight({ workspaceId: 'A', destination: d, presence: p, now: at })

describe('ANI-1630 CTA destination preflight', () => {
  it('passes only when owner destination and portal info agree', () => {
    expect(run(destination, presence())).toMatchObject({ status: 'OK', warnings: [] })
  })
  it.each([null, { ...destination, kind: 'REVIEW_REQUIRED' as const, href: null }, { ...destination, kind: 'NOT_CONFIGURED' as const, href: null }])('blocks an empty or unconfirmed destination so customers never land on a blank link (%#)', d => {
    const r = run(d, presence())
    expect(r.status).toBe('BLOCK')
    expect(r.ownerMessage).toMatch(/수정|설정|확인/)
  })
  it('warns (not blocks) when portal phone differs, naming the field without leaking values', () => {
    const p = presence(); p.listing.fields.phone = '0299999999'
    const r = run(destination, p)
    expect(r.status).toBe('WARN')
    expect(r.warnings.map(w => w.code)).toContain('PORTAL_MISMATCH')
    expect(JSON.stringify(r)).not.toContain('0299999999')
  })
  it('warns when the portal CTA does not point at the destination being published', () => {
    const p = presence(); p.ctas[0].expectedUrl = 'https://other.example.com/x'; p.ctas[0].observedUrl = 'https://other.example.com/x'
    expect(run(destination, p).warnings.map(w => w.code)).toContain('CTA_URL_MISMATCH')
  })
  it('warns honestly when the portal was never observed', () => {
    const r = run(destination, null)
    expect(r.status).toBe('WARN')
    expect(r.warnings.map(w => w.code)).toContain('PORTAL_NOT_OBSERVED')
  })
  it('warns when portal evidence is stale instead of calling it consistent', () => {
    const p = presence(); p.listing.observedAt = '2026-09-01T00:00:00Z'
    expect(run(destination, p).status).toBe('WARN')
  })
  it('degrades to a warning when the audit input is malformed', () => {
    expect(run(destination, { ...presence(), maxAgeMs: -1 } as PresenceAuditInput).warnings.map(w => w.code)).toContain('PORTAL_AUDIT_UNAVAILABLE')
  })
})
