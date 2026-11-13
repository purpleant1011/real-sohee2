import { describe, expect, it } from 'vitest'
import { createServicePolicySnapshot, evaluatePolicyGate } from './service-policy'

const now = '2026-10-21T10:00:00Z'
const policy = { workspaceId: 'A', serviceId: 'service-1', version: 'policy-1', minPriceKrw: 40000, maxDiscountBps: 2000, maxDiscountCases: 5, allowedChannels: ['INSTAGRAM', 'KAKAO'], perActionBudgetKrw: 2000, periodBudgetKrw: 10000, validFrom: '2026-10-01T00:00:00Z', validUntil: '2026-11-01T00:00:00Z', confirmedBy: 'owner-A', evidenceRef: 'policy-proof' }
const proposal = { workspaceId: 'A', serviceId: 'service-1', policyVersion: 'policy-1', catalogVersion: 'catalog-1', channel: 'INSTAGRAM', purpose: 'PUBLIC_PROMOTION', servicePriceKrw: 50000, offerPriceKrw: 45000, discountCaseCount: 1, quotedCostKrw: 1000, costQuoteRef: 'quote-1', costQuoteObservedAt: '2026-10-21T09:55:00Z', costQuoteValidUntil: '2026-10-21T10:10:00Z', contentRevision: 'draft-1', content: '확인된 서비스 안내', recipientRefs: [] as string[], mediaRefs: ['media-1'], expiresAt: '2026-10-21T10:20:00Z' }
const facts = { workspaceId: 'A', serviceId: 'service-1', version: 'catalog-1', status: 'VERIFIED', priceKrw: 50000, observedAt: '2026-10-21T09:50:00Z', validUntil: '2026-10-21T10:30:00Z', evidenceRef: 'price-proof' }
const usage = { workspaceId: 'A', serviceId: 'service-1', policyVersion: 'policy-1', status: 'CURRENT', windowStart: policy.validFrom, windowEnd: policy.validUntil, observedAt: '2026-10-21T09:59:00Z', validUntil: '2026-10-21T10:05:00Z', discountCasesUsed: 1, discountCasesReserved: 1, budgetSpentKrw: 1000, budgetReservedKrw: 1000, evidenceRef: 'usage-proof' }
const input = { policy, proposal, facts, usage, consents: { status: 'OK', events: [] } }
function approvalFor(value: unknown) {
  const result = evaluatePolicyGate(value, now)
  if (!result.policyFingerprint || !result.proposalFingerprint) throw new Error('expected valid fingerprints')
  return { workspaceId: 'A', policyFingerprint: result.policyFingerprint, proposalFingerprint: result.proposalFingerprint, approvedBy: 'owner-A', approvedAt: now, validUntil: '2026-10-21T10:10:00Z' }
}

