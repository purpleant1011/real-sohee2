import { describe, expect, it } from 'vitest'
import { prepareRevisitCandidates } from '@/features/crm/revisit-preparation'
import { NOW, gateInput, proposal, unverifiedSlot, verifiedSlot } from './fixtures.test-util'
import { buildSalesActionProposals, type SalesActionEvidence } from './action-proposals'

const photos = { count: 3, rightsCleared: true, evidenceRef: 'photos-1' }
const serviceFact = { serviceId: 'service-1', catalogVersion: 'catalog-1', name: '젤 네일', priceKrw: 50000, evidenceRef: 'price-proof', validUntil: '2026-10-21T10:30:00Z' }
const goodPost = { postRef: 'post-1', evidenceRef: 'post-proof' }
const visit = (id: string) => ({ workspaceId: 'A', customerId: id, bookingId: `b-${id}`, eventId: `v-${id}`, completedAt: '2026-07-01T00:00:00Z', evidenceRef: `visit-${id}`, actorRef: 'owner-A', source: 'OWNER_CONFIRMED' })
const consent = (id: string) => ({ id: `c-${id}`, workspaceId: 'A', customerId: id, channel: 'KAKAO', purpose: 'MARKETING', action: 'GRANTED', occurredAt: '2026-06-01T00:00:00Z', evidenceRef: `consent-${id}`, actorRef: 'owner-A', source: 'CUSTOMER_FORM' })
const revisit = (consented: string[], all = ['c1', 'c2']) => prepareRevisitCandidates({
  workspaceId: 'A', channel: 'KAKAO', now: NOW, policy: { workspaceId: 'A', version: 'rp-1', dueAfterDays: 30, confirmedBy: 'owner-A', evidenceRef: 'rp-proof' },
  customers: { status: 'OK', records: all.map(customerId => ({ workspaceId: 'A', customerId, sourceRef: `crm-${customerId}` })) },
  visits: { status: 'OK', events: all.map(visit) }, consents: { status: 'OK', events: consented.map(consent) },
})
const evidence = (over: Partial<SalesActionEvidence> = {}): SalesActionEvidence => ({ workPhotos: photos, serviceFact, revisit: revisit(['c1']), discountGateInput: gateInput, cta: { status: 'OK', warnings: [], ownerMessage: '' }, existingPost: goodPost, recentKinds: [], ...over })
const kinds = (r: { proposals: readonly { kind: string }[] }) => r.proposals.map(p => p.kind)

describe('ANI-1626 evidence-based sales action proposals', () => {
  it('offers up to five actions, none of them forced discounts, all with why/uncertainty/next action', async () => {
    const r = await buildSalesActionProposals({ workspaceId: 'A', now: NOW, slot: await verifiedSlot(), evidence: evidence({ cta: { status: 'WARN', warnings: [{ code: 'PORTAL_MISMATCH', message: 'x' }], ownerMessage: 'x' } }) })
    expect(r.status).toBe('PROPOSALS')
    expect(new Set(kinds(r))).toEqual(new Set(['WORK_PHOTO_SHOWCASE', 'SERVICE_INTRO', 'OWNER_REVIEWED_FOLLOWUP', 'BOUNDED_OFFER', 'CTA_OR_POST_IMPROVEMENT']))
    for (const p of r.proposals) {
      expect(p.why.length).toBeGreaterThan(0); expect(p.uncertainty.length).toBeGreaterThan(0); expect(p.nextAction.length).toBeGreaterThan(0)
      expect(p.evidenceRefs.length).toBeGreaterThan(0); expect(p.executionAllowed).toBe(false)
    }
    expect(r.proposals[0].kind).not.toBe('BOUNDED_OFFER')
  })
  it('never proposes without evidence: empty evidence yields no proposals and no invented demand', async () => {
    const r = await buildSalesActionProposals({ workspaceId: 'A', now: NOW, slot: await verifiedSlot(), evidence: { workPhotos: null, serviceFact: null, revisit: null, discountGateInput: null, cta: null, existingPost: null, recentKinds: [] } })
    expect(r.status).toBe('NO_EVIDENCE'); expect(r.proposals).toEqual([])
  })
  it('creates no fake audience: without opted-in customers, follow-up is dropped and a public non-paid action remains', async () => {
    const r = await buildSalesActionProposals({ workspaceId: 'A', now: NOW, slot: await verifiedSlot(), evidence: evidence({ revisit: revisit([]) }) })
    expect(kinds(r)).not.toContain('OWNER_REVIEWED_FOLLOWUP')
    expect(r.suppressed).toContainEqual(expect.objectContaining({ kind: 'OWNER_REVIEWED_FOLLOWUP', reason: 'NO_OPTED_IN_AUDIENCE' }))
    expect(r.proposals.some(p => !p.paid)).toBe(true)
  })
  it('counts only consented customers as audience for the follow-up', async () => {
    const r = await buildSalesActionProposals({ workspaceId: 'A', now: NOW, slot: await verifiedSlot(), evidence: evidence({ revisit: revisit(['c1']) }) })
    expect(r.proposals.find(p => p.kind === 'OWNER_REVIEWED_FOLLOWUP')).toMatchObject({ audienceCount: 1 })
  })
  it('fails closed on ledger freshness: unverified slot yields a confirmation card and no slot-bound actions', async () => {
    const r = await buildSalesActionProposals({ workspaceId: 'A', now: NOW, slot: await unverifiedSlot(), evidence: evidence() })
    expect(r.status).toBe('NEEDS_SLOT_CONFIRMATION')
    expect(r.ownerPrompt).toContain('빈시간')
    for (const k of ['SERVICE_INTRO', 'BOUNDED_OFFER', 'OWNER_REVIEWED_FOLLOWUP']) expect(kinds(r)).not.toContain(k)
  })
  it('runs the policy gate on the offer: a 35,000원 offer under a 40,000원 minimum is suppressed with an owner-facing reason', async () => {
    const r = await buildSalesActionProposals({ workspaceId: 'A', now: NOW, slot: await verifiedSlot(), evidence: evidence({ discountGateInput: { ...gateInput, proposal: { ...proposal, offerPriceKrw: 35000 } } }) })
    expect(kinds(r)).not.toContain('BOUNDED_OFFER')
    const s = r.suppressed.find(x => x.kind === 'BOUNDED_OFFER')!
    expect(s.reason).toBe('POLICY_BLOCKED'); expect(s.ownerMessage).toContain('최저 가격')
  })
  it('does not repeat a kind proposed recently', async () => {
    const r = await buildSalesActionProposals({ workspaceId: 'A', now: NOW, slot: await verifiedSlot(), evidence: evidence({ recentKinds: ['WORK_PHOTO_SHOWCASE'] }) })
    expect(kinds(r)).not.toContain('WORK_PHOTO_SHOWCASE')
  })
  it('requires rights-cleared photos and a fresh matching service fact', async () => {
    const r = await buildSalesActionProposals({ workspaceId: 'A', now: NOW, slot: await verifiedSlot(), evidence: evidence({ workPhotos: { ...photos, rightsCleared: false }, serviceFact: { ...serviceFact, validUntil: NOW } }) })
    expect(kinds(r)).not.toContain('WORK_PHOTO_SHOWCASE'); expect(kinds(r)).not.toContain('SERVICE_INTRO')
  })
  it('rejects another tenant slot', async () => {
    const r = await buildSalesActionProposals({ workspaceId: 'A', now: NOW, slot: await verifiedSlot('B'), evidence: evidence() })
    expect(r.status).toBe('REJECTED'); expect(r.proposals).toEqual([])
  })
})
