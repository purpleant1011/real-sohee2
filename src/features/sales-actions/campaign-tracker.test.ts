import { describe, expect, it } from 'vitest'
import { projectCampaign, approvalToCampaignEvent, type CampaignEvent } from './campaign-tracker'
import type { SalesApprovalResult } from './approval'

const T0 = '2026-10-21T10:00:00Z'
const base = { workspaceId: 'A', campaignId: 'camp-1' }
const approved: CampaignEvent = { ...base, type: 'PROPOSAL_APPROVED', eventId: 'e1', proposalFingerprint: 'p'.repeat(64), campaignTag: 'camp1', approvedAt: T0, expectedCostKrw: 1000 }
const published: CampaignEvent = { ...base, type: 'POST_PUBLISHED', eventId: 'e2', channel: 'INSTAGRAM', providerPostId: 'ig-1', providerReceiptRef: 'rcpt-1', publishedAt: '2026-10-21T10:05:00Z' }
const readback: CampaignEvent = { ...base, type: 'POST_READBACK', eventId: 'e3', result: 'VERIFIED', permalink: 'https://instagram.com/p/x', readAt: '2026-10-21T10:06:00Z' }
const window = (kind: 'INQUIRY' | 'BOOKING', coverage: 'COMPLETE' | 'PARTIAL' | 'NONE', id = `w-${kind}`): CampaignEvent => ({ ...base, type: 'OBSERVATION_WINDOW', eventId: id, kind, coverage, from: '2026-10-21T10:05:00Z', to: '2026-10-28T10:05:00Z' })
const booking = (id: string, status: 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'NO_SHOW', over: Partial<Extract<CampaignEvent, { type: 'BOOKING_OBSERVED' }>> = {}): CampaignEvent => ({ ...base, type: 'BOOKING_OBSERVED', eventId: `be-${id}`, bookingId: id, customerRef: `cust-${id}`, campaignTag: 'camp1', status, observedAt: '2026-10-22T09:00:00Z', ...over })
const inquiry = (id: string, over: Partial<Extract<CampaignEvent, { type: 'INQUIRY_OBSERVED' }>> = {}): CampaignEvent => ({ ...base, type: 'INQUIRY_OBSERVED', eventId: `ie-${id}`, customerRef: id, campaignTag: 'camp1', observedAt: '2026-10-22T08:00:00Z', ...over })
const project = (events: CampaignEvent[]) => projectCampaign(events, { workspaceId: 'A', campaignId: 'camp-1', now: '2026-10-25T00:00:00Z' })

