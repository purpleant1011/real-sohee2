import { describe, expect, it, vi } from 'vitest'
import {
  recordWebhookEvent,
  applyOrderTransitionFromWebhook,
  type WebhookRepositoryDatabaseClient,
} from '../subscription-webhook-repository'

describe('subscription-webhook-repository', () => {
  describe('recordWebhookEvent', () => {
    it('신규 이벤트 수신 시 정상 insert하고 { duplicate: false, eventId }를 반환한다', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: { id: 'evt-123' },
        error: null,
      })
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_webhook_events') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
              insert: mockInsert,
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as WebhookRepositoryDatabaseClient

      const receivedAt = new Date('2026-11-06T12:00:00Z')
      const result = await recordWebhookEvent(mockClient, {
        providerEventId: 'p-event-001',
        orderId: 'order-123',
        receivedAt,
      })

      expect(result).toEqual({ duplicate: false, eventId: 'evt-123' })
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_event_id: 'p-event-001',
          order_id: 'order-123',
          received_at: receivedAt.toISOString(),
        })
      )
    })

    it('사전 조회 시 이미 존재하는 providerEventId인 경우 중복으로 판정하여 { duplicate: true, eventId }를 반환한다', async () => {
      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_webhook_events') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'existing-evt-999' },
                    error: null,
                  }),
                }),
              }),
              insert: vi.fn(),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as WebhookRepositoryDatabaseClient

      const result = await recordWebhookEvent(mockClient, {
        providerEventId: 'dup-event-001',
      })

      expect(result).toEqual({ duplicate: true, eventId: 'existing-evt-999' })
    })

    it('insert 중 unique constraint(23505) 충돌 발생 시 중복으로 판정하고 기존 eventId를 반환한다', async () => {
      const mockSingleFallback = vi.fn().mockResolvedValue({
        data: { id: 'evt-conflict-id' },
        error: null,
      })
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint' },
          }),
        }),
      })

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_webhook_events') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  single: mockSingleFallback,
                }),
              }),
              insert: mockInsert,
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as WebhookRepositoryDatabaseClient

      const result = await recordWebhookEvent(mockClient, {
        providerEventId: 'p-event-race',
      })

      expect(result).toEqual({ duplicate: true, eventId: 'evt-conflict-id' })
    })
  })

  describe('applyOrderTransitionFromWebhook', () => {
    it('주문이 존재하지 않는 경우 { ok: false, reason: "ORDER_NOT_FOUND" }를 반환한다', async () => {
      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_orders') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as WebhookRepositoryDatabaseClient

      const result = await applyOrderTransitionFromWebhook(mockClient, {
        orderId: 'non-existent-order',
        event: 'paid',
      })

      expect(result).toEqual({ ok: false, reason: 'ORDER_NOT_FOUND' })
    })

    it('payment_pending 상태에서 paid 이벤트 수신 시 paid로 전이 및 업데이트를 성공한다', async () => {
      const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq })

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_orders') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { status: 'payment_pending' },
                    error: null,
                  }),
                }),
              }),
              update: mockUpdate,
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as WebhookRepositoryDatabaseClient

      const result = await applyOrderTransitionFromWebhook(mockClient, {
        orderId: 'order-100',
        event: 'paid',
        providerEventId: 'evt-1',
      })

      expect(result).toEqual({
        ok: true,
        previousStatus: 'payment_pending',
        newStatus: 'paid',
      })
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }))
      expect(mockUpdateEq).toHaveBeenCalledWith('id', 'order-100')
    })

    it('payment_pending 상태에서 failed 이벤트 수신 시 failed로 전이 및 업데이트를 성공한다', async () => {
      const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq })

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_orders') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { status: 'payment_pending' },
                    error: null,
                  }),
                }),
              }),
              update: mockUpdate,
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as WebhookRepositoryDatabaseClient

      const result = await applyOrderTransitionFromWebhook(mockClient, {
        orderId: 'order-101',
        event: 'failed',
      })

      expect(result).toEqual({
        ok: true,
        previousStatus: 'payment_pending',
        newStatus: 'failed',
      })
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
    })

    it('paid 상태에서 cancelled 이벤트 수신 시 cancelled로 전이 및 업데이트를 성공한다', async () => {
      const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq })

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_orders') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { status: 'paid' },
                    error: null,
                  }),
                }),
              }),
              update: mockUpdate,
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as WebhookRepositoryDatabaseClient

      const result = await applyOrderTransitionFromWebhook(mockClient, {
        orderId: 'order-102',
        event: 'cancelled',
      })

      expect(result).toEqual({
        ok: true,
        previousStatus: 'paid',
        newStatus: 'cancelled',
      })
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
    })

    it('전이가 허용되지 않는 경우(예: created -> paid, 또는 이미 paid인데 paid) INVALID_TRANSITION을 반환하고 update를 호출하지 않는다', async () => {
      const mockUpdate = vi.fn()

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_orders') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { status: 'created' },
                    error: null,
                  }),
                }),
              }),
              update: mockUpdate,
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as WebhookRepositoryDatabaseClient

      const result = await applyOrderTransitionFromWebhook(mockClient, {
        orderId: 'order-103',
        event: 'paid',
      })

      expect(result).toEqual({
        ok: false,
        reason: 'INVALID_TRANSITION',
        currentStatus: 'created',
      })
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('터미널 상태(cancelled)에서 추가 이벤트 수신 시 INVALID_TRANSITION을 반환한다', async () => {
      const mockUpdate = vi.fn()

      const mockClient = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_orders') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { status: 'cancelled' },
                    error: null,
                  }),
                }),
              }),
              update: mockUpdate,
            }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
      } as unknown as WebhookRepositoryDatabaseClient

      const result = await applyOrderTransitionFromWebhook(mockClient, {
        orderId: 'order-104',
        event: 'failed',
      })

      expect(result).toEqual({
        ok: false,
        reason: 'INVALID_TRANSITION',
        currentStatus: 'cancelled',
      })
      expect(mockUpdate).not.toHaveBeenCalled()
    })
  })
})
