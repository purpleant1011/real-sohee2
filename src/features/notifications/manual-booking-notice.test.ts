import { describe, expect, it } from 'vitest'
import { composeManualNotice, recordManualProgress } from './manual-booking-notice'

const booking = { workspaceId: 'a', bookingId: 'b', customerId: 'c', version: 2, status: 'CONFIRMED' as const, shopName: '테스트 사업장', serviceName: '상담 서비스', startsAt: '2026-10-22T07:00:00Z', location: '확인된 위치', supportContact: '매장 문의 경로', changeInstructions: '변경·취소는 매장으로 문의해 주세요.' }
const scope = { workspaceId: 'a', bookingId: 'b', customerId: 'c', bookingVersion: 2 }
const action = { type: 'COPIED' as const, actorRef: 'owner-a', occurredAt: '2026-10-21T10:00:00Z' }

describe('manual booking notice preparation without provider writes', () => {
  it('uses confirmed facts and Seoul time, not fictional prices or automatic sent status', () => {
    const notice = composeManualNotice(booking, scope)
    expect(notice.body).toContain('16:00')
    expect(notice.body).toContain('상담 서비스')
    expect(notice.body).toContain('확인된 위치')
    expect(notice.body).not.toContain('원')
    expect(notice.state).toBe('PREPARED')
    expect(notice.providerVerified).toBe(false)
    expect(notice.checklist.length).toBeGreaterThan(0)
  })
  it('never treats copy as send evidence', () => {
    const notice = recordManualProgress(composeManualNotice(booking, scope), action, booking)
    expect(notice.state).toBe('COPIED')
    expect(notice.confirmedBy).toBeNull()
    expect(notice.providerVerified).toBe(false)
  })
  it('records owner attestation separately and preserves it on duplicate clicks', () => {
    const first = recordManualProgress(composeManualNotice(booking, scope), { ...action, type: 'OWNER_CONFIRMED_SENT' }, booking)
    expect(first.state).toBe('OWNER_CONFIRMED_SENT')
    expect(first.providerVerified).toBe(false)
    expect(first.confirmedBy).toBe('owner-a')
    expect(recordManualProgress(first, { ...action, type: 'OWNER_CONFIRMED_SENT', occurredAt: '2026-10-21T10:01:00Z' }, booking)).toEqual(first)
    expect(recordManualProgress(first, action, booking).state).toBe('OWNER_CONFIRMED_SENT')
  })
  it.each([{ version: 3 }, { workspaceId: 'other' }, { customerId: 'other' }, { status: 'CANCELLED' }, { startsAt: '2026-10-22T08:00:00Z' }])('blocks stale manual confirmation %j', change => {
    const notice = composeManualNotice(booking, scope)
    expect(() => recordManualProgress(notice, action, { ...booking, ...change })).toThrow()
  })
  it('detects tampered body and missing actor', () => {
    const notice = composeManualNotice(booking, scope)
    expect(() => recordManualProgress({ ...notice, body: '다른 내용' }, action, booking)).toThrow()
    expect(() => recordManualProgress(notice, { ...action, actorRef: '' }, booking)).toThrow()
  })
  it('requires current scope and confirmed booking', () => {
    expect(() => composeManualNotice({ ...booking, status: 'CANCELLED' }, scope)).toThrow()
    expect(() => composeManualNotice(booking, { ...scope, bookingVersion: 1 })).toThrow()
  })
})