describe('ANI-1627 immutable service policy preparation gate', () => {
  it('requires owner review even when proposal is within policy', () => {
    expect(evaluatePolicyGate(input, now)).toMatchObject({ status: 'OWNER_REVIEW_REQUIRED', eligible: true, executionAllowed: false })
  })
  it('freezes owner-confirmed policy including nested channel list', () => {
    const snapshot = createServicePolicySnapshot(policy)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.allowedChannels)).toBe(true)
    expect(() => createServicePolicySnapshot({ ...policy, minPriceKrw: -1 })).toThrow()
  })
  it('rejects a 35000 offer below the owner minimum of 40000', () => {
    expect(evaluatePolicyGate({ ...input, proposal: { ...proposal, offerPriceKrw: 35000 } }, now)).toMatchObject({ status: 'BLOCKED', reason: 'MIN_PRICE' })
  })
  it('uses basis points and exact integer comparison for discount limits', () => {
    expect(evaluatePolicyGate({ ...input, policy: { ...policy, maxDiscountBps: 999 } }, now).reason).toBe('DISCOUNT_LIMIT')
    expect(evaluatePolicyGate({ ...input, policy: { ...policy, maxDiscountBps: 1000 } }, now).status).toBe('OWNER_REVIEW_REQUIRED')
  })
  it('counts completed plus reserved plus requested discount cases', () => {
    expect(evaluatePolicyGate({ ...input, proposal: { ...proposal, discountCaseCount: 4 } }, now).reason).toBe('DISCOUNT_CASE_LIMIT')
    expect(evaluatePolicyGate({ ...input, proposal: { ...proposal, discountCaseCount: 3 } }, now).status).toBe('OWNER_REVIEW_REQUIRED')
  })
  it('enforces both per-action and period budgets including reservations', () => {
    expect(evaluatePolicyGate({ ...input, proposal: { ...proposal, quotedCostKrw: 2001 } }, now).reason).toBe('ACTION_BUDGET')
    expect(evaluatePolicyGate({ ...input, usage: { ...usage, budgetReservedKrw: 8500 } }, now).reason).toBe('PERIOD_BUDGET')
    expect(evaluatePolicyGate({ ...input, usage: { ...usage, budgetReservedKrw: 8000 } }, now).status).toBe('OWNER_REVIEW_REQUIRED')
  })
  it('blocks channels outside the exact service policy', () => {
    expect(evaluatePolicyGate({ ...input, proposal: { ...proposal, channel: 'THREADS' } }, now).reason).toBe('CHANNEL_NOT_ALLOWED')
  })
  it.each([
    { policy: { ...policy, workspaceId: 'B' } }, { facts: { ...facts, serviceId: 'other' } },
    { usage: { ...usage, workspaceId: 'B' } }, { usage: { ...usage, policyVersion: 'old' } },
    { proposal: { ...proposal, policyVersion: 'old' } },
  ])('rejects foreign scope or stale policy version %j', change => {
    expect(evaluatePolicyGate({ ...input, ...change }, now).status).toBe('BLOCKED')
  })
  it.each([
    { policy: { ...policy, validUntil: now } }, { policy: { ...policy, validFrom: '2026-10-22T00:00:00Z' } },
    { facts: { ...facts, validUntil: now } }, { facts: { ...facts, observedAt: '2027-01-01T00:00:00Z' } },
    { usage: { ...usage, validUntil: now } }, { usage: { ...usage, observedAt: '2027-01-01T00:00:00Z' } },
    { usage: { ...usage, windowStart: '2026-10-02T00:00:00Z' } }, { proposal: { ...proposal, expiresAt: now } },
    { proposal: { ...proposal, costQuoteValidUntil: now } }, { proposal: { ...proposal, costQuoteObservedAt: '2027-01-01T00:00:00Z' } },
  ])('fails closed for expired stale or non-matching read windows %j', change => {
    expect(evaluatePolicyGate({ ...input, ...change }, now).status).toBe('BLOCKED')
  })
  it('requires current verified catalog price and version', () => {
    expect(evaluatePolicyGate({ ...input, facts: { ...facts, priceKrw: 51000 } }, now).reason).toBe('PRICE_FACT_MISMATCH')
    expect(evaluatePolicyGate({ ...input, facts: { ...facts, version: 'catalog-2' } }, now).reason).toBe('PRICE_FACT_MISMATCH')
    expect(evaluatePolicyGate({ ...input, facts: { ...facts, status: 'UNKNOWN' } }, now).status).toBe('BLOCKED')
  })
  it('exact approval prepares only an atomic reservation request, never autonomous spend', () => {
    expect(evaluatePolicyGate({ ...input, approval: approvalFor(input) }, now)).toMatchObject({ status: 'PREPARED', eligible: true, executionAllowed: false, requiresAtomicReservation: true })
  })
  it.each([{ quotedCostKrw: 1001 }, { mediaRefs: ['media-2'] }, { contentRevision: 'draft-2' }, { content: '승인 원고와 다른 안내' }])('requires reapproval after approved scope changes %j', change => {
    expect(evaluatePolicyGate({ ...input, proposal: { ...proposal, ...change }, approval: approvalFor(input) }, now).status).toBe('REAPPROVAL_REQUIRED')
  })
  it('binds updated owner policy even when new limits still permit the proposal', () => {
    expect(evaluatePolicyGate({ ...input, policy: { ...policy, maxDiscountCases: 6 }, approval: approvalFor(input) }, now).status).toBe('REAPPROVAL_REQUIRED')
  })
  it('rejects expired or foreign owner approval', () => {
    expect(evaluatePolicyGate({ ...input, approval: { ...approvalFor(input), validUntil: now } }, now).status).toBe('REAPPROVAL_REQUIRED')
    expect(evaluatePolicyGate({ ...input, approval: { ...approvalFor(input), workspaceId: 'B' } }, now).status).toBe('REAPPROVAL_REQUIRED')
  })
  it('does not hide targeted marketing under a public-promotion purpose', () => {
    expect(evaluatePolicyGate({ ...input, proposal: { ...proposal, recipientRefs: ['customer-1'] } }, now).reason).toBe('PURPOSE_MISMATCH')
  })
  it('requires exact-purpose customer consent and reapproval when targets change', () => {
    const targeted = { ...input, proposal: { ...proposal, channel: 'KAKAO', purpose: 'MARKETING', recipientRefs: ['customer-1'] } }
    expect(evaluatePolicyGate(targeted, now).reason).toBe('CONSENT_REQUIRED')
    const grant = { workspaceId: 'A', customerId: 'customer-1', channel: 'KAKAO', purpose: 'MARKETING', id: 'consent-1', action: 'GRANTED', occurredAt: '2026-10-01T00:00:00Z', source: 'CUSTOMER_FORM', evidenceRef: 'proof-1', actorRef: 'customer-1' }
    const consented = { ...targeted, consents: { status: 'OK', events: [grant] } }
    expect(evaluatePolicyGate(consented, now).status).toBe('OWNER_REVIEW_REQUIRED')
    const approval = approvalFor(consented)
    expect(evaluatePolicyGate({ ...consented, approval }, now).status).toBe('PREPARED')
    const changed = { ...consented, proposal: { ...targeted.proposal, recipientRefs: ['customer-2'] }, consents: { status: 'OK', events: [{ ...grant, customerId: 'customer-2' }] }, approval }
    expect(evaluatePolicyGate(changed, now).status).toBe('REAPPROVAL_REQUIRED')
    expect(evaluatePolicyGate({ ...consented, consents: { status: 'OK', events: [{ ...grant, action: 'REVOKED' }] }, approval }, now).reason).toBe('CONSENT_REQUIRED')
    for (const change of [{ workspaceId: 'B' }, { customerId: 'other' }, { channel: 'SMS' }, { purpose: 'INFO' }, { expiresAt: now }]) {
      expect(evaluatePolicyGate({ ...consented, consents: { status: 'OK', events: [{ ...grant, ...change }] }, approval }, now).reason).toBe('CONSENT_REQUIRED')
    }
    expect(evaluatePolicyGate({ ...consented, consents: { status: 'ERROR' }, approval }, now).reason).toBe('CONSENT_REQUIRED')
  })
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN])('rejects invalid money %s instead of rounding it', value => {
    expect(evaluatePolicyGate({ ...input, proposal: { ...proposal, quotedCostKrw: value } }, now).status).toBe('BLOCKED')
  })
  it('accepts explicitly verified free services without inventing a price', () => {
    expect(evaluatePolicyGate({ ...input, policy: { ...policy, minPriceKrw: 0 }, facts: { ...facts, priceKrw: 0 }, proposal: { ...proposal, servicePriceKrw: 0, offerPriceKrw: 0, discountCaseCount: 0 } }, now).status).toBe('OWNER_REVIEW_REQUIRED')
  })
  it('does not allow duplicate recipients or arbitrary no-discount case consumption', () => {
    expect(evaluatePolicyGate({ ...input, proposal: { ...proposal, recipientRefs: ['same', 'same'] } }, now).status).toBe('BLOCKED')
    expect(evaluatePolicyGate({ ...input, proposal: { ...proposal, offerPriceKrw: 50000, discountCaseCount: 1 } }, now).status).toBe('BLOCKED')
  })
})
