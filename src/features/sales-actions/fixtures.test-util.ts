// Shared deterministic fixtures for sales-actions tests. Not imported by production code.
export const NOW = '2026-10-21T10:00:00Z'
export const policy = { workspaceId: 'A', serviceId: 'service-1', version: 'policy-1', minPriceKrw: 40000, maxDiscountBps: 2000, maxDiscountCases: 5, allowedChannels: ['INSTAGRAM', 'KAKAO'], perActionBudgetKrw: 2000, periodBudgetKrw: 10000, validFrom: '2026-10-01T00:00:00Z', validUntil: '2026-11-01T00:00:00Z', confirmedBy: 'owner-A', evidenceRef: 'policy-proof' }
export const proposal = { workspaceId: 'A', serviceId: 'service-1', policyVersion: 'policy-1', catalogVersion: 'catalog-1', channel: 'INSTAGRAM', purpose: 'PUBLIC_PROMOTION', servicePriceKrw: 50000, offerPriceKrw: 45000, discountCaseCount: 1, quotedCostKrw: 1000, costQuoteRef: 'quote-1', costQuoteObservedAt: '2026-10-21T09:55:00Z', costQuoteValidUntil: '2026-10-21T10:10:00Z', contentRevision: 'draft-1', content: '확인된 서비스 안내', recipientRefs: [] as string[], mediaRefs: ['media-1'], expiresAt: '2026-10-21T10:20:00Z' }
export const facts = { workspaceId: 'A', serviceId: 'service-1', version: 'catalog-1', status: 'VERIFIED', priceKrw: 50000, observedAt: '2026-10-21T09:50:00Z', validUntil: '2026-10-21T10:30:00Z', evidenceRef: 'price-proof' }
export const usage = { workspaceId: 'A', serviceId: 'service-1', policyVersion: 'policy-1', status: 'CURRENT', windowStart: policy.validFrom, windowEnd: policy.validUntil, observedAt: '2026-10-21T09:59:00Z', validUntil: '2026-10-21T10:05:00Z', discountCasesUsed: 1, discountCasesReserved: 1, budgetSpentKrw: 1000, budgetReservedKrw: 1000, evidenceRef: 'usage-proof' }
export const gateInput = { policy, proposal, facts, usage, consents: { status: 'OK', events: [] as unknown[] } }

import { generateSlotOpportunity, type SlotLedgerSnapshot } from '@/features/opportunity/slot-opportunity'

const range = { startsAt: '2026-10-21T23:00:00.000+09:00', endsAt: '2026-10-22T02:00:00.000+09:00' }
export function slotSnapshot(workspaceId = 'A', over: Partial<Extract<SlotLedgerSnapshot, { state: 'SUCCESS' }>> = {}): SlotLedgerSnapshot {
  return {
    state: 'SUCCESS', workspaceId, datasetMode: 'ACTUAL', freshness: 'CURRENT', coverage: 'COMPLETE', queryRange: range, timezone: 'Asia/Seoul',
    source: { workspaceId, kind: 'OWNER_CONFIRMED', sourceId: 'src-1', evidenceId: 'ev-ledger', checkedAt: '2026-10-21T09:55:00.000Z', validUntil: '2026-10-21T10:10:00.000Z', ledgerVersion: 'lv-1', confirmedByRef: 'owner-A' },
    ledgerVersion: 'lv-1',
    candidate: {
      slotId: 'slot-1', slotVersion: 'sv-1', catalogVersion: 'catalog-1', workspaceId, serviceId: 'service-1',
      range: { startsAt: '2026-10-21T23:00:00.000+09:00', endsAt: '2026-10-22T00:00:00.000+09:00' }, timezone: 'Asia/Seoul', status: 'AVAILABLE',
      resource: { workspaceId, ledgerVersion: 'lv-1', resourceId: 'res-1', evidenceId: 'ev-res', version: 'rv-1', checkedAt: '2026-10-21T09:50:00.000Z', validUntil: '2026-10-21T11:00:00.000Z', capacity: 1, availableCapacity: 1 },
      service: { workspaceId, serviceId: 'service-1', catalogVersion: 'catalog-1', evidenceId: 'ev-srv', checkedAt: '2026-10-21T09:50:00.000Z', validUntil: '2026-10-21T11:00:00.000Z', durationMinutes: 45, requiredCapacity: 1, priceKrw: 50000 },
    },
    ...over,
  }
}
export const slotRequest = (workspaceId = 'A') => ({ workspaceId, queryRange: range, timezone: 'Asia/Seoul' })
export const verifiedSlot = (workspaceId = 'A') => generateSlotOpportunity({ request: slotRequest(workspaceId), readLedger: async () => slotSnapshot(workspaceId), now: NOW })
export const unverifiedSlot = () => generateSlotOpportunity({ request: slotRequest(), readLedger: null, now: NOW })