describe('ANI-1628 traceable campaign projection', () => {
  it('reports one linked booking as linked, never as incremental revenue', () => {
    const p = project([approved, published, readback, window('INQUIRY', 'COMPLETE'), window('BOOKING', 'COMPLETE'), booking('b1', 'CONFIRMED')])
    expect(p.stage).toBe('PUBLISHED_VERIFIED')
    expect(p.bookings.linked).toBe(1)
    expect(p.ownerLines).toContain('캠페인에 연결된 예약 1건')
    expect(p.incrementalClaim).toBe(false)
    expect(p.ownerLines.join(' ')).not.toMatch(/매출|증가|늘/)
  })
  it('shows unobserved, not zero, when no observation window covers inquiries or bookings', () => {
    const p = project([approved, published, readback])
    expect(p.inquiries).toEqual({ state: 'NOT_OBSERVED', count: null })
    expect(p.bookings.state).toBe('NOT_OBSERVED'); expect(p.bookings.linked).toBeNull()
    expect(p.ownerLines.join(' ')).toContain('아직 확인하지 못했어요')
  })
  it('reports a real zero only with a complete observation window', () => {
    const p = project([approved, published, readback, window('INQUIRY', 'COMPLETE'), window('BOOKING', 'COMPLETE')])
    expect(p.inquiries).toEqual({ state: 'OBSERVED', count: 0 })
    expect(p.bookings.linked).toBe(0)
  })
  it('marks partial coverage as a lower bound', () => {
    const p = project([approved, published, window('BOOKING', 'PARTIAL'), booking('b1', 'CONFIRMED')])
    expect(p.bookings).toMatchObject({ state: 'PARTIAL', linked: 1 })
  })
  it('separates completed, pending, canceled and no-show bookings', () => {
    const p = project([approved, published, window('BOOKING', 'COMPLETE'), booking('b1', 'COMPLETED'), booking('b2', 'CONFIRMED'), booking('b3', 'CANCELED'), booking('b4', 'NO_SHOW')])
    expect(p.bookings).toMatchObject({ linked: 4, completed: 1, pending: 1, canceled: 1, noShow: 1 })
  })
  it('is idempotent: replayed or duplicated events change nothing', () => {
    const events = [approved, published, window('BOOKING', 'COMPLETE'), booking('b1', 'CONFIRMED')]
    const once = project(events)
    expect(project([...events, ...events, booking('b1', 'CONFIRMED')])).toEqual(once)
  })
  it('flags a conflicting replay of the same event id instead of silently choosing', () => {
    const p = project([approved, published, window('BOOKING', 'COMPLETE'), booking('b1', 'CONFIRMED'), booking('b1', 'CANCELED', { eventId: 'be-b1' })])
    expect(p.integrity).toBe('CONFLICT'); expect(p.stage).toBe('RESULT_UNKNOWN')
  })
  it('counts one customer once and ignores another campaign tag, another tenant, and activity before publishing', () => {
    const p = project([approved, published, window('BOOKING', 'COMPLETE'), window('INQUIRY', 'COMPLETE'),
      booking('b1', 'CONFIRMED'), booking('b1b', 'CONFIRMED', { customerRef: 'cust-b1' }),
      booking('b2', 'CONFIRMED', { campaignTag: 'other' }), booking('b3', 'CONFIRMED', { workspaceId: 'B' }),
      booking('b4', 'CONFIRMED', { observedAt: '2026-10-21T09:00:00Z' }),
      inquiry('c1'), inquiry('c1', { eventId: 'ie-dup' })])
    expect(p.bookings.linked).toBe(1); expect(p.inquiries.count).toBe(1)
    expect(p.excluded).toMatchObject({ foreignWorkspace: 1, otherCampaign: 1, beforePublish: 1 })
  })
  it('does not claim publication from approval alone, nor verification from a provider receipt alone', () => {
    expect(project([approved]).stage).toBe('APPROVED_NOT_PUBLISHED')
    expect(project([approved, published]).stage).toBe('PUBLISHED_UNVERIFIED')
    expect(project([approved, published, { ...readback, result: 'UNKNOWN' } as CampaignEvent]).stage).toBe('RESULT_UNKNOWN')
  })
  it('keeps expected and actual cost separate and never invents actual cost', () => {
    expect(project([approved]).cost).toEqual({ expectedKrw: 1000, actualKrw: null })
    expect(project([approved, { ...base, type: 'COST_RECORDED', eventId: 'c1', amountKrw: 800, recordedAt: T0 }]).cost).toEqual({ expectedKrw: 1000, actualKrw: 800 })
  })
  it('ignores events recorded before any approval', () => {
    expect(project([published, booking('b1', 'CONFIRMED')]).stage).toBe('NOT_APPROVED')
  })
})

describe('approval -> campaign wiring', () => {
  const ok: SalesApprovalResult = { status: 'APPROVED_RESERVED', ownerMessage: '', alternative: '', reasonCode: 'APPROVED', warnings: [], reservationId: 'r1', policyFingerprint: 'a'.repeat(64), proposalFingerprint: 'b'.repeat(64), executionAllowed: false }
  it('creates a campaign event only from a reserved approval', () => {
    expect(approvalToCampaignEvent(ok, { workspaceId: 'A', campaignId: 'camp-1', campaignTag: 'camp1', approvedAt: T0, expectedCostKrw: 1000 })).toMatchObject({ type: 'PROPOSAL_APPROVED', proposalFingerprint: 'b'.repeat(64) })
    for (const status of ['BLOCKED', 'OWNER_REVIEW_REQUIRED', 'REAPPROVAL_REQUIRED', 'RESERVATION_FAILED'] as const) {
      expect(approvalToCampaignEvent({ ...ok, status }, { workspaceId: 'A', campaignId: 'c', campaignTag: 't', approvedAt: T0, expectedCostKrw: 0 })).toBeNull()
    }
  })
})
