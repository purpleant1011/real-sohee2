import { describe, expect, it } from 'vitest'
import {
  createSubscriptionOrderDraft,
  verifyPaymentAgainstOrder,
  transitionOrder,
  canTransitionOrder,
  isTerminalOrderStatus,
  InvalidOrderTransitionError,
  type SubscriptionOrder,
  type SubscriptionOrderStatus,
} from './subscription-order'
import { subscriptionOffers } from './subscription-offers'

describe('Subscription Order Model (Pure Domain)', () => {
  describe('createSubscriptionOrderDraft', () => {
    it('creates a draft order with correct amount from subscriptionOffers for STARTER_150K', () => {
      const fixedNow = new Date('2026-11-06T10:00:00.000Z')
      const order = createSubscriptionOrderDraft({
        offerCode: 'STARTER_150K',
        workspaceId: 'ws_test_001',
        actorUserId: 'usr_test_001',
        idempotencyKey: 'idem_key_001',
        now: fixedNow,
        idGenerator: () => 'ord_custom_uuid_001',
      })

      expect(order).toEqual({
        orderId: 'ord_custom_uuid_001',
        offerCode: 'STARTER_150K',
        offerName: '기본 마케팅 직원',
        workspaceId: 'ws_test_001',
        actorUserId: 'usr_test_001',
        idempotencyKey: 'idem_key_001',
        amountKrw: 150000,
        currency: 'KRW',
        status: 'created',
        createdAt: '2026-11-06T10:00:00.000Z',
      })
      expect(Object.isFrozen(order)).toBe(true)
    })

    it('correctly maps amounts for GROWTH_300K and SCALE_500K', () => {
      for (const offer of subscriptionOffers) {
        const order = createSubscriptionOrderDraft({
          offerCode: offer.code,
          workspaceId: 'ws_test_all',
          actorUserId: 'usr_test_all',
          idempotencyKey: `idem_${offer.code}`,
        })
        expect(order.amountKrw).toBe(offer.monthlyTotalPriceKrw)
        expect(order.offerName).toBe(offer.name)
      }
    })

    it('generates a valid UUID orderId by default', () => {
      const order = createSubscriptionOrderDraft({
        offerCode: 'STARTER_150K',
        workspaceId: 'ws_test',
        actorUserId: 'usr_test',
        idempotencyKey: 'idem_uuid',
      })
      expect(order.orderId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    })

    it('preserves storeId if provided', () => {
      const order = createSubscriptionOrderDraft({
        offerCode: 'STARTER_150K',
        workspaceId: 'ws_test',
        actorUserId: 'usr_test',
        idempotencyKey: 'idem_store',
        storeId: 'store-custom-001',
      })
      expect(order.storeId).toBe('store-custom-001')
    })

    it('rejects unknown offer codes', () => {
      expect(() =>
        createSubscriptionOrderDraft({
          offerCode: 'ENTERPRISE_999K',
          workspaceId: 'ws_test',
          actorUserId: 'usr_test',
          idempotencyKey: 'idem_fail',
        })
      ).toThrow(RangeError)
    })

    it('rejects empty or invalid workspaceId, actorUserId, or idempotencyKey', () => {
      expect(() =>
        createSubscriptionOrderDraft({
          offerCode: 'STARTER_150K',
          workspaceId: '   ',
          actorUserId: 'usr_test',
          idempotencyKey: 'idem_test',
        })
      ).toThrow(RangeError)

      expect(() =>
        createSubscriptionOrderDraft({
          offerCode: 'STARTER_150K',
          workspaceId: 'ws_test',
          actorUserId: '',
          idempotencyKey: 'idem_test',
        })
      ).toThrow(RangeError)

      expect(() =>
        createSubscriptionOrderDraft({
          offerCode: 'STARTER_150K',
          workspaceId: 'ws_test',
          actorUserId: 'usr_test',
          idempotencyKey: '  ',
        })
      ).toThrow(RangeError)
    })
  })

  describe('verifyPaymentAgainstOrder', () => {
    const validOrder: SubscriptionOrder = Object.freeze({
      orderId: 'ord_sample_123',
      offerCode: 'STARTER_150K',
      workspaceId: 'ws_001',
      actorUserId: 'usr_001',
      idempotencyKey: 'idem_001',
      amountKrw: 150000,
      currency: 'KRW',
      status: 'created',
      createdAt: '2026-11-06T10:00:00.000Z',
      storeId: 'store-sample-123',
    })

    it('accepts perfectly matching payment', () => {
      const result = verifyPaymentAgainstOrder(validOrder, {
        orderId: 'ord_sample_123',
        amountKrw: 150000,
        currency: 'KRW',
        storeId: 'store-sample-123',
      })
      expect(result).toEqual({ ok: true })
    })

    it('accepts PortOne V2 style payment structure (id and amount.total)', () => {
      const result = verifyPaymentAgainstOrder(validOrder, {
        id: 'ord_sample_123',
        amount: { total: 150000 },
        currency: 'KRW',
        storeId: 'store-sample-123',
      })
      expect(result).toEqual({ ok: true })
    })

    it('rejects orderId mismatch', () => {
      const result = verifyPaymentAgainstOrder(validOrder, {
        orderId: 'ord_other_999',
        amountKrw: 150000,
        currency: 'KRW',
        storeId: 'store-sample-123',
      })
      expect(result).toEqual({
        ok: false,
        reason: 'ORDER_ID_MISMATCH',
        message: expect.any(String),
      })
    })

    it('rejects amount mismatch', () => {
      const result = verifyPaymentAgainstOrder(validOrder, {
        orderId: 'ord_sample_123',
        amountKrw: 100000,
        currency: 'KRW',
        storeId: 'store-sample-123',
      })
      expect(result).toEqual({
        ok: false,
        reason: 'AMOUNT_MISMATCH',
        message: expect.any(String),
      })
    })

    it('rejects currency mismatch', () => {
      const result = verifyPaymentAgainstOrder(validOrder, {
        orderId: 'ord_sample_123',
        amountKrw: 150000,
        currency: 'USD',
        storeId: 'store-sample-123',
      })
      expect(result).toEqual({
        ok: false,
        reason: 'CURRENCY_MISMATCH',
        message: expect.any(String),
      })
    })

    it('rejects storeId mismatch', () => {
      const result = verifyPaymentAgainstOrder(validOrder, {
        orderId: 'ord_sample_123',
        amountKrw: 150000,
        currency: 'KRW',
        storeId: 'store-evil-999',
      })
      expect(result).toEqual({
        ok: false,
        reason: 'STORE_ID_MISMATCH',
        message: expect.any(String),
      })
    })

    it('rejects if both order.storeId and options.expectedStoreId are missing', () => {
      const orderWithoutStore: SubscriptionOrder = {
        ...validOrder,
        storeId: undefined,
      }
      const result = verifyPaymentAgainstOrder(orderWithoutStore, {
        orderId: 'ord_sample_123',
        amountKrw: 150000,
        currency: 'KRW',
        storeId: 'store-sample-123',
      })
      expect(result).toEqual({
        ok: false,
        reason: 'STORE_ID_MISMATCH',
        message: expect.any(String),
      })
    })

    it('rejects if both order.storeId and options.expectedStoreId are missing even if payment has no storeId', () => {
      const orderWithoutStore: SubscriptionOrder = {
        ...validOrder,
        storeId: undefined,
      }
      const result = verifyPaymentAgainstOrder(orderWithoutStore, {
        orderId: 'ord_sample_123',
        amountKrw: 150000,
        currency: 'KRW',
      })
      expect(result).toEqual({
        ok: false,
        reason: 'STORE_ID_MISMATCH',
        message: expect.any(String),
      })
    })

    it('rejects when order.storeId conflicts with options.expectedStoreId even if payment matches expectedStoreId', () => {
      const result = verifyPaymentAgainstOrder(
        validOrder, // storeId: 'store-sample-123'
        {
          orderId: 'ord_sample_123',
          amountKrw: 150000,
          currency: 'KRW',
          storeId: 'store-different-expected',
        },
        { expectedStoreId: 'store-different-expected' }
      )
      expect(result).toEqual({
        ok: false,
        reason: 'STORE_ID_MISMATCH',
        message: expect.any(String),
      })
    })

    it('rejects if payment has no storeId', () => {
      const result = verifyPaymentAgainstOrder(validOrder, {
        orderId: 'ord_sample_123',
        amountKrw: 150000,
        currency: 'KRW',
      })
      expect(result).toEqual({
        ok: false,
        reason: 'STORE_ID_MISMATCH',
        message: expect.any(String),
      })
    })

    it('accepts payment when storeId is verified via options.expectedStoreId for an order without storeId', () => {
      const orderWithoutStore: SubscriptionOrder = {
        ...validOrder,
        storeId: undefined,
      }
      const result = verifyPaymentAgainstOrder(
        orderWithoutStore,
        {
          orderId: 'ord_sample_123',
          amountKrw: 150000,
          currency: 'KRW',
          storeId: 'store-external-expected',
        },
        { expectedStoreId: 'store-external-expected' }
      )
      expect(result).toEqual({ ok: true })
    })

    it('rejects when order.storeId and options.expectedStoreId conflict', () => {
      const result = verifyPaymentAgainstOrder(
        validOrder, // has storeId: 'store-sample-123'
        {
          orderId: 'ord_sample_123',
          amountKrw: 150000,
          currency: 'KRW',
          storeId: 'store-sample-123',
        },
        { expectedStoreId: 'store-different-expected' }
      )
      expect(result).toEqual({
        ok: false,
        reason: 'STORE_ID_MISMATCH',
        message: expect.any(String),
      })
    })

    it('rejects unknown offer in order', () => {
      const badOfferOrder: SubscriptionOrder = {
        ...validOrder,
        offerCode: 'UNKNOWN_FORGED_TIER',
      }
      const result = verifyPaymentAgainstOrder(badOfferOrder, {
        orderId: 'ord_sample_123',
        amountKrw: 150000,
        currency: 'KRW',
        storeId: 'store-sample-123',
      })
      expect(result).toEqual({
        ok: false,
        reason: 'UNKNOWN_OFFER',
        message: expect.any(String),
      })
    })

    it('rejects if order amount was tampered away from catalog amount', () => {
      const tamperedOrder: SubscriptionOrder = {
        ...validOrder,
        offerCode: 'STARTER_150K',
        amountKrw: 10000, // catalog is 150000
      }
      const result = verifyPaymentAgainstOrder(tamperedOrder, {
        orderId: 'ord_sample_123',
        amountKrw: 10000,
        currency: 'KRW',
        storeId: 'store-sample-123',
      })
      expect(result).toEqual({
        ok: false,
        reason: 'AMOUNT_MISMATCH',
        message: expect.any(String),
      })
    })
  })

  describe('transitionOrder (State Machine)', () => {
    it('executes valid happy-path lifecycle: created -> payment_pending -> paid -> cancelled', () => {
      const s1 = transitionOrder('created', 'START_PAYMENT')
      expect(s1).toBe('payment_pending')

      const s2 = transitionOrder(s1, 'PAYMENT_COMPLETED')
      expect(s2).toBe('paid')

      const s3 = transitionOrder(s2, 'CANCEL')
      expect(s3).toBe('cancelled')
    })

    it('allows direct status strings as events', () => {
      expect(transitionOrder('created', 'payment_pending')).toBe('payment_pending')
      expect(transitionOrder('payment_pending', 'paid')).toBe('paid')
      expect(transitionOrder('payment_pending', 'failed')).toBe('failed')
      expect(transitionOrder('created', 'cancelled')).toBe('cancelled')
      expect(transitionOrder('created', 'failed')).toBe('failed')
    })

    it('allows event objects with type', () => {
      expect(transitionOrder('created', { type: 'START_PAYMENT' })).toBe('payment_pending')
      expect(transitionOrder('payment_pending', { type: 'PAYMENT_COMPLETED' })).toBe('paid')
      expect(transitionOrder('paid', { type: 'CANCEL' })).toBe('cancelled')
    })

    it('rejects duplicate transitions (same status to same status)', () => {
      const allStatuses: SubscriptionOrderStatus[] = [
        'created',
        'payment_pending',
        'paid',
        'cancelled',
        'failed',
      ]
      for (const status of allStatuses) {
        expect(() => transitionOrder(status, status)).toThrow(
          InvalidOrderTransitionError
        )
      }
    })

    it('rejects backward (reverse) transitions', () => {
      expect(() => transitionOrder('paid', 'payment_pending')).toThrow(
        InvalidOrderTransitionError
      )
      expect(() => transitionOrder('paid', 'created')).toThrow(
        InvalidOrderTransitionError
      )
      expect(() => transitionOrder('payment_pending', 'created')).toThrow(
        InvalidOrderTransitionError
      )
      expect(() => transitionOrder('cancelled', 'paid')).toThrow(
        InvalidOrderTransitionError
      )
      expect(() => transitionOrder('failed', 'created')).toThrow(
        InvalidOrderTransitionError
      )
      expect(() => transitionOrder('cancelled', 'created')).toThrow(
        InvalidOrderTransitionError
      )
    })

    it('correctly reports canTransitionOrder boolean', () => {
      expect(canTransitionOrder('created', 'payment_pending')).toBe(true)
      expect(canTransitionOrder('payment_pending', 'paid')).toBe(true)
      expect(canTransitionOrder('paid', 'cancelled')).toBe(true)

      expect(canTransitionOrder('created', 'created')).toBe(false)
      expect(canTransitionOrder('paid', 'payment_pending')).toBe(false)
      expect(canTransitionOrder('cancelled', 'paid')).toBe(false)
      expect(canTransitionOrder('failed', 'paid')).toBe(false)
    })

    it('identifies terminal states', () => {
      expect(isTerminalOrderStatus('cancelled')).toBe(true)
      expect(isTerminalOrderStatus('failed')).toBe(true)
      expect(isTerminalOrderStatus('created')).toBe(false)
      expect(isTerminalOrderStatus('payment_pending')).toBe(false)
      expect(isTerminalOrderStatus('paid')).toBe(false)
    })
  })
})
