import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST, clearSeenWebhookIds, seenWebhookIds } from './route'
import type { Webhook } from '@portone/server-sdk/webhook'

describe('/api/webhooks/portone route', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    clearSeenWebhookIds()
    vi.restoreAllMocks()
  })

  function createMockRequest({
    method = 'POST',
    body = JSON.stringify({
      type: 'Transaction.Paid',
      timestamp: '2026-11-06T04:00:00Z',
      data: {
        paymentId: 'order_123',
        storeId: 'store_test',
        transactionId: 'tx_999',
      },
    }),
    headers = {
      'content-type': 'application/json',
      'webhook-id': 'evt_msg_123',
      'webhook-timestamp': '1762401600',
      'webhook-signature': 'v1,dummy_sig',
    },
  }: {
    method?: string
    body?: string
    headers?: Record<string, string>
  } = {}): NextRequest {
    const url = 'http://localhost:3000/api/webhooks/portone'
    return new NextRequest(url, {
      method,
      body: method === 'GET' ? undefined : body,
      headers,
    })
  }

  describe('GET handler', () => {
    it('GET 요청 시 405 Method Not Allowed를 반환한다', async () => {
      const res = await GET()
      expect(res.status).toBe(405)
      const data = await res.json()
      expect(data).toEqual({ ok: false, error: 'METHOD_NOT_ALLOWED' })
    })
  })

  describe('POST handler', () => {
    it('PORTONE_WEBHOOK_SECRET 미설정 시 503 반환', async () => {
      delete process.env.PORTONE_WEBHOOK_SECRET
      const req = createMockRequest()

      const res = await POST(req)
      expect(res.status).toBe(503)
      const data = await res.json()
      expect(data).toEqual({ ok: false, error: 'WEBHOOK_SECRET_NOT_CONFIGURED' })
    })

    it('서명 검증 실패 시 400 Bad Request 및 INVALID_WEBHOOK_SIGNATURE 반환 (비밀키 미노출)', async () => {
      process.env.PORTONE_WEBHOOK_SECRET = 'whsec_very_secret_key'
      const req = createMockRequest()

      const mockVerify = vi.fn().mockRejectedValue(new Error('Internal raw crypto failure'))

      const res = await POST(req, { verify: mockVerify })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data).toEqual({ ok: false, error: 'INVALID_WEBHOOK_SIGNATURE' })
      expect(JSON.stringify(data)).not.toContain('whsec_very_secret_key')
      expect(JSON.stringify(data)).not.toContain('crypto')
    })

    it('webhook-id 헤더 누락 시 400 Bad Request 반환', async () => {
      process.env.PORTONE_WEBHOOK_SECRET = 'whsec_test_secret'
      const req = createMockRequest({
        headers: {
          'content-type': 'application/json',
          'webhook-timestamp': '1762401600',
          'webhook-signature': 'v1,dummy_sig',
        },
      })

      const res = await POST(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data).toEqual({ ok: false, error: 'INVALID_WEBHOOK_SIGNATURE' })
    })

    it('정상 서명 검증 후 주문 전이 이벤트로 매핑하고 200 OK 반환', async () => {
      process.env.PORTONE_WEBHOOK_SECRET = 'whsec_test_secret'
      const req = createMockRequest({
        headers: {
          'webhook-id': 'evt_paid_1',
          'webhook-timestamp': '1762401600',
          'webhook-signature': 'v1,dummy_sig',
        },
      })

      const mockVerify = vi.fn().mockResolvedValue({
        type: 'Transaction.Paid',
        timestamp: '2026-11-06T04:00:00Z',
        data: {
          paymentId: 'order_123',
          storeId: 'store_test',
          transactionId: 'tx_999',
        },
      } as Webhook)

      const res = await POST(req, { verify: mockVerify })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({
        ok: true,
        status: 'processed',
        eventId: 'evt_paid_1',
        orderEvent: {
          type: 'paid',
          paymentId: 'order_123',
          storeId: 'store_test',
          transactionId: 'tx_999',
          cancellationId: undefined,
          timestamp: '2026-11-06T04:00:00Z',
          rawType: 'Transaction.Paid',
        },
      })
      expect(seenWebhookIds.has('evt_paid_1')).toBe(true)
    })

    it('동일한 eventId로 두 번째 요청 시 ignored_duplicate 200 OK 반환', async () => {
      process.env.PORTONE_WEBHOOK_SECRET = 'whsec_test_secret'
      const req1 = createMockRequest({
        headers: {
          'webhook-id': 'evt_dup_1',
          'webhook-timestamp': '1762401600',
          'webhook-signature': 'v1,dummy_sig',
        },
      })

      const mockVerify = vi.fn().mockResolvedValue({
        type: 'Transaction.Paid',
        timestamp: '2026-11-06T04:00:00Z',
        data: { paymentId: 'order_123', storeId: 'store_test', transactionId: 'tx_999' },
      } as Webhook)

      const res1 = await POST(req1, { verify: mockVerify })
      expect(res1.status).toBe(200)
      const data1 = await res1.json()
      expect(data1.status).toBe('processed')

      // 두 번째 요청 (중복)
      const req2 = createMockRequest({
        headers: {
          'webhook-id': 'evt_dup_1',
          'webhook-timestamp': '1762401600',
          'webhook-signature': 'v1,dummy_sig',
        },
      })
      const res2 = await POST(req2, { verify: mockVerify })
      expect(res2.status).toBe(200)
      const data2 = await res2.json()
      expect(data2).toEqual({
        ok: true,
        status: 'ignored_duplicate',
        eventId: 'evt_dup_1',
      })
    })

    it('옵션으로 seenIds 주입 시 주입된 캐시를 기반으로 중복 판정', async () => {
      process.env.PORTONE_WEBHOOK_SECRET = 'whsec_test_secret'
      const customSeen = new Set(['evt_already_seen'])

      const req = createMockRequest({
        headers: {
          'webhook-id': 'evt_already_seen',
          'webhook-timestamp': '1762401600',
          'webhook-signature': 'v1,dummy_sig',
        },
      })

      const mockVerify = vi.fn().mockResolvedValue({
        type: 'Transaction.Paid',
        timestamp: '2026-11-06T04:00:00Z',
        data: { paymentId: 'o1', storeId: 's1', transactionId: 't1' },
      } as Webhook)

      const res = await POST(req, { seenIds: customSeen, verify: mockVerify })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({
        ok: true,
        status: 'ignored_duplicate',
        eventId: 'evt_already_seen',
      })
    })

    it('지원하지 않는 웹훅 이벤트 타입인 경우 ignored_unsupported 200 OK 반환', async () => {
      process.env.PORTONE_WEBHOOK_SECRET = 'whsec_test_secret'
      const req = createMockRequest({
        headers: {
          'webhook-id': 'evt_unsupported_1',
          'webhook-timestamp': '1762401600',
          'webhook-signature': 'v1,dummy_sig',
        },
      })

      const mockVerify = vi.fn().mockResolvedValue({
        type: 'BillingKey.Issued',
        timestamp: '2026-11-06T04:00:00Z',
        data: {},
      } as unknown as Webhook)

      const res = await POST(req, { verify: mockVerify })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({
        ok: true,
        status: 'ignored_unsupported',
        eventId: 'evt_unsupported_1',
      })
    })

    it('dbClient 주입 시 이미 DB에 기록된 이벤트이면 ignored_duplicate를 반환한다', async () => {
      process.env.PORTONE_WEBHOOK_SECRET = 'whsec_test_secret'
      const req = createMockRequest({
        headers: {
          'webhook-id': 'evt_db_duplicate',
          'webhook-timestamp': '1762401600',
          'webhook-signature': 'v1,dummy_sig',
        },
      })

      const mockVerify = vi.fn().mockResolvedValue({
        type: 'Transaction.Paid',
        timestamp: '2026-11-06T04:00:00Z',
        data: { paymentId: 'o1', storeId: 's1', transactionId: 't1' },
      } as Webhook)

      const mockDbClient: any = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_webhook_events') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'evt_db_duplicate_row_id' },
                error: null,
              }),
            }
          }
          return {}
        }),
      }

      const res = await POST(req, { verify: mockVerify, dbClient: mockDbClient })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({
        ok: true,
        status: 'ignored_duplicate',
        eventId: 'evt_db_duplicate',
      })
    })

    it('dbClient 주입 및 유효한 UUID paymentId인 경우 주문 상태를 paid로 전이한다', async () => {
      process.env.PORTONE_WEBHOOK_SECRET = 'whsec_test_secret'
      const orderUuid = 'a0000000-0000-4000-8000-000000000001'
      const req = createMockRequest({
        body: JSON.stringify({
          type: 'Transaction.Paid',
          timestamp: '2026-11-06T04:00:00Z',
          data: {
            paymentId: orderUuid,
            storeId: 'store_test',
            transactionId: 'tx_999',
          },
        }),
        headers: {
          'webhook-id': 'evt_paid_success',
          'webhook-timestamp': '1762401600',
          'webhook-signature': 'v1,dummy_sig',
        },
      })

      const mockVerify = vi.fn().mockResolvedValue({
        type: 'Transaction.Paid',
        timestamp: '2026-11-06T04:00:00Z',
        data: { paymentId: orderUuid, storeId: 'store_test', transactionId: 'tx_999' },
      } as Webhook)

      let updatedStatus = ''
      const mockDbClient: any = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_webhook_events') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: 'evt_row_1' },
                error: null,
              }),
            }
          }
          if (table === 'subscription_orders') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { status: 'payment_pending' },
                error: null,
              }),
              update: vi.fn((fields: any) => {
                updatedStatus = fields.status
                return {
                  eq: vi.fn().mockResolvedValue({ data: null, error: null }),
                }
              }),
            }
          }
          return {}
        }),
      }

      const res = await POST(req, { verify: mockVerify, dbClient: mockDbClient })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.status).toBe('processed')
      expect(data.transition).toEqual({
        ok: true,
        previousStatus: 'payment_pending',
        newStatus: 'paid',
      })
      expect(updatedStatus).toBe('paid')
    })
  })
})
