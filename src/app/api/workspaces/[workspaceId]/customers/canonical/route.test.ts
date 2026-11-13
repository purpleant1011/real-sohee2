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

describe('GET /api/workspaces/[workspaceId]/customers/canonical', () => {
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

    const req = new Request('https://example.com/api/workspaces/ws-1/customers/canonical')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: '로그인이 필요해요.' })
  })

  it('다른 워크스페이스 id 요청 - 403 반환 및 no-store', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-different',
      role: 'owner',
    })

    const req = new Request('https://example.com/api/workspaces/ws-target/customers/canonical')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-target' }) })

    expect(res.status).toBe(403)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body.error).toBe('접근 권한이 없습니다.')
  })

  it('잘못된 limit 파라미터 - 400 반환', async () => {
    mockAuthorizeQuickRequest.mockResolvedValue({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const invalidLimits = ['0', '-1', '101', 'abc', '1.5']
    for (const lim of invalidLimits) {
      const req = new Request(`https://example.com/api/workspaces/ws-1/customers/canonical?limit=${lim}`)
      const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

      expect(res.status).toBe(400)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const body = await res.json()
      expect(body.error).toBe('limit은 1에서 100 사이의 정수여야 해요.')
    }
  })

  it('기본 조회 성공 - 고객 및 예약 1회 조회 후 메모리 집계(N+1 방지), 마스킹 변환, no-store', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const mockCustomers = [
      {
        id: 'cust-1',
        display_name: '홍길동',
        phone_e164: '+821027104855',
        updated_at: '2026-11-09T09:00:00Z',
      },
      {
        id: 'cust-2',
        display_name: '이순신',
        phone_e164: null,
        updated_at: '2026-11-09T08:00:00Z',
      },
      {
        id: 'cust-3',
        display_name: '강감찬',
        phone_e164: '+821098765432',
        updated_at: '2026-11-09T07:00:00Z',
      },
    ]

    const mockReservations = [
      {
        id: 'res-1',
        customer_uuid: 'cust-1',
        metadata: { bookingStartsAt: '2026-11-10T14:00:00+09:00' },
        created_at: '2026-11-01T10:00:00Z',
      },
      {
        id: 'res-2',
        customer_uuid: 'cust-1',
        metadata: { bookingStartsAt: '2026-11-15T16:00:00+09:00' },
        created_at: '2026-11-05T10:00:00Z',
      },
      {
        id: 'res-3',
        customer_uuid: 'cust-3',
        metadata: { startsAt: '2026-11-12T11:00:00+09:00' },
        created_at: '2026-11-02T10:00:00Z',
      },
    ]

    const custSelectMock = vi.fn().mockReturnThis()
    const custEqMock = vi.fn().mockReturnThis()
    const custOrderMock = vi.fn().mockReturnThis()
    const custLimitMock = vi.fn().mockResolvedValue({ data: mockCustomers, error: null })

    const resSelectMock = vi.fn().mockReturnThis()
    const resEqMock = vi.fn().mockReturnThis()
    const resInMock = vi.fn().mockResolvedValue({ data: mockReservations, error: null })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return {
            select: custSelectMock,
            eq: custEqMock,
            order: custOrderMock,
            limit: custLimitMock,
          }
        }
        if (table === 'reservations') {
          return {
            select: resSelectMock,
            eq: resEqMock,
            in: resInMock,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/customers/canonical')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    expect(custSelectMock).toHaveBeenCalledWith('id, display_name, phone_e164, updated_at')
    expect(custEqMock).toHaveBeenCalledWith('workspace_id', 'ws-1')
    expect(custOrderMock).toHaveBeenCalledWith('updated_at', { ascending: false })
    expect(custLimitMock).toHaveBeenCalledWith(50)

    // N+1 방지: reservations 쿼리는 단 1회 in 조건으로 호출됨
    expect(mockAdmin.from).toHaveBeenCalledWith('reservations')
    expect(resEqMock).toHaveBeenCalledWith('workspace_id', 'ws-1')
    expect(resInMock).toHaveBeenCalledWith('customer_uuid', ['cust-1', 'cust-2', 'cust-3'])

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(3)

    // cust-1: 예약 2건, 마지막 예약일시는 더 미래인 11-15T16:00
    expect(body.items[0]).toEqual({
      id: 'cust-1',
      displayName: '홍길동',
      phoneMasked: '010-****-4855',
      reservationCount: 2,
      lastBookingStartsAt: '2026-11-15T16:00:00+09:00',
    })

    // cust-2: 예약 0건, 전화번호 없음
    expect(body.items[1]).toEqual({
      id: 'cust-2',
      displayName: '이순신',
      phoneMasked: null,
      reservationCount: 0,
      lastBookingStartsAt: null,
    })

    // cust-3: 예약 1건 (startsAt 필드 인식)
    expect(body.items[2]).toEqual({
      id: 'cust-3',
      displayName: '강감찬',
      phoneMasked: '010-****-5432',
      reservationCount: 1,
      lastBookingStartsAt: '2026-11-12T11:00:00+09:00',
    })
  })

  it('?q= 이름 부분일치 검색 및 커스텀 limit 적용', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const custIlikeMock = vi.fn().mockReturnThis()
    const custSelectMock = vi.fn().mockReturnThis()
    const custEqMock = vi.fn().mockReturnValue({
      ilike: custIlikeMock,
    })
    const custOrderMock = vi.fn().mockReturnThis()
    const custLimitMock = vi.fn().mockResolvedValue({ data: [], error: null })
    custIlikeMock.mockReturnValue({
      order: custOrderMock,
      limit: custLimitMock,
    })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        expect(table).toBe('customers')
        return {
          select: custSelectMock,
          eq: custEqMock,
        }
      }),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/customers/canonical?q=길동&limit=25')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    expect(custIlikeMock).toHaveBeenCalledWith('display_name', '%길동%')
    expect(custLimitMock).toHaveBeenCalledWith(25)

    const body = await res.json()
    expect(body).toEqual({ ok: true, items: [] })
    // 고객이 없으므로 reservations 쿼리는 호출되지 않아야 함
    expect(mockAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('전화번호 원문 및 해시가 응답 본문에 절대 포함되지 않음을 검증 (PII 차단)', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'owner',
    })

    const mockCustomers = [
      {
        id: 'cust-1',
        display_name: '비밀고객',
        phone_e164: '+821027104855',
        updated_at: '2026-11-09T09:00:00Z',
      },
    ]

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: mockCustomers, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/customers/canonical')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    const rawText = await res.text()

    // 원문 중간 번호 '2710' 또는 E.164 전체 번호 '+821027104855' 노출 금지
    expect(rawText).not.toContain('+821027104855')
    expect(rawText).not.toContain('2710')
    expect(rawText).not.toContain('phone_sha256')
    expect(rawText).not.toContain('phoneSha256')
    expect(rawText).not.toContain('phone_e164')
    expect(rawText).not.toContain('phoneE164')

    const parsed = JSON.parse(rawText)
    expect(parsed.items[0].phoneMasked).toBe('010-****-4855')
  })

  it('DB 오류 시 500 고정 문구 반환 및 에러 상세 노출 차단', async () => {
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
          error: { message: 'relation "customers" does not exist at postgres_secret_key=xyz' },
        }),
      })),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/customers/canonical')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(500)
    expect(res.headers.get('Cache-Control')).toBe('no-store')

    const rawText = await res.text()
    expect(rawText).not.toContain('postgres_secret_key')
    expect(rawText).not.toContain('relation "customers"')

    const body = JSON.parse(rawText)
    expect(body.error).toBe('고객 목록을 불러오지 못했습니다.')
  })

  it('customer_uuid로 연결된 customer_conversations가 있는 경우 대화 건수와 최근 대화 일시를 함께 집계한다', async () => {
    mockAuthorizeQuickRequest.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const mockCustomers = [
      {
        id: 'cust-linked-1',
        display_name: '연결고객',
        phone_e164: '+821011112222',
        updated_at: '2026-11-09T09:00:00Z',
      },
    ]

    const mockConversations = [
      {
        id: 'conv-1',
        customer_uuid: 'cust-linked-1',
        channel: 'instagram',
        summary: '예약 문의',
        display_label: '연결고객',
        latest_message_at: '2026-11-09T08:30:00Z',
        updated_at: '2026-11-09T08:30:00Z',
      },
      {
        id: 'conv-2',
        customer_uuid: 'cust-linked-1',
        channel: 'instagram',
        summary: '추가 문의',
        display_label: '연결고객',
        latest_message_at: '2026-11-09T09:15:00Z',
        updated_at: '2026-11-09T09:15:00Z',
      },
    ]

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: mockCustomers, error: null }),
          }
        }
        if (table === 'reservations') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        if (table === 'customer_conversations') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: mockConversations, error: null }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }
    mockCreateAdminSupabaseClient.mockReturnValue(mockAdmin)

    const req = new Request('https://example.com/api/workspaces/ws-1/customers/canonical')
    const res = await GET(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: 'cust-linked-1',
      displayName: '연결고객',
      phoneMasked: '010-****-2222',
      reservationCount: 0,
      conversationCount: 2,
      lastConversationAt: '2026-11-09T09:15:00Z',
    })
  })
})
