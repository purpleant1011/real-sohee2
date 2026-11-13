import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET } from './route'

const mockAuthorizeQuickRequest = vi.fn()
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: (...args: any[]) => mockAuthorizeQuickRequest(...args),
  isResponse: (v: any) => v && typeof v.status === 'number',
}))

const mockCreateAdminSupabaseClient = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => mockCreateAdminSupabaseClient(),
}))

describe('GET /api/workspaces/[workspaceId]/kakao/outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('인증 없음 - 401 반환', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: '로그인이 필요해요.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const req = new Request('https://example.com/api/workspaces/ws-1/kakao/outbox')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: '로그인이 필요해요.' })
  })

  it('다른 워크스페이스 id 요청 - 403 반환', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-different',
      role: 'owner',
    })

    const req = new Request('https://example.com/api/workspaces/ws-target/kakao/outbox')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-target' }) })

    expect(res.status).toBe(403)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('잘못된 limit 파라미터 - 400 반환', async () => {
    mockAuthorizeQuickRequest.mockResolvedValue({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const invalidLimits = ['0', '-1', '101', 'abc', '1.5']
    for (const lim of invalidLimits) {
      const req = new Request(`https://example.com/api/workspaces/ws-1/kakao/outbox?limit=${lim}`)
      const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

      expect(res.status).toBe(400)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    }
  })

  it('워크스페이스 최근 순 기본 목록 조회 (기본 limit 50, Cache-Control: no-store)', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const mockRows = [
      {
        id: 'outbox-1',
        reservation_id: 'res-1',
        event: 'BOOKING_CONFIRMED',
        status: 'READY',
        reason_code: null,
        delivery_status: null,
        due_at: '2026-11-10T10:00:00Z',
        updated_at: '2026-11-09T09:00:00Z',
      },
      {
        id: 'outbox-2',
        reservation_id: 'res-2',
        event: 'REMINDER_24H',
        status: 'SENT',
        reason_code: null,
        delivery_status: 'DELIVERED',
        due_at: '2026-11-10T09:00:00Z',
        updated_at: '2026-11-09T08:00:00Z',
      },
    ]

    const selectMock = vi.fn().mockReturnThis()
    const eqMock = vi.fn().mockReturnThis()
    const orderMock = vi.fn().mockReturnThis()
    const limitMock = vi.fn().mockResolvedValue({ data: mockRows, error: null })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        expect(table).toBe('kakao_notification_outbox')
        return {
          select: selectMock,
          eq: eqMock,
          order: orderMock,
          limit: limitMock,
        }
      }),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/kakao/outbox')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    expect(selectMock).toHaveBeenCalledWith('id, reservation_id, event, status, reason_code, delivery_status, due_at, updated_at')
    expect(eqMock).toHaveBeenCalledWith('workspace_id', 'ws-1')
    expect(orderMock).toHaveBeenCalledWith('updated_at', { ascending: false })
    expect(limitMock).toHaveBeenCalledWith(50)

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(2)
    expect(body.items[0]).toEqual({
      id: 'outbox-1',
      reservationId: 'res-1',
      event: 'BOOKING_CONFIRMED',
      eventLabel: '예약 확정 안내',
      status: 'SCHEDULED',
      statusLabel: '발송 예정',
      detailLabel: null,
      dueAt: '2026-11-10T10:00:00Z',
      updatedAt: '2026-11-09T09:00:00Z',
    })
    expect(body.items[1].status).toBe('DELIVERED')
    expect(body.items[1].statusLabel).toBe('도착 확인')
  })

  it('reservationId 필터 파라미터 적용', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'owner',
    })

    const selectMock = vi.fn().mockReturnThis()
    const eqMock = vi.fn().mockReturnThis()
    const orderMock = vi.fn().mockReturnThis()
    const limitMock = vi.fn().mockResolvedValue({ data: [], error: null })

    const mockAdmin = {
      from: vi.fn(() => ({
        select: selectMock,
        eq: eqMock,
        order: orderMock,
        limit: limitMock,
      })),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/kakao/outbox?reservationId=res-999&limit=20')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    expect(eqMock).toHaveBeenCalledWith('workspace_id', 'ws-1')
    expect(eqMock).toHaveBeenCalledWith('reservation_id', 'res-999')
    expect(limitMock).toHaveBeenCalledWith(20)
  })

  it('customerId 필터 - 예약 존재 시 in(reservation_id, ids) 쿼리', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const resLimitMock = vi.fn().mockResolvedValue({
      data: [{ id: 'res-a' }, { id: 'res-b' }],
      error: null,
    })
    const resEqCustMock = vi.fn().mockReturnValue({ limit: resLimitMock })
    const resEqWsMock = vi.fn().mockReturnValue({ eq: resEqCustMock })
    const resSelectMock = vi.fn().mockReturnValue({ eq: resEqWsMock })

    const outboxSelectMock = vi.fn().mockReturnThis()
    const outboxEqMock = vi.fn().mockReturnThis()
    const outboxInMock = vi.fn().mockReturnThis()
    const outboxOrderMock = vi.fn().mockReturnThis()
    const outboxLimitMock = vi.fn().mockResolvedValue({ data: [], error: null })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return {
            select: resSelectMock,
          }
        }
        return {
          select: outboxSelectMock,
          eq: outboxEqMock,
          in: outboxInMock,
          order: outboxOrderMock,
          limit: outboxLimitMock,
        }
      }),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/kakao/outbox?customerId=cust-1')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    expect(mockAdmin.from).toHaveBeenCalledWith('reservations')
    expect(outboxInMock).toHaveBeenCalledWith('reservation_id', ['res-a', 'res-b'])
  })

  it('customerId 필터 - 일치하는 예약이 없으면 outbox 쿼리 없이 빈 items 반환', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        expect(table).toBe('reservations')
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }
      }),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/kakao/outbox?customerId=cust-none')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, items: [] })
    expect(mockAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('customerUuid 필터 - 예약 존재 시 in(reservation_id, ids) 쿼리', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const resLimitMock = vi.fn().mockResolvedValue({
      data: [{ id: 'res-u1' }, { id: 'res-u2' }],
      error: null,
    })
    const resEqUuidMock = vi.fn().mockReturnValue({ limit: resLimitMock })
    const resEqWsMock = vi.fn().mockReturnValue({ eq: resEqUuidMock })
    const resSelectMock = vi.fn().mockReturnValue({ eq: resEqWsMock })

    const outboxSelectMock = vi.fn().mockReturnThis()
    const outboxEqMock = vi.fn().mockReturnThis()
    const outboxInMock = vi.fn().mockReturnThis()
    const outboxOrderMock = vi.fn().mockReturnThis()
    const outboxLimitMock = vi.fn().mockResolvedValue({ data: [], error: null })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return {
            select: resSelectMock,
          }
        }
        return {
          select: outboxSelectMock,
          eq: outboxEqMock,
          in: outboxInMock,
          order: outboxOrderMock,
          limit: outboxLimitMock,
        }
      }),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/kakao/outbox?customerUuid=cust-uuid-1')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    expect(mockAdmin.from).toHaveBeenCalledWith('reservations')
    expect(resEqWsMock).toHaveBeenCalledWith('workspace_id', 'ws-1')
    expect(resEqUuidMock).toHaveBeenCalledWith('customer_uuid', 'cust-uuid-1')
    expect(resLimitMock).toHaveBeenCalledWith(200)
    expect(outboxInMock).toHaveBeenCalledWith('reservation_id', ['res-u1', 'res-u2'])
  })

  it('customerUuid와 customerId 둘 다 전달 시 customerUuid 우선 적용', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const resLimitMock = vi.fn().mockResolvedValue({
      data: [{ id: 'res-from-uuid' }],
      error: null,
    })
    const resEqUuidMock = vi.fn().mockReturnValue({ limit: resLimitMock })
    const resEqWsMock = vi.fn().mockReturnValue({ eq: resEqUuidMock })
    const resSelectMock = vi.fn().mockReturnValue({ eq: resEqWsMock })

    const outboxSelectMock = vi.fn().mockReturnThis()
    const outboxEqMock = vi.fn().mockReturnThis()
    const outboxInMock = vi.fn().mockReturnThis()
    const outboxOrderMock = vi.fn().mockReturnThis()
    const outboxLimitMock = vi.fn().mockResolvedValue({ data: [], error: null })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return {
            select: resSelectMock,
          }
        }
        return {
          select: outboxSelectMock,
          eq: outboxEqMock,
          in: outboxInMock,
          order: outboxOrderMock,
          limit: outboxLimitMock,
        }
      }),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/kakao/outbox?customerUuid=cust-uuid-priority&customerId=legacy-id')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    expect(resEqUuidMock).toHaveBeenCalledWith('customer_uuid', 'cust-uuid-priority')
    expect(outboxInMock).toHaveBeenCalledWith('reservation_id', ['res-from-uuid'])
  })

  it('다른 워크스페이스 customerUuid (해당 워크스페이스 예약 없음) - 빈 결과 반환', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        expect(table).toBe('reservations')
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }
      }),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/kakao/outbox?customerUuid=other-ws-customer-uuid')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, items: [] })
    expect(mockAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('변환 불가 행(알 수 없는 이벤트/상태) 제외 처리', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const mockRows = [
      {
        id: 'outbox-valid',
        reservation_id: 'res-1',
        event: 'BOOKING_CONFIRMED',
        status: 'READY',
        reason_code: null,
        delivery_status: null,
        due_at: '2026-11-10T10:00:00Z',
        updated_at: '2026-11-09T09:00:00Z',
      },
      {
        id: 'outbox-invalid-event',
        reservation_id: 'res-2',
        event: 'UNKNOWN_CUSTOM_EVENT',
        status: 'READY',
        reason_code: null,
        delivery_status: null,
        due_at: '2026-11-10T10:00:00Z',
        updated_at: '2026-11-09T09:00:00Z',
      },
      {
        id: 'outbox-invalid-status',
        reservation_id: 'res-3',
        event: 'BOOKING_CANCELLED',
        status: 'INVALID_STATUS_CODE',
        reason_code: null,
        delivery_status: null,
        due_at: '2026-11-10T10:00:00Z',
        updated_at: '2026-11-09T09:00:00Z',
      },
    ]

    const mockAdmin = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockRows, error: null }),
      })),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/kakao/outbox')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe('outbox-valid')
  })

  it('응답에 전화번호·이름·reason_code 원문이 노출되지 않음을 증명', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'owner',
    })

    const mockRows = [
      {
        id: 'outbox-1',
        reservation_id: 'res-1',
        event: 'BOOKING_CONFIRMED',
        status: 'BLOCKED',
        reason_code: 'EVIDENCE_MISSING',
        delivery_status: null,
        due_at: '2026-11-10T10:00:00Z',
        updated_at: '2026-11-09T09:00:00Z',
      },
    ]

    const mockAdmin = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockRows, error: null }),
      })),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/kakao/outbox')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    const rawText = await res.text()

    // reason_code 원문이 JSON 응답 텍스트에 포함되지 않아야 함
    expect(rawText).not.toContain('EVIDENCE_MISSING')
    expect(rawText).not.toContain('reason_code')

    // 고객 전화번호 패턴이나 이름 필드가 포함되지 않아야 함
    expect(rawText).not.toMatch(/010[-0-9]{8,9}/)
    expect(rawText).not.toContain('customer_name')
    expect(rawText).not.toContain('customerName')
    expect(rawText).not.toContain('customer_phone')
    expect(rawText).not.toContain('customerPhone')

    const body = JSON.parse(rawText)
    expect(body.items[0].status).toBe('HELD')
    expect(body.items[0].detailLabel).toBe('고객에게 알렸다는 확인이 없어 보내지 않았어요.')
  })

  it('DB 에러 발생 시 내부 SQL/에러 상세 노출 없이 500 고정 문구와 Cache-Control: no-store 반환', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const mockAdmin = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'relation "kakao_notification_outbox" does not exist at postgres_secret_key=xyz' },
        }),
      })),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/kakao/outbox')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(500)
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    const rawText = await res.text()
    expect(rawText).not.toContain('postgres_secret_key')
    expect(rawText).not.toContain('relation "kakao_notification_outbox"')

    const body = JSON.parse(rawText)
    expect(body.error).toBe('알림톡 발송 내역을 불러오지 못했습니다.')
  })

  it('DB에서 rows가 null로 반환될 때 빈 배열로 둔갑하지 않고 500 에러를 반환한다', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const mockAdmin = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/kakao/outbox')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('알림톡 발송 내역을 불러오지 못했습니다.')
  })
})
