import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'
import * as workspaceGuard from '@/lib/auth/workspace-guard'
import { subscriptionOfferPolicy } from '@/features/billing/subscription-offers'

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: vi.fn(),
}))

const WORKSPACE_ID = '90000000-0000-4000-8000-000000000001'
const VALID_UUID = 'a0000000-0000-4000-8000-000000000001'

function createPostRequest(body: unknown, workspaceId: string = WORKSPACE_ID): NextRequest {
  return new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/billing/subscription-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function createGetRequest(workspaceId: string = WORKSPACE_ID): NextRequest {
  return new NextRequest(`http://localhost:3000/api/workspaces/${workspaceId}/billing/subscription-orders`, {
    method: 'GET',
  })
}

function createContext(workspaceId: string = WORKSPACE_ID) {
  return {
    params: Promise.resolve({ workspaceId }),
  }
}

describe('Subscription Orders Route (/api/workspaces/[workspaceId]/billing/subscription-orders)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/workspaces/[workspaceId]/billing/subscription-orders', () => {
    it('1. 인증 실패 시 401을 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: 'AUTH_REQUIRED',
        message: '인증이 필요합니다.',
      })

      const res = await GET(createGetRequest(), createContext())
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('AUTH_REQUIRED')
    })

    it('2. 멤버십 권한 없음 시 403을 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: 'WORKSPACE_FORBIDDEN',
        message: '해당 작업공간에 대한 접근 권한이 없습니다.',
      })

      const res = await GET(createGetRequest(), createContext())
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('WORKSPACE_FORBIDDEN')
    })

    it('3. 일반 멤버(member) 조회 시 200 OK와 안전한 읽기 전용 빈 배열을 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-member-1',
        role: 'member',
        workspaceId: WORKSPACE_ID,
      })

      const res = await GET(createGetRequest(), createContext())
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({ ok: true, orders: [] })
    })

    it('4. 관리자(owner) 조회 시 200 OK와 안전한 읽기 전용 빈 배열을 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner-1',
        role: 'owner',
        workspaceId: WORKSPACE_ID,
      })

      const res = await GET(createGetRequest(), createContext())
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({ ok: true, orders: [] })
    })
  })

  describe('POST /api/workspaces/[workspaceId]/billing/subscription-orders', () => {
    it('1. 인증 실패 시 401을 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: 'AUTH_REQUIRED',
        message: '인증이 필요합니다.',
      })

      const req = createPostRequest({
        offerCode: 'STARTER_150K',
        idempotencyKey: VALID_UUID,
        accepted: { terms: true, privacy: true, refund_auto_renewal: true },
      })
      const res = await POST(req, createContext())
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('AUTH_REQUIRED')
    })

    it('2. 타 작업공간 차단 시 403을 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: 'WORKSPACE_FORBIDDEN',
        message: '접근 권한이 없습니다.',
      })

      const req = createPostRequest({
        offerCode: 'STARTER_150K',
        idempotencyKey: VALID_UUID,
        accepted: { terms: true, privacy: true, refund_auto_renewal: true },
      })
      const res = await POST(req, createContext())
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe('WORKSPACE_FORBIDDEN')
    })

    it('3. owner/manager가 아닌 일반 역할(member, viewer)은 403 FORBIDDEN_ROLE을 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-viewer',
        role: 'viewer',
        workspaceId: WORKSPACE_ID,
      })

      const req = createPostRequest({
        offerCode: 'STARTER_150K',
        idempotencyKey: VALID_UUID,
        accepted: { terms: true, privacy: true, refund_auto_renewal: true },
      })
      const res = await POST(req, createContext())
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data).toEqual({
        error: 'FORBIDDEN_ROLE',
        message: '구독 주문을 생성할 권한이 없습니다.',
      })
    })

    it('4. JSON 파싱 실패 또는 빈 본문 요청 시 400 Bad Request를 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: WORKSPACE_ID,
      })

      const req = createPostRequest('invalid-json')
      const res = await POST(req, createContext())
      expect(res.status).toBe(400)
    })

    it('5. 유효하지 않은 offerCode인 경우 400 Bad Request를 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: WORKSPACE_ID,
      })

      const req = createPostRequest({
        offerCode: 'INVALID_OFFER',
        idempotencyKey: VALID_UUID,
        accepted: { terms: true, privacy: true, refund_auto_renewal: true },
      })
      const res = await POST(req, createContext())
      expect(res.status).toBe(400)
    })

    it('6. 유효하지 않은 idempotencyKey(UUID 아님)인 경우 400 Bad Request를 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: WORKSPACE_ID,
      })

      const req = createPostRequest({
        offerCode: 'STARTER_150K',
        idempotencyKey: 'not-a-uuid',
        accepted: { terms: true, privacy: true, refund_auto_renewal: true },
      })
      const res = await POST(req, createContext())
      expect(res.status).toBe(400)
    })

    it('7. 필수 동의 누락 시 400 Bad Request를 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: WORKSPACE_ID,
      })

      const req = createPostRequest({
        offerCode: 'STARTER_150K',
        idempotencyKey: VALID_UUID,
        accepted: { terms: true, privacy: true }, // refund_auto_renewal 누락
      })
      const res = await POST(req, createContext())
      expect(res.status).toBe(400)
    })

    it('8. 필수 동의가 false인 경우 400 Bad Request를 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: WORKSPACE_ID,
      })

      const req = createPostRequest({
        offerCode: 'STARTER_150K',
        idempotencyKey: VALID_UUID,
        accepted: { terms: true, privacy: false, refund_auto_renewal: true },
      })
      const res = await POST(req, createContext())
      expect(res.status).toBe(400)
    })

    it('9. 본문 또는 accepted 객체에 미정의 추가 필드가 포함되면 strict 검증으로 400을 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner',
        role: 'owner',
        workspaceId: WORKSPACE_ID,
      })

      const req = createPostRequest({
        offerCode: 'STARTER_150K',
        idempotencyKey: VALID_UUID,
        accepted: { terms: true, privacy: true, refund_auto_renewal: true, unexpectedKey: true },
      })
      const res = await POST(req, createContext())
      expect(res.status).toBe(400)
    })

    it('10. owner가 필수 동의만으로 STARTER_150K 주문 생성 시 201 Created를 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner-1',
        role: 'owner',
        workspaceId: WORKSPACE_ID,
      })

      const req = createPostRequest({
        offerCode: 'STARTER_150K',
        idempotencyKey: VALID_UUID,
        accepted: { terms: true, privacy: true, refund_auto_renewal: true },
      })
      const res = await POST(req, createContext())
      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.order).toBeDefined()
      expect(body.order.offerCode).toBe('STARTER_150K')
      expect(body.order.workspaceId).toBe(WORKSPACE_ID)
      expect(body.order.actorUserId).toBe('user-owner-1')
      expect(body.order.idempotencyKey).toBe(VALID_UUID)
      expect(body.order.amountKrw).toBe(150000)
      expect(body.order.currency).toBe('KRW')
      expect(body.order.status).toBe('created')

      expect(body.consents).toHaveLength(3)
      const kinds = body.consents.map((c: { kind: string }) => c.kind)
      expect(kinds).toEqual(['terms', 'privacy', 'refund_auto_renewal'])
      expect(body.consents[0].policyVersion).toBe(subscriptionOfferPolicy.version)
      expect(body.consents[0].locale).toBe('ko')
    })

    it('11. manager가 선택 마케팅 동의 포함하여 GROWTH_300K 주문 생성 시 201 Created를 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-manager-1',
        role: 'manager',
        workspaceId: WORKSPACE_ID,
      })

      const req = createPostRequest({
        offerCode: 'GROWTH_300K',
        idempotencyKey: VALID_UUID,
        accepted: { terms: true, privacy: true, refund_auto_renewal: true, marketing: true },
      })
      const res = await POST(req, createContext())
      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.order.offerCode).toBe('GROWTH_300K')
      expect(body.order.amountKrw).toBe(300000)
      expect(body.consents).toHaveLength(4)
      const kinds = body.consents.map((c: { kind: string }) => c.kind)
      expect(kinds).toEqual(['terms', 'privacy', 'refund_auto_renewal', 'marketing'])
    })

    it('12. SCALE_500K 주문 초안을 정상 생성하고 500,000 KRW 금액을 확정한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner-2',
        role: 'owner',
        workspaceId: WORKSPACE_ID,
      })

      const req = createPostRequest({
        offerCode: 'SCALE_500K',
        idempotencyKey: VALID_UUID,
        accepted: { terms: true, privacy: true, refund_auto_renewal: true, marketing: false },
      })
      const res = await POST(req, createContext())
      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.order.offerCode).toBe('SCALE_500K')
      expect(body.order.amountKrw).toBe(500000)
      expect(body.consents).toHaveLength(3)
    })

    it('13. dbClient 주입 시 createSubscriptionOrderWithConsents를 통해 DB에 영속화하고 201을 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner-3',
        role: 'owner',
        workspaceId: WORKSPACE_ID,
      })

      const mockDbClient: any = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_orders') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'order-uuid-persisted',
                  workspace_id: WORKSPACE_ID,
                  offer_code: 'STARTER_150K',
                  amount_krw: 150000,
                  currency: 'KRW',
                  status: 'created',
                  idempotency_key: VALID_UUID,
                  created_by: 'user-owner-3',
                  created_at: '2026-11-09T00:00:00.000Z',
                },
                error: null,
              }),
            }
          }
          if (table === 'subscription_consents') {
            return {
              insert: vi.fn().mockResolvedValue({ data: null, error: null }),
            }
          }
          return {}
        }),
      }

      const req = createPostRequest({
        offerCode: 'STARTER_150K',
        idempotencyKey: VALID_UUID,
        accepted: { terms: true, privacy: true, refund_auto_renewal: true },
      })
      const res = await POST(req, createContext(), { dbClient: mockDbClient })
      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.created).toBe(true)
      expect(body.order.orderId).toBe('order-uuid-persisted')
    })

    it('14. 동일한 idempotencyKey로 재요청 시 DB에서 기존 주문을 찾아 200 OK와 created: false를 반환한다', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user-owner-3',
        role: 'owner',
        workspaceId: WORKSPACE_ID,
      })

      const mockDbClient: any = {
        from: vi.fn((table: string) => {
          if (table === 'subscription_orders') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'order-uuid-existing',
                  workspace_id: WORKSPACE_ID,
                  offer_code: 'STARTER_150K',
                  amount_krw: 150000,
                  currency: 'KRW',
                  status: 'created',
                  idempotency_key: VALID_UUID,
                  created_by: 'user-owner-3',
                  created_at: '2026-11-09T00:00:00.000Z',
                },
                error: null,
              }),
            }
          }
          return {}
        }),
      }

      const req = createPostRequest({
        offerCode: 'STARTER_150K',
        idempotencyKey: VALID_UUID,
        accepted: { terms: true, privacy: true, refund_auto_renewal: true },
      })
      const res = await POST(req, createContext(), { dbClient: mockDbClient })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.created).toBe(false)
      expect(body.order.orderId).toBe('order-uuid-existing')
    })
  })
})
