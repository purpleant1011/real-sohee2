import { describe, expect, it } from 'vitest'
import { prepareDepositIntent } from './deposit-intent'

const now = '2026-10-21T10:00:00Z'
const booking = { workspaceId: 'workspace-a', bookingId: 'booking-a', customerId: 'customer-a', version: 2, serviceVersion: 'catalog-2', status: 'CONFIRMED' as const, totalServicePriceKrw: 50000 }
const request = { workspaceId: 'workspace-a', bookingId: 'booking-a', bookingVersion: 2, serviceVersion: 'catalog-2', policy: 'OPTIONAL' as const, selected: true, ownerConfirmed: true, depositAmountKrw: 10000, refundRuleVersion: 'refund-1', cancellationTerms: '방문 하루 전까지 취소 가능', merchantRef: 'shop-merchant', settlementActor: 'SHOP' as const, expiresAt: '2026-10-22T10:00:00Z', idempotencyKey: 'booking-a-v2-deposit' }

describe('provider-independent deposit preparation', () => {
  it('defaults to no deposit and never creates a PG object', () => {
    expect(prepareDepositIntent({ workspaceId: 'workspace-a', bookingId: 'booking-a', bookingVersion: 2, serviceVersion: 'catalog-2' }, booking, now)).toEqual({ status: 'NOT_REQUIRED', intent: null })
  })
  it('does not prepare unselected optional payments', () => {
    expect(prepareDepositIntent({ ...request, selected: false }, booking, now).status).toBe('NOT_REQUIRED')
  })
  it('snapshots terms without claiming payment or provider acceptance', () => {
    const result = prepareDepositIntent(request, booking, now)
    expect(result.status).toBe('DRAFT')
    if (result.status !== 'DRAFT') throw new Error('expected draft')
    expect(result.intent).toMatchObject({ amountKrw: 10000, currency: 'KRW', customerId: 'customer-a', totalServicePriceKrw: 50000, remainingServicePriceKrw: 40000, refundRuleVersion: 'refund-1', settlementActor: 'SHOP' })
    expect(Object.isFrozen(result.intent)).toBe(true)
    expect(result.intent).not.toHaveProperty('providerPaymentId')
  })
  it.each([0, -1, 1.5, 50001, Number.MAX_SAFE_INTEGER + 1, NaN])('rejects invalid deposit %s', (amount) => {
    expect(() => prepareDepositIntent({ ...request, depositAmountKrw: amount }, booking, now)).toThrow()
  })
  it.each([
    { workspaceId: 'other' }, { bookingId: 'orphan' }, { bookingVersion: 1 }, { serviceVersion: 'catalog-1' },
    { ownerConfirmed: false }, { expiresAt: now }, { expiresAt: 'invalid' }, { merchantRef: '' }, { refundRuleVersion: '' },
    { settlementActor: 'SOHEE' },
  ])('rejects stale or unapproved terms %j', (change) => {
    expect(() => prepareDepositIntent({ ...request, ...change }, booking, now)).toThrow()
  })
  it('requires owner confirmation for REQUIRED policy', () => {
    expect(() => prepareDepositIntent({ ...request, policy: 'REQUIRED', ownerConfirmed: false }, booking, now)).toThrow()
  })
  it('rejects cancelled bookings even for a no-deposit path', () => {
    expect(() => prepareDepositIntent(request, { ...booking, status: 'CANCELLED' }, now)).toThrow()
  })
  it('is deterministic for a same-key retry but does not claim durable deduplication', () => {
    expect(prepareDepositIntent(request, booking, now)).toEqual(prepareDepositIntent(request, booking, now))
  })
})
