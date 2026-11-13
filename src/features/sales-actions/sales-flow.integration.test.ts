import { describe, expect, it, vi } from 'vitest'
import { prepareRevisitCandidates } from '@/features/crm/revisit-preparation'
import { evaluatePolicyGate } from '@/features/policy-gate/service-policy'
import type { ConversionDestinationView } from '@/features/conversion-destination/destination'
import { NOW, gateInput, proposal, verifiedSlot } from './fixtures.test-util'
import { buildSalesActionProposals } from './action-proposals'
import { approveSalesProposal } from './approval'
import { ctaPreflight } from './cta-preflight'
import { approvalToCampaignEvent, projectCampaign, type CampaignEvent } from './campaign-tracker'
import { eligibleRevisitRecipients } from './revisit-bridge'

const dest: ConversionDestinationView = { kind: 'BOOKING_URL', href: 'https://example.com/shop/a?campaignTag=camp1', label: '예약', evidenceSource: 'OWNER_CONFIRMATION', networkVerified: false, revision: 1 }
const visit = (id: string) => ({ workspaceId: 'A', customerId: id, bookingId: `b-${id}`, eventId: `v-${id}`, completedAt: '2026-07-01T00:00:00Z', evidenceRef: `visit-${id}`, actorRef: 'owner-A', source: 'OWNER_CONFIRMED' })
const consent = (id: string) => ({ id: `c-${id}`, workspaceId: 'A', customerId: id, channel: 'KAKAO', purpose: 'MARKETING', action: 'GRANTED', occurredAt: '2026-06-01T00:00:00Z', evidenceRef: `consent-${id}`, actorRef: 'owner-A', source: 'CUSTOMER_FORM' })
const consents = { status: 'OK' as const, events: [consent('c1')] }
const revisit = () => prepareRevisitCandidates({ workspaceId: 'A', channel: 'KAKAO', now: NOW, policy: { workspaceId: 'A', version: 'rp-1', dueAfterDays: 30, confirmedBy: 'owner-A', evidenceRef: 'rp' },
  customers: { status: 'OK', records: ['c1', 'c2'].map(customerId => ({ workspaceId: 'A', customerId, sourceRef: `crm-${customerId}` })) }, visits: { status: 'OK', events: ['c1', 'c2'].map(visit) }, consents })

describe('ANI-1626..1630 sales action flow (call-path integration)', () => {
  it('revisit audience excludes customers without consent and the gate rejects a forced non-consented recipient', () => {
    const { recipientRefs, consentReviewCount } = eligibleRevisitRecipients(revisit())
    expect(recipientRefs).toEqual(['c1']); expect(consentReviewCount).toBe(1)
    const marketing = (refs: string[]) => ({ ...gateInput, proposal: { ...proposal, channel: 'KAKAO', purpose: 'MARKETING', recipientRefs: refs }, consents })
    expect(evaluatePolicyGate(marketing(['c1']), NOW).status).toBe('OWNER_REVIEW_REQUIRED')
    expect(evaluatePolicyGate(marketing(['c1', 'c2']), NOW)).toMatchObject({ status: 'BLOCKED', reason: 'CONSENT_REQUIRED' })
  })
  it('opportunity -> proposals -> owner approval -> reservation -> published -> linked booking, honest at every step', async () => {
    const proposals = await buildSalesActionProposals({ workspaceId: 'A', now: NOW, slot: await verifiedSlot(), evidence: {
      workPhotos: null, serviceFact: null, revisit: revisit(), discountGateInput: gateInput, cta: null, existingPost: null, recentKinds: [] } })
    expect(proposals.status).toBe('PROPOSALS')
    const offer = proposals.proposals.find(p => p.kind === 'BOUNDED_OFFER')!
    expect(offer.executionAllowed).toBe(false)

    const g = evaluatePolicyGate(gateInput, NOW)
    const approval = { workspaceId: 'A', policyFingerprint: g.policyFingerprint!, proposalFingerprint: g.proposalFingerprint!, approvedBy: 'owner-A', approvedAt: NOW, validUntil: '2026-10-21T10:10:00Z' }
    const reserve = vi.fn(async () => ({ status: 'RESERVED' as const, reservationId: 'r1' }))
    const cta = ctaPreflight({ workspaceId: 'A', destination: dest, presence: null, now: NOW })
    const result = await approveSalesProposal({ gateInput, approval, cta, now: NOW, reserve })
    expect(result.status).toBe('APPROVED_RESERVED')
    expect(result.warnings.map(w => w.code)).toContain('PORTAL_NOT_OBSERVED')

    const start = approvalToCampaignEvent(result, { workspaceId: 'A', campaignId: 'camp-1', campaignTag: 'camp1', approvedAt: NOW, expectedCostKrw: proposal.quotedCostKrw })!
    const events: CampaignEvent[] = [start]
    const scope = { workspaceId: 'A', campaignId: 'camp-1', now: '2026-10-25T00:00:00Z' }
    expect(projectCampaign(events, scope).bookings.linked).toBeNull() // no observation => unobserved, not 0
    events.push(
      { type: 'POST_PUBLISHED', eventId: 'p', workspaceId: 'A', campaignId: 'camp-1', channel: 'INSTAGRAM', providerPostId: 'ig1', providerReceiptRef: 'rcpt', publishedAt: '2026-10-21T10:30:00Z' },
      { type: 'POST_READBACK', eventId: 'rb', workspaceId: 'A', campaignId: 'camp-1', result: 'VERIFIED', readAt: '2026-10-21T10:31:00Z' },
      { type: 'OBSERVATION_WINDOW', eventId: 'wb', workspaceId: 'A', campaignId: 'camp-1', kind: 'BOOKING', coverage: 'COMPLETE', from: '2026-10-21T10:30:00Z', to: '2026-10-25T00:00:00Z' },
      { type: 'BOOKING_OBSERVED', eventId: 'bk', workspaceId: 'A', campaignId: 'camp-1', bookingId: 'b1', customerRef: 'c9', campaignTag: 'camp1', status: 'CONFIRMED', observedAt: '2026-10-22T00:00:00Z' })
    expect(projectCampaign(events, scope).ownerLines).toContain('캠페인에 연결된 예약 1건')
    expect(reserve).toHaveBeenCalledTimes(1)
  })
  it('an empty destination stops the approval before any reservation', async () => {
    const g = evaluatePolicyGate(gateInput, NOW)
    const approval = { workspaceId: 'A', policyFingerprint: g.policyFingerprint!, proposalFingerprint: g.proposalFingerprint!, approvedBy: 'owner-A', approvedAt: NOW, validUntil: '2026-10-21T10:10:00Z' }
    const reserve = vi.fn()
    const r = await approveSalesProposal({ gateInput, approval, cta: ctaPreflight({ workspaceId: 'A', destination: null, presence: null, now: NOW }), now: NOW, reserve })
    expect(r.status).toBe('BLOCKED'); expect(reserve).not.toHaveBeenCalled()
  })
})
