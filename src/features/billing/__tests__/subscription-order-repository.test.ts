import { describe, expect, it, vi } from 'vitest'
import {
  findOrderByWorkspaceAndIdempotencyKey,
  createSubscriptionOrderWithConsents,
  listSubscriptionOrdersByWorkspace,
  type SubscriptionOrderDraft,
  type ConsentRecord,
} from '../subscription-order-repository'

describe('subscription-order-repository', () => {
  const dummyWorkspaceId = '11111111-1111-4111-8111-111111111111'
  const dummyUserId = '22222222-2222-4222-8222-222222222222'
  const dummyOrderId = '33333333-3333-4333-8333-333333333333'
  const dummyIdempotencyKey = '44444444-4444-4444-8444-444444444444'

  const sampleOrderRow = {
    id: dummyOrderId,
    workspace_id: dummyWorkspaceId,
    offer_code: 'STARTER_150K',
    amount_krw: 150000,
    currency: 'KRW',
    status: 'created',
    idempotency_key: dummyIdempotencyKey,
    created_by: dummyUserId,
    created_at: '2026-11-09T00:00:00.000Z',
  }

  const sampleConsents: readonly ConsentRecord[] = [
    {
      kind: 'terms',
      policyVersion: 'v1.0',
      acceptedAt: '2026-11-09T00:00:00.000Z',
      locale: 'ko',
    },
    {
      kind: 'privacy',
      policyVersion: 'v1.0',
      acceptedAt: '2026-11-09T00:00:00.000Z',
      locale: 'ko',
    },
    {
      kind: 'refund_auto_renewal',
      policyVersion: 'v1.0',
      acceptedAt: '2026-11-09T00:00:00.000Z',
      locale: 'ko',
    },
  ]

  const sampleOrderDraft: SubscriptionOrderDraft = {
    orderId: dummyOrderId,
    workspaceId: dummyWorkspaceId,
    offerCode: 'STARTER_150K',
    amountKrw: 150000,
    currency: 'KRW',
    status: 'created',
    idempotencyKey: dummyIdempotencyKey,
    actorUserId: dummyUserId,
  }

  describe('findOrderByWorkspaceAndIdempotencyKey', () => {
    it('주문이 존재할 경우 SubscriptionOrder 객체로 매핑하여 반환한다', async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: sampleOrderRow, error: null })
      const eqSecondMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
      const eqFirstMock = vi.fn().mockReturnValue({ eq: eqSecondMock })
      const selectMock = vi.fn().mockReturnValue({ eq: eqFirstMock })
      const fromMock = vi.fn().mockReturnValue({ select: selectMock })

      const mockClient = { from: fromMock }

      const result = await findOrderByWorkspaceAndIdempotencyKey(
        mockClient as any,
        dummyWorkspaceId,
        dummyIdempotencyKey
      )

      expect(fromMock).toHaveBeenCalledWith('subscription_orders')
      expect(selectMock).toHaveBeenCalledWith('*')
      expect(eqFirstMock).toHaveBeenCalledWith('workspace_id', dummyWorkspaceId)
      expect(eqSecondMock).toHaveBeenCalledWith('idempotency_key', dummyIdempotencyKey)
      expect(result).toEqual({
        orderId: dummyOrderId,
        offerCode: 'STARTER_150K',
        workspaceId: dummyWorkspaceId,
        actorUserId: dummyUserId,
        idempotencyKey: dummyIdempotencyKey,
        amountKrw: 150000,
        currency: 'KRW',
        status: 'created',
        createdAt: '2026-11-09T00:00:00.000Z',
      })
    })

    it('주문이 존재하지 않을 경우 null을 반환한다', async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null })
      const eqSecondMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
      const eqFirstMock = vi.fn().mockReturnValue({ eq: eqSecondMock })
      const selectMock = vi.fn().mockReturnValue({ eq: eqFirstMock })
      const fromMock = vi.fn().mockReturnValue({ select: selectMock })

      const mockClient = { from: fromMock }

      const result = await findOrderByWorkspaceAndIdempotencyKey(
        mockClient as any,
        dummyWorkspaceId,
        dummyIdempotencyKey
      )

      expect(result).toBeNull()
    })

    it('DB 조회 에러 발생 시 Error를 던진다', async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database connection failed' },
      })
      const eqSecondMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
      const eqFirstMock = vi.fn().mockReturnValue({ eq: eqSecondMock })
      const selectMock = vi.fn().mockReturnValue({ eq: eqFirstMock })
      const fromMock = vi.fn().mockReturnValue({ select: selectMock })

      const mockClient = { from: fromMock }

      await expect(
        findOrderByWorkspaceAndIdempotencyKey(mockClient as any, dummyWorkspaceId, dummyIdempotencyKey)
      ).rejects.toThrow('Database connection failed')
    })
  })

  describe('createSubscriptionOrderWithConsents', () => {
    it('기존 주문이 이미 존재하면 insert 없이 기존 주문과 created: false를 반환한다 (멱등성)', async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: sampleOrderRow, error: null })
      const eqSecondMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
      const eqFirstMock = vi.fn().mockReturnValue({ eq: eqSecondMock })
      const selectMock = vi.fn().mockReturnValue({ eq: eqFirstMock })
      const insertMock = vi.fn()
      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'subscription_orders') {
          return { select: selectMock, insert: insertMock }
        }
        return { insert: insertMock }
      })

      const mockClient = { from: fromMock }

      const result = await createSubscriptionOrderWithConsents(mockClient as any, {
        order: sampleOrderDraft,
        consents: sampleConsents,
        createdBy: dummyUserId,
      })

      expect(insertMock).not.toHaveBeenCalled()
      expect(result).toEqual({
        order: {
          orderId: dummyOrderId,
          offerCode: 'STARTER_150K',
          workspaceId: dummyWorkspaceId,
          actorUserId: dummyUserId,
          idempotencyKey: dummyIdempotencyKey,
          amountKrw: 150000,
          currency: 'KRW',
          status: 'created',
          createdAt: '2026-11-09T00:00:00.000Z',
        },
        created: false,
      })
    })

    it('신규 주문인 경우 subscription_orders 및 subscription_consents에 정상 저장하고 created: true를 반환한다', async () => {
      // 1. findOrderByWorkspaceAndIdempotencyKey -> null
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null })
      const eqSecondMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
      const eqFirstMock = vi.fn().mockReturnValue({ eq: eqSecondMock })
      const selectMock = vi.fn().mockReturnValue({ eq: eqFirstMock })

      // 2. order insert -> single
      const orderSingleMock = vi.fn().mockResolvedValue({ data: sampleOrderRow, error: null })
      const orderSelectMock = vi.fn().mockReturnValue({ single: orderSingleMock })
      const orderInsertMock = vi.fn().mockReturnValue({ select: orderSelectMock })

      // 3. consents insert
      const consentsInsertMock = vi.fn().mockResolvedValue({ error: null })

      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'subscription_orders') {
          return {
            select: selectMock,
            insert: orderInsertMock,
          }
        }
        if (table === 'subscription_consents') {
          return {
            insert: consentsInsertMock,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      const mockClient = { from: fromMock }

      const result = await createSubscriptionOrderWithConsents(mockClient as any, {
        order: sampleOrderDraft,
        consents: sampleConsents,
        createdBy: dummyUserId,
      })

      expect(result.created).toBe(true)
      expect(result.order.orderId).toBe(dummyOrderId)

      // order insert payload 검증 (민감정보 미포함 확인)
      expect(orderInsertMock).toHaveBeenCalledTimes(1)
      const insertedOrder = orderInsertMock.mock.calls[0][0]
      expect(insertedOrder).toEqual({
        id: dummyOrderId,
        workspace_id: dummyWorkspaceId,
        offer_code: 'STARTER_150K',
        amount_krw: 150000,
        currency: 'KRW',
        status: 'created',
        idempotency_key: dummyIdempotencyKey,
        created_by: dummyUserId,
      })
      expect(insertedOrder.cardNumber).toBeUndefined()
      expect(insertedOrder.cvc).toBeUndefined()
      expect(insertedOrder.secretKey).toBeUndefined()

      // consents insert payload 검증
      expect(consentsInsertMock).toHaveBeenCalledTimes(1)
      const insertedConsents = consentsInsertMock.mock.calls[0][0]
      expect(insertedConsents).toHaveLength(3)
      expect(insertedConsents[0]).toMatchObject({
        order_id: dummyOrderId,
        kind: 'terms',
        policy_version: 'v1.0',
        accepted_at: '2026-11-09T00:00:00.000Z',
      })
    })

    it('주문 insert 중 unique 충돌이 발생하면 기존 주문을 조회하여 created: false로 반환한다', async () => {
      // 1. 처음 조회 시에는 동시성 이슈로 null 반환
      const maybeSingleMock = vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: sampleOrderRow, error: null }) // 충돌 후 재조회

      const eqSecondMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
      const eqFirstMock = vi.fn().mockReturnValue({ eq: eqSecondMock })
      const selectMock = vi.fn().mockReturnValue({ eq: eqFirstMock })

      // 2. insert 시 unique 충돌 발생 (code: '23505')
      const orderSingleMock = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      })
      const orderSelectMock = vi.fn().mockReturnValue({ single: orderSingleMock })
      const orderInsertMock = vi.fn().mockReturnValue({ select: orderSelectMock })

      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'subscription_orders') {
          return {
            select: selectMock,
            insert: orderInsertMock,
          }
        }
        return { insert: vi.fn() }
      })

      const mockClient = { from: fromMock }

      const result = await createSubscriptionOrderWithConsents(mockClient as any, {
        order: sampleOrderDraft,
        consents: sampleConsents,
      })

      expect(result).toEqual({
        order: {
          orderId: dummyOrderId,
          offerCode: 'STARTER_150K',
          workspaceId: dummyWorkspaceId,
          actorUserId: dummyUserId,
          idempotencyKey: dummyIdempotencyKey,
          amountKrw: 150000,
          currency: 'KRW',
          status: 'created',
          createdAt: '2026-11-09T00:00:00.000Z',
        },
        created: false,
      })
    })

    it('동의 bulk insert 실패 시 에러를 던진다', async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null })
      const eqSecondMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
      const eqFirstMock = vi.fn().mockReturnValue({ eq: eqSecondMock })
      const selectMock = vi.fn().mockReturnValue({ eq: eqFirstMock })

      const orderSingleMock = vi.fn().mockResolvedValue({ data: sampleOrderRow, error: null })
      const orderSelectMock = vi.fn().mockReturnValue({ single: orderSingleMock })
      const orderInsertMock = vi.fn().mockReturnValue({ select: orderSelectMock })

      const consentsInsertMock = vi
        .fn()
        .mockResolvedValue({ error: { message: 'Failed to insert consents' } })

      const fromMock = vi.fn().mockImplementation((table: string) => {
        if (table === 'subscription_orders') {
          return {
            select: selectMock,
            insert: orderInsertMock,
          }
        }
        if (table === 'subscription_consents') {
          return {
            insert: consentsInsertMock,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      })

      const mockClient = { from: fromMock }

      await expect(
        createSubscriptionOrderWithConsents(mockClient as any, {
          order: sampleOrderDraft,
          consents: sampleConsents,
        })
      ).rejects.toThrow('Failed to insert consents')
    })
  })

  describe('listSubscriptionOrdersByWorkspace', () => {
    it('workspaceId로 조회 시 created_at desc 정렬과 limit 옵션을 적용하여 주문 목록을 반환한다', async () => {
      const rows = [
        sampleOrderRow,
        {
          ...sampleOrderRow,
          id: '55555555-5555-4555-8555-555555555555',
          idempotency_key: '66666666-6666-4666-8666-666666666666',
          created_at: '2026-11-08T00:00:00.000Z',
        },
      ]

      const limitMock = vi.fn().mockResolvedValue({ data: rows, error: null })
      const orderMock = vi.fn().mockReturnValue({ limit: limitMock })
      const eqMock = vi.fn().mockReturnValue({ order: orderMock })
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
      const fromMock = vi.fn().mockReturnValue({ select: selectMock })

      const mockClient = { from: fromMock }

      const result = await listSubscriptionOrdersByWorkspace(
        mockClient as any,
        dummyWorkspaceId,
        { limit: 10 }
      )

      expect(fromMock).toHaveBeenCalledWith('subscription_orders')
      expect(selectMock).toHaveBeenCalledWith('*')
      expect(eqMock).toHaveBeenCalledWith('workspace_id', dummyWorkspaceId)
      expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false })
      expect(limitMock).toHaveBeenCalledWith(10)
      expect(result).toHaveLength(2)
      expect(result[0].orderId).toBe(dummyOrderId)
      expect(result[1].orderId).toBe('55555555-5555-4555-8555-555555555555')
    })

    it('limit 옵션이 없을 경우 기본값 50으로 조회한다', async () => {
      const limitMock = vi.fn().mockResolvedValue({ data: [], error: null })
      const orderMock = vi.fn().mockReturnValue({ limit: limitMock })
      const eqMock = vi.fn().mockReturnValue({ order: orderMock })
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
      const fromMock = vi.fn().mockReturnValue({ select: selectMock })

      const mockClient = { from: fromMock }

      const result = await listSubscriptionOrdersByWorkspace(
        mockClient as any,
        dummyWorkspaceId
      )

      expect(limitMock).toHaveBeenCalledWith(50)
      expect(result).toEqual([])
    })

    it('DB 조회 에러 발생 시 Error를 던진다', async () => {
      const limitMock = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database query error' },
      })
      const orderMock = vi.fn().mockReturnValue({ limit: limitMock })
      const eqMock = vi.fn().mockReturnValue({ order: orderMock })
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
      const fromMock = vi.fn().mockReturnValue({ select: selectMock })

      const mockClient = { from: fromMock }

      await expect(
        listSubscriptionOrdersByWorkspace(mockClient as any, dummyWorkspaceId)
      ).rejects.toThrow('Database query error')
    })

    it('DB에서 data가 null로 반환될 때 빈 배열로 둔갑하지 않고 Error를 던진다', async () => {
      const limitMock = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      })
      const orderMock = vi.fn().mockReturnValue({ limit: limitMock })
      const eqMock = vi.fn().mockReturnValue({ order: orderMock })
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
      const fromMock = vi.fn().mockReturnValue({ select: selectMock })

      const mockClient = { from: fromMock }

      await expect(
        listSubscriptionOrdersByWorkspace(mockClient as any, dummyWorkspaceId)
      ).rejects.toThrow('SUBSCRIPTION_ORDERS_QUERY_FAILED')
    })
  })
})
