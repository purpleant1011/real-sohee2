import { describe, expect, it, vi, beforeEach } from 'vitest'
import { POST } from './route'

const mockAuth = vi.fn()
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: (...args: any[]) => mockAuth(...args),
  isResponse: (v: any) => v && typeof v.status === 'number',
}))

describe('POST /api/workspaces/[workspaceId]/reservations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates required fields and returns 422 on invalid input', async () => {
    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin: {},
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(422)
  })

  it('refuses DM-linked shortcuts before any reservation or thread mutation', async () => {
    const from = vi.fn(() => { throw new Error('must not write') })
    mockAuth.mockResolvedValueOnce({ workspaceId: 'ws-1', admin: { from } })
    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST', body: JSON.stringify({ customerName: '테스트 고객', serviceName: '상담', bookingStartsAt: '2026-10-20T14:00:00+09:00', dmThreadId: 'old-test-thread' }),
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'CUSTOMER_ACCEPTANCE_REVIEW_REQUIRED' })
    expect(from).not.toHaveBeenCalled()
  })

  it('creates an owner-entered reservation separately from DM customer acceptance', async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'res-123',
            customer_name: 'hoceol339',
            status: 'CONFIRMED',
          },
          error: null,
        }),
      }),
    })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return { insert: mockInsert }
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }
      }),
    }

    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin: mockAdmin,
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: 'hoceol339',
        customerPhone: '010-1234-5678',
        serviceName: '1:1 맞춤 퍼스널 뷰티',
        bookingStartsAt: '2026-10-20T14:00:00+09:00',
        totalAmountKrw: 80000,
        depositKrw: 20000,
        channelSource: 'instagram_dm',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(201)

    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.reservation.id).toBe('res-123')
    expect(json.consentEvidenceRecorded).toBe(false)
  })

  it('records owner-attested evidence when attested is true and phone is present', async () => {
    const mockResInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'res-789',
            customer_name: '테스트고객',
            status: 'CONFIRMED',
          },
          error: null,
        }),
      }),
    })

    const mockEvidenceInsert = vi.fn().mockResolvedValue({ error: null })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return { insert: mockResInsert }
        }
        if (table === 'kakao_notification_evidence') {
          return { insert: mockEvidenceInsert }
        }
        return {}
      }),
    }

    mockAuth.mockResolvedValueOnce({
      userId: 'user-manager-1',
      workspaceId: 'ws-1',
      admin: mockAdmin,
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: '테스트고객',
        customerPhone: '010-9876-5432',
        serviceName: '헤어 컷',
        bookingStartsAt: '2026-10-20T14:00:00+09:00',
        notifyConsentAttested: true,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.consentEvidenceRecorded).toBe(true)

    expect(mockEvidenceInsert).toHaveBeenCalledTimes(1)
    const insertedRow = mockEvidenceInsert.mock.calls[0][0]
    expect(insertedRow.workspace_id).toBe('ws-1')
    expect(insertedRow.reservation_id).toBe('res-789')
    expect(insertedRow.purpose).toBe('INFO')
    // 번호 원문 포함 여부 검증 (격리)
    expect(JSON.stringify(insertedRow)).not.toContain('010-9876-5432')
    expect(JSON.stringify(insertedRow)).not.toContain('01098765432')
    // actorUserId 검증
    const parsedRef = JSON.parse(insertedRow.evidence_ref)
    expect(parsedRef.actor_id).toBe('user-manager-1')
  })

  it('does not insert evidence when notifyConsentAttested is false', async () => {
    const mockResInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'res-456',
            customer_name: '고객명',
            status: 'CONFIRMED',
          },
          error: null,
        }),
      }),
    })

    const mockEvidenceInsert = vi.fn()

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return { insert: mockResInsert }
        }
        if (table === 'kakao_notification_evidence') {
          return { insert: mockEvidenceInsert }
        }
        return {}
      }),
    }

    mockAuth.mockResolvedValueOnce({
      userId: 'user-manager-1',
      workspaceId: 'ws-1',
      admin: mockAdmin,
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: '고객명',
        customerPhone: '010-1111-2222',
        serviceName: '상담',
        bookingStartsAt: '2026-10-20T14:00:00+09:00',
        notifyConsentAttested: false,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.consentEvidenceRecorded).toBe(false)
    expect(mockEvidenceInsert).not.toHaveBeenCalled()
  })

  it('keeps 201 with consentEvidenceRecorded false when evidence insert fails', async () => {
    const mockResInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'res-789',
            customer_name: '테스트고객',
            status: 'CONFIRMED',
          },
          error: null,
        }),
      }),
    })

    const mockEvidenceInsert = vi.fn().mockResolvedValue({
      error: { message: 'db connection failed' },
    })

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return { insert: mockResInsert }
        }
        if (table === 'kakao_notification_evidence') {
          return { insert: mockEvidenceInsert }
        }
        return {}
      }),
    }

    mockAuth.mockResolvedValueOnce({
      userId: 'user-manager-1',
      workspaceId: 'ws-1',
      admin: mockAdmin,
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: '테스트고객',
        customerPhone: '010-9876-5432',
        serviceName: '헤어 컷',
        bookingStartsAt: '2026-10-20T14:00:00+09:00',
        notifyConsentAttested: true,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.reservation.id).toBe('res-789')
    expect(json.consentEvidenceRecorded).toBe(false)
  })

  it('ignores evidence record when attested is true but phone is missing (201 with recorded false)', async () => {
    const mockResInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'res-no-phone',
            customer_name: '폰없는고객',
            status: 'CONFIRMED',
          },
          error: null,
        }),
      }),
    })

    const mockEvidenceInsert = vi.fn()

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return { insert: mockResInsert }
        }
        if (table === 'kakao_notification_evidence') {
          return { insert: mockEvidenceInsert }
        }
        return {}
      }),
    }

    mockAuth.mockResolvedValueOnce({
      userId: 'user-manager-1',
      workspaceId: 'ws-1',
      admin: mockAdmin,
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: '폰없는고객',
        serviceName: '상담',
        bookingStartsAt: '2026-10-20T14:00:00+09:00',
        notifyConsentAttested: true,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.consentEvidenceRecorded).toBe(false)
    expect(mockEvidenceInsert).not.toHaveBeenCalled()
  })

  it('시간대 없는 bookingStartsAt("2026-10-20 14:00") 입력을 KST(+09:00)로 정규화하여 metadata에 저장한다', async () => {
    let insertedReservationPayload: any = null
    const mockResInsert = vi.fn((payload: any) => {
      insertedReservationPayload = payload
      return {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'res-kst-1', status: 'CONFIRMED' },
            error: null,
          }),
        }),
      }
    })

    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin: {
        from: vi.fn(() => ({ insert: mockResInsert })),
      },
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: '홍길동',
        serviceName: '헤어 커트',
        bookingStartsAt: '2026-10-20 14:00',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(201)
    expect(insertedReservationPayload?.metadata?.bookingStartsAt).toBe(
      '2026-10-20T14:00:00+09:00'
    )
  })

  it('날짜가 유효하지 않은 bookingStartsAt(예: 2026-02-31)인 경우 400 응답을 반환한다', async () => {
    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin: {},
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: '홍길동',
        serviceName: '헤어 커트',
        bookingStartsAt: '2026-02-31 14:00',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/예약 일시/i)
  })

  it('customerPhone의 하이픈·공백을 제거해 010 11자리로 정규화하여 저장하고 evidence에도 정규화 번호를 쓴다', async () => {
    let insertedReservationPayload: any = null
    const mockResInsert = vi.fn((payload: any) => {
      insertedReservationPayload = payload
      return {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'res-phone-norm', status: 'CONFIRMED' },
            error: null,
          }),
        }),
      }
    })

    const mockEvidenceInsert = vi.fn().mockResolvedValue({ error: null })

    mockAuth.mockResolvedValueOnce({
      userId: 'user-manager-1',
      workspaceId: 'ws-1',
      admin: {
        from: vi.fn((table: string) => {
          if (table === 'reservations') return { insert: mockResInsert }
          if (table === 'kakao_notification_evidence') return { insert: mockEvidenceInsert }
          return {}
        }),
      },
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: '홍길동',
        customerPhone: ' 010 - 1234 - 5678 ',
        serviceName: '헤어 커트',
        bookingStartsAt: '2026-10-20 14:00',
        notifyConsentAttested: true,
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(201)
    expect(insertedReservationPayload.customer_phone).toBe('01012345678')
    expect(mockEvidenceInsert).toHaveBeenCalledTimes(1)
  })

  it('customerPhone 형식이 잘못된 경우 400 "전화번호를 확인해 주세요"를 반환한다', async () => {
    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin: {},
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: '홍길동',
        customerPhone: '011-123-4567',
        serviceName: '헤어 커트',
        bookingStartsAt: '2026-10-20 14:00',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('전화번호를 확인해 주세요.')
  })

  it('예약 등록 시 번호가 있으면 resolveCanonicalCustomer로 customer_uuid를 구해 reservations insert에 포함한다 (기존 customer_id 유지)', async () => {
    let insertedPayload: any = null
    const mockResInsert = vi.fn((payload: any) => {
      insertedPayload = payload
      return {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'res-canonical-1', status: 'CONFIRMED' },
            error: null,
          }),
        }),
      }
    })

    const mockRpc = vi.fn().mockResolvedValue({
      data: '00000000-0000-0000-0000-000000000099',
      error: null,
    })

    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin: {
        rpc: mockRpc,
        from: vi.fn((table: string) => {
          if (table === 'reservations') return { insert: mockResInsert }
          return {}
        }),
      },
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: '성춘향',
        customerPhone: '010-1234-5678',
        serviceName: '헤어 클리닉',
        bookingStartsAt: '2026-10-20 14:00',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(201)
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('upsert_customer_by_phone', {
      p_workspace_id: 'ws-1',
      p_display_name: '성춘향',
      p_phone_e164: '+821012345678',
      p_phone_sha256: expect.any(String),
    })
    expect(insertedPayload.customer_uuid).toBe('00000000-0000-0000-0000-000000000099')
    expect(insertedPayload.customer_id).toBe('성춘향')
    expect(insertedPayload.customer_name).toBe('성춘향')
  })

  it('고객 정본 조회 실패(RPC 오류) 시에도 예약 생성이 정상 진행되며 customer_uuid는 생략된다 (fail-open)', async () => {
    let insertedPayload: any = null
    const mockResInsert = vi.fn((payload: any) => {
      insertedPayload = payload
      return {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'res-canonical-fail', status: 'CONFIRMED' },
            error: null,
          }),
        }),
      }
    })

    const mockRpc = vi.fn().mockRejectedValue(new Error('RPC network timeout'))

    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin: {
        rpc: mockRpc,
        from: vi.fn((table: string) => {
          if (table === 'reservations') return { insert: mockResInsert }
          return {}
        }),
      },
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: '이몽룡',
        customerPhone: '010-9876-5432',
        serviceName: '네일 아트',
        bookingStartsAt: '2026-10-20 14:00',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(201)
    expect(insertedPayload).toBeDefined()
    expect(insertedPayload.customer_uuid).toBeUndefined()
    expect(insertedPayload.customer_id).toBe('이몽룡')
  })

  it('전화번호가 없는 경우 customer_uuid는 reservations insert에서 생략된다', async () => {
    let insertedPayload: any = null
    const mockResInsert = vi.fn((payload: any) => {
      insertedPayload = payload
      return {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'res-no-phone-uuid', status: 'CONFIRMED' },
            error: null,
          }),
        }),
      }
    })

    const mockRpc = vi.fn()

    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin: {
        rpc: mockRpc,
        from: vi.fn((table: string) => {
          if (table === 'reservations') return { insert: mockResInsert }
          return {}
        }),
      },
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: '전화없는고객',
        serviceName: '스킨케어',
        bookingStartsAt: '2026-10-20 14:00',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(201)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(insertedPayload.customer_uuid).toBeUndefined()
    expect(insertedPayload.customer_id).toBe('전화없는고객')
  })

  it('dmThreadId가 전달되고 customerUuid가 확인된 경우 linkCustomerIdentity를 호출하여 식별자를 연결하고 DM thread 상태를 SENT로 변경한다', async () => {
    let insertedPayload: any = null
    const mockResInsert = vi.fn((payload: any) => {
      insertedPayload = payload
      return {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'res-with-dm', status: 'CONFIRMED' },
            error: null,
          }),
        }),
      }
    })

    const mockRpc = vi.fn().mockResolvedValue({
      data: '00000000-0000-0000-0000-000000000088',
      error: null,
    })

    const mockThreadUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })

    const mockThreadSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { customer_id: 'igsid_9999' },
            error: null,
          }),
        }),
      }),
    })

    const mockIdentityUpsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'ident-link-1' },
          error: null,
        }),
      }),
    })

    const mockConvUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: [{ id: 'conv-link-1' }],
            error: null,
          }),
        }),
      }),
    })

    const mockAdmin = {
      rpc: mockRpc,
      from: vi.fn((table: string) => {
        if (table === 'reservations') return { insert: mockResInsert }
        if (table === 'instagram_dm_threads') {
          return {
            update: mockThreadUpdate,
            select: mockThreadSelect,
          }
        }
        if (table === 'customer_identities') {
          return { upsert: mockIdentityUpsert }
        }
        if (table === 'customer_conversations') {
          return { update: mockConvUpdate }
        }
        return {}
      }),
    }

    mockAuth.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      admin: mockAdmin,
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/reservations', {
      method: 'POST',
      body: JSON.stringify({
        customerName: '인스타고객',
        customerPhone: '010-1234-5678',
        serviceName: '헤어 스타일링',
        bookingStartsAt: '2026-10-20 14:00',
        dmThreadId: 'thread-dm-123',
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ workspaceId: 'ws-1' }) })
    expect(res.status).toBe(201)
    expect(insertedPayload.customer_uuid).toBe('00000000-0000-0000-0000-000000000088')
    expect(insertedPayload.metadata.dmThreadId).toBe('thread-dm-123')

    // customer_identities upsert 호출 검증
    expect(mockAdmin.from).toHaveBeenCalledWith('customer_identities')
    expect(mockIdentityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 'ws-1',
        customer_id: '00000000-0000-0000-0000-000000000088',
        channel: 'INSTAGRAM',
        subject_ref: 'igsid_9999',
      }),
      expect.anything(),
    )

    // instagram_dm_threads SENT 업데이트 검증
    expect(mockThreadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SENT' }),
    )
  })
})
