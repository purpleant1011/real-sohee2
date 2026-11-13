import { describe, expect, it, vi } from 'vitest'
import { evaluatePolicyGate } from '@/features/policy-gate/service-policy'
import { NOW, gateInput, proposal } from './fixtures.test-util'
import { approveSalesProposal, reviewProposalPolicy, type ReservationPort } from './approval'
import type { CtaPreflightResult } from './cta-preflight'

const okCta: CtaPreflightResult = { status: 'OK', warnings: [], ownerMessage: '' }
const approvalFor = (input: unknown) => {
  const g = evaluatePolicyGate(input, NOW)
  return { workspaceId: 'A', policyFingerprint: g.policyFingerprint!, proposalFingerprint: g.proposalFingerprint!, approvedBy: 'owner-A', approvedAt: NOW, validUntil: '2026-10-21T10:10:00Z' }
}
const reserve = () => vi.fn<ReservationPort>(async () => ({ status: 'RESERVED', reservationId: 'r1' }))

describe('ANI-1627 policy gate on the proposal -> approval path', () => {
  it('shows the owner why a 35,000원 offer under a 40,000원 minimum is blocked, with an alternative', () => {
    const r = reviewProposalPolicy({ ...gateInput, proposal: { ...proposal, offerPriceKrw: 35000 } }, NOW)
    expect(r.status).toBe('BLOCKED')
    expect(r.ownerMessage).toContain('최저 가격')
    expect(r.alternative).toBeTruthy()
    expect(r.ownerMessage).not.toMatch(/MIN_PRICE/)
  })
  it.each([
    ['discount cases', { ...gateInput, proposal: { ...proposal, discountCaseCount: 4 } }],
    ['channel', { ...gateInput, proposal: { ...proposal, channel: 'THREADS' } }],
    ['per-action cost', { ...gateInput, proposal: { ...proposal, quotedCostKrw: 2001 } }],
  ])('blocks %s violations and never reserves', async (_n, input) => {
    const port = reserve()
    const r = await approveSalesProposal({ gateInput: input, approval: approvalFor(gateInput), cta: okCta, now: NOW, reserve: port })
    expect(r.status).toBe('BLOCKED')
    expect(port).not.toHaveBeenCalled()
  })
  it('within-policy proposal waits for owner review, with no execution and no reservation', async () => {
    const port = reserve()
    const r = await approveSalesProposal({ gateInput, approval: undefined, cta: okCta, now: NOW, reserve: port })
    expect(r).toMatchObject({ status: 'OWNER_REVIEW_REQUIRED', executionAllowed: false })
    expect(port).not.toHaveBeenCalled()
  })
  it('requires re-approval when the approved payload changed', async () => {
    const port = reserve()
    const stale = approvalFor(gateInput)
    const changed = { ...gateInput, proposal: { ...proposal, content: '다른 문구' } }
    const r = await approveSalesProposal({ gateInput: changed, approval: stale, cta: okCta, now: NOW, reserve: port })
    expect(r.status).toBe('REAPPROVAL_REQUIRED')
    expect(port).not.toHaveBeenCalled()
  })
  it('reserves atomically with an idempotency key only after gate + CTA pass, still without execution', async () => {
    const port = reserve()
    const r = await approveSalesProposal({ gateInput, approval: approvalFor(gateInput), cta: okCta, now: NOW, reserve: port })
    expect(r).toMatchObject({ status: 'APPROVED_RESERVED', reservationId: 'r1', executionAllowed: false })
    expect(port).toHaveBeenCalledTimes(1)
    expect(port.mock.calls[0][0].idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
  })
  it('blocks approval when the CTA destination is empty', async () => {
    const port = reserve()
    const r = await approveSalesProposal({ gateInput, approval: approvalFor(gateInput), cta: { status: 'BLOCK', warnings: [], ownerMessage: '문의 주소를 먼저 설정해 주세요.' }, now: NOW, reserve: port })
    expect(r.status).toBe('BLOCKED')
    expect(r.ownerMessage).toContain('문의 주소')
    expect(port).not.toHaveBeenCalled()
  })
  it('carries CTA warnings to the owner on a successful approval', async () => {
    const warn: CtaPreflightResult = { status: 'WARN', warnings: [{ code: 'PORTAL_MISMATCH', message: '전화번호가 포털과 달라요.' }], ownerMessage: '' }
    const r = await approveSalesProposal({ gateInput, approval: approvalFor(gateInput), cta: warn, now: NOW, reserve: reserve() })
    expect(r.status).toBe('APPROVED_RESERVED')
    expect(r.warnings).toHaveLength(1)
  })
  it.each([{ status: 'CONFLICT' as const }, { status: 'ERROR' as const }])('does not claim approval when reservation is $status', async res => {
    const r = await approveSalesProposal({ gateInput, approval: approvalFor(gateInput), cta: okCta, now: NOW, reserve: async () => res })
    expect(r.status).toBe('RESERVATION_FAILED')
  })
  it('treats a throwing reservation port as failure, not success', async () => {
    const r = await approveSalesProposal({ gateInput, approval: approvalFor(gateInput), cta: okCta, now: NOW, reserve: async () => { throw new Error('db down') } })
    expect(r.status).toBe('RESERVATION_FAILED')
  })
})
