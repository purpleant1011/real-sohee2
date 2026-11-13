import { describe, expect, it } from 'vitest'
import { NOW, gateInput, proposal } from './fixtures.test-util'
import { evaluateMissionSalesGate } from './route-gate'

const dest = { kind: 'BOOKING_URL', href: 'https://example.com/shop/a', label: '예약', evidenceSource: 'OWNER_CONFIRMATION', networkVerified: false, revision: 1 }
const gate = (metadata: unknown) => evaluateMissionSalesGate(metadata, { workspaceId: 'A', now: NOW })

describe('mission sales gate on the product path', () => {
  it('reports NOT_APPLICABLE instead of a fake pass when no offer/CTA evidence is attached', () => {
    expect(gate({ payload: {} })).toMatchObject({ status: 'NOT_APPLICABLE', code: 'SALES_GATE_NOT_APPLICABLE' })
  })
  it('blocks a 35,000원 offer under a 40,000원 minimum with an owner-facing reason', () => {
    const r = gate({ salesGate: { policyInput: { ...gateInput, proposal: { ...proposal, offerPriceKrw: 35000 } } } })
    expect(r).toMatchObject({ status: 'BLOCK', code: 'SERVICE_POLICY_BLOCKED' })
    expect(r.ownerMessage).toContain('최저 가격'); expect(r.ownerMessage).not.toMatch(/MIN_PRICE/)
  })
  it('blocks when the CTA destination is missing', () => {
    expect(gate({ salesGate: { cta: { destination: null } } })).toMatchObject({ status: 'BLOCK', code: 'CTA_DESTINATION_BLOCKED' })
  })
  it('passes a within-policy offer with a confirmed destination', () => {
    expect(gate({ salesGate: { policyInput: gateInput, cta: { destination: dest, presence: null } } })).toMatchObject({ status: 'WARN' })
    expect(gate({ salesGate: { policyInput: gateInput } }).status).toBe('PASS')
  })
  it('surfaces a portal mismatch as a warning, never as a pass', () => {
    const presence = { workspaceId: 'A', datasetMode: 'ACTUAL' as const, now: NOW, maxAgeMs: 86400000, expectedListingId: 'l1',
      facts: { name: { value: '우리 가게', confirmedAt: NOW, sourceRef: 'f' } },
      listing: { workspaceId: 'A', listingId: 'l1', identityEvidenceRef: 'r', sourceUrl: 'https://maps.google.com/place/a', observedAt: NOW, state: 'OBSERVED' as const, fields: { name: '다른 가게' } }, ctas: [] }
    const r = gate({ salesGate: { cta: { destination: dest, presence } } })
    expect(r.status).toBe('WARN'); expect(r.warnings.map(w => w.code)).toContain('PORTAL_MISMATCH')
  })
})
