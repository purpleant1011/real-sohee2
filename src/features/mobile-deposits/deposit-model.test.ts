import { describe, expect, it } from 'vitest'
import {
  applyCallback,
  applyReadback,
  chargeGuard,
  depositListItem,
  depositView,
  type DepositRecord,
  type DepositView,
} from './deposit-model'

const base = (o: Partial<DepositRecord> = {}): DepositRecord => ({
  workspaceId: 'w1',
  bookingId: 'b1',
  provider: 'portone',
  availability: 'supported',
  amount: 30000,
  currency: 'KRW',
  termsAcceptedAt: '2026-10-22T00:00:00Z',
  transport: 'not_started',
  providerAccepted: null,
  readback: 'pending',
  readbackAt: null,
  receiptRef: null,
  refund: null,
  idempotencyKey: 'deposit-b1-1',
  seenCallbacks: [],
  ...o,
})

const label = (o: Partial<DepositRecord>): string => (depositView(base(o)) as DepositView).label

describe('예약금 PG 복귀 상태', () => {
  it('URL success 만으로는 결제 완료가 아니다', () => {
    const view = depositView(base({ transport: 'returned_success', providerAccepted: 'accepted', readback: 'pending' }))
    expect(view.label).not.toContain('완료')
    expect(view.confirmedPaid).toBe(false)
    expect(view.next).toBe('잠시 후 다시 확인')
  })

  it('서버 영수증 readback verified 일 때만 결제 확인 완료', () => {
    expect(label({ transport: 'returned_success', providerAccepted: 'accepted', readback: 'pending' })).toBe('결제 확인 중')
    const verified = depositView(base({ transport: 'returned_success', providerAccepted: 'accepted', readback: 'verified', readbackAt: '2026-10-22T01:00:00Z', receiptRef: 'r1' }))
    expect(verified.label).toBe('예약금 확인 완료')
    expect(verified.confirmedPaid).toBe(true)
  })

  it('영수증 참조 없이 verified 를 주장하면 not_verified 로 내린다', () => {
    const next = applyReadback(base(), 'verified', '2026-10-22T01:00:00Z', null)
    expect(next.readback).toBe('not_verified')
    expect(depositView(next).label).toBe('결제가 확인되지 않았어요')
  })

  it('readback 불가면 result_unknown 성격으로 남는다(0원/완료 표시 금지)', () => {
    const view = depositView(base({ transport: 'returned_success', providerAccepted: 'accepted', readback: 'unavailable' }))
    expect(view.label).toBe('결제 결과를 확인하지 못했어요')
    expect(view.tone).toBe('warning')
    expect(view.confirmedPaid).toBe(false)
  })

  it('중복 callback 은 한 번만 반영된다', () => {
    const cb = { id: 'cb1', kind: 'paid' as const, providerAccepted: 'accepted' as const }
    const once = applyCallback(base(), cb)
    const twice = applyCallback(once, cb)
    expect(twice.seenCallbacks).toEqual(['cb1'])
    expect(twice).toEqual(once)
    expect(twice.readback).toBe('pending')
  })

  it('되돌아온 결제는 다시 결제를 허용하지 않는다(이중 청구 방지)', () => {
    const guard = chargeGuard(base({ transport: 'returned_success', providerAccepted: 'accepted', readback: 'pending' }))
    expect(guard.allowed).toBe(false)
    if (!guard.allowed) expect(guard.reason).toBe('readback_pending')
  })

  it('결제 확인 완료 건은 재결제 차단', () => {
    const guard = chargeGuard(base({ transport: 'returned_success', readback: 'verified', receiptRef: 'r1' }))
    expect(guard.allowed).toBe(false)
    if (!guard.allowed) expect(guard.reason).toBe('already_paid')
  })

  it('미지원 매장은 예약금 UI 를 숨긴다', () => {
    expect(depositView(base({ availability: 'not_supported' })).visible).toBe(false)
    expect(depositListItem(base({ availability: 'not_supported' }))).toBeNull()
  })

  it('금액·약관 미확인은 결제 차단 + 다음 행동', () => {
    const noAmount = chargeGuard(base({ amount: null }))
    expect(noAmount.allowed).toBe(false)
    if (!noAmount.allowed) expect(noAmount.next).toBe('예약 정보 새로고침')
    const noTerms = chargeGuard(base({ termsAcceptedAt: null }))
    expect(noTerms.allowed).toBe(false)
    if (!noTerms.allowed) expect(noTerms.reason).toBe('terms_required')
  })

  it('멱등 키가 없으면 결제 시작 금지', () => {
    const guard = chargeGuard(base({ idempotencyKey: null }))
    expect(guard.allowed).toBe(false)
    if (!guard.allowed) expect(guard.reason).toBe('missing_idempotency')
  })

  it('환불 상태를 시각화한다', () => {
    expect(label({ refund: { state: 'requested', requestedAt: '2026-10-22T02:00:00Z', readbackAt: null } })).toBe('환불 처리 중')
    expect(label({ refund: { state: 'verified', requestedAt: '2026-10-22T02:00:00Z', readbackAt: '2026-10-22T03:00:00Z' } })).toBe('예약금 환불 완료')
    expect(label({ refund: { state: 'failed', requestedAt: '2026-10-22T02:00:00Z', readbackAt: null } })).toBe('환불이 완료되지 않았어요')
  })

  it('확인 전 예약금은 매출로 집계하지 않는다', () => {
    expect(depositListItem(base({ transport: 'returned_success', readback: 'pending' }))?.confirmed).toBe(false)
    expect(depositListItem(base({ readback: 'verified', receiptRef: 'r1' }))?.confirmed).toBe(true)
  })

  it('결제사가 연결되지 않았으면 금액은 보여주되 결제를 시작하지 않는다', () => {
    const record = base({ provider: 'none', termsAcceptedAt: null, readback: 'unavailable', idempotencyKey: null })
    const view = depositView(record)
    expect(view.label).toBe('예약금 30,000원')
    expect(view.confirmedPaid).toBe(false)
    expect(view.detail).toContain('아직 연결되지 않았어요')
    const guard = chargeGuard(record)
    expect(guard.allowed).toBe(false)
    if (!guard.allowed) expect(guard.reason).toBe('provider_not_connected')
  })

  it('서버 영수증까지 확인된 건은 결제사가 연결되지 않았어도 이미 결제된 건으로 남긴다', () => {
    const guard = chargeGuard(base({ provider: 'none', readback: 'verified', receiptRef: 'r1' }))
    expect(guard.allowed).toBe(false)
    if (!guard.allowed) expect(guard.reason).toBe('already_paid')
  })
})
