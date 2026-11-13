import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { issueRequestToken } from '@/features/booking-request/request-token'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

vi.mock('@/features/customers/canonical-customer', () => ({
  resolveCanonicalCustomer: vi.fn(),
}))

vi.mock('@/features/customers/customer-identity-service', () => ({
  linkCustomerIdentity: vi.fn(),
}))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { resolveCanonicalCustomer } from '@/features/customers/canonical-customer'
import { linkCustomerIdentity } from '@/features/customers/customer-identity-service'
import { POST } from './route'

describe('POST /api/public/booking-request', () => {
  const secret = 'test-pass-secret-token-key-for-booking-request-12345'
  const workspaceId = 'ws_salon_gangnam_01'

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.PASS_TOKEN_SECRET = secret
  })

  function createMockAdmin(options?: {
    recentCount?: number
    insertReservationError?: any
    insertEvidenceError?: any
    threadCustomerId?: string
  }) {
    const recentCount = options?.recentCount ?? 0
    let insertedReservation: any = null
    let insertedEvidence: any = null

    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    gte: vi.fn().mockResolvedValue({
                      count: recentCount,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            insert: vi.fn((row: any) => {
              insertedReservation = row
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: options?.insertReservationError ? null : row,
                    error: options?.insertReservationError || null,
                  }),
                }),
              }
            }),
          }
        }

        if (table === 'kakao_notification_evidence') {
          return {
            insert: vi.fn((row: any) => {
              insertedEvidence = row
              return Promise.resolve({
                data: options?.insertEvidenceError ? null : row,
                error: options?.insertEvidenceError || null,
              })
            }),
          }
        }

        if (table === 'instagram_dm_threads') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { customer_id: options?.threadCustomerId || 'igsid_public_1' },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }

        if (table === 'customer_conversations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      _getInsertedReservation: () => insertedReservation,
      _getInsertedEvidence: () => insertedEvidence,
    }

    return admin
  }

  it('successfully creates reservation in AWAITING_CONFIRMATION status and records customer consent evidence', async () => {
    const mockAdmin = createMockAdmin()
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockAdmin as any)
    vi.mocked(resolveCanonicalCustomer).mockResolvedValue({
      customerUuid: 'cust-uuid-1234',
    })

    const token = await issueRequestToken({ workspaceId, secret })
    const futureDate = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 16)

    const req = new NextRequest('http://localhost/api/public/booking-request', {
      method: 'POST',
      body: JSON.stringify({
        token,
        customerName: '홍길동',
        customerPhone: '010-1234-5678',
        desiredStartsAt: futureDate,
        consent: true,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')

    const body = await res.json()
    // Echoes nothing except { ok: true }
    expect(body).toEqual({ ok: true })

    const resRow = mockAdmin._getInsertedReservation()
    expect(resRow).not.toBeNull()
    expect(resRow.workspace_id).toBe(workspaceId)
    expect(resRow.status).toBe('AWAITING_CONFIRMATION')
    expect(resRow.channel_source).toBe('CUSTOMER_REQUEST')
    expect(resRow.customer_name).toBe('홍길동')
    expect(resRow.customer_phone).toBe('01012345678')
    expect(resRow.customer_uuid).toBe('cust-uuid-1234')
    expect(resRow.customer_id).toMatch(/^req_/)
    expect(resRow.metadata.source).toBe('customer_request')
    expect(resRow.metadata.bookingStartsAt).toBeDefined()

    const evRow = mockAdmin._getInsertedEvidence()
    expect(evRow).not.toBeNull()
    expect(evRow.workspace_id).toBe(workspaceId)
    expect(evRow.purpose).toBe('INFO')
    expect(evRow.subject_phone_sha256).toMatch(/^[0-9a-f]{64}$/)
    const ref = JSON.parse(evRow.evidence_ref)
    expect(ref.kind).toBe('CUSTOMER_FORM_CONSENT')
    expect(ref.version).toBe('v1')
    expect(ref.consent_text_version).toBe('v1')
  })

  it('quietly ignores honeypot submissions with 200 OK without inserting anything', async () => {
    const mockAdmin = createMockAdmin()
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockAdmin as any)

    const req = new NextRequest('http://localhost/api/public/booking-request', {
      method: 'POST',
      body: JSON.stringify({
        token: 'any-token',
        customerName: 'Spam Bot',
        customerPhone: '010-9999-9999',
        desiredStartsAt: '2026-11-20T10:00',
        consent: true,
        website: 'http://spam-link.com',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(mockAdmin.from).not.toHaveBeenCalled()
  })

  it('returns 503 if PASS_TOKEN_SECRET is missing', async () => {
    delete process.env.PASS_TOKEN_SECRET

    const req = new NextRequest('http://localhost/api/public/booking-request', {
      method: 'POST',
      body: JSON.stringify({
        token: 'any.token',
        customerName: '홍길동',
        customerPhone: '010-1234-5678',
        desiredStartsAt: '2026-11-20T10:00',
        consent: true,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 if token is invalid or expired', async () => {
    const fixedNow = 1762300000
    const expiredToken = await issueRequestToken({
      workspaceId,
      secret,
      ttlSeconds: 60,
      now: fixedNow,
    })

    const req = new NextRequest('http://localhost/api/public/booking-request', {
      method: 'POST',
      body: JSON.stringify({
        token: expiredToken,
        customerName: '홍길동',
        customerPhone: '010-1234-5678',
        desiredStartsAt: '2099-11-20T10:00',
        consent: true,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 if customerName is empty or exceeds 50 chars', async () => {
    const token = await issueRequestToken({ workspaceId, secret })

    const req1 = new NextRequest('http://localhost/api/public/booking-request', {
      method: 'POST',
      body: JSON.stringify({
        token,
        customerName: '   ',
        customerPhone: '010-1234-5678',
        desiredStartsAt: '2099-11-20T10:00',
        consent: true,
      }),
    })
    expect((await POST(req1)).status).toBe(400)

    const req2 = new NextRequest('http://localhost/api/public/booking-request', {
      method: 'POST',
      body: JSON.stringify({
        token,
        customerName: '가'.repeat(51),
        customerPhone: '010-1234-5678',
        desiredStartsAt: '2099-11-20T10:00',
        consent: true,
      }),
    })
    expect((await POST(req2)).status).toBe(400)
  })

  it('returns 400 if phone format is invalid', async () => {
    const token = await issueRequestToken({ workspaceId, secret })

    const req = new NextRequest('http://localhost/api/public/booking-request', {
      method: 'POST',
      body: JSON.stringify({
        token,
        customerName: '홍길동',
        customerPhone: '02-1234-5678',
        desiredStartsAt: '2099-11-20T10:00',
        consent: true,
      }),
    })
    expect((await POST(req)).status).toBe(400)
  })

  it('returns 400 if desiredStartsAt is in the past', async () => {
    const token = await issueRequestToken({ workspaceId, secret })

    const req = new NextRequest('http://localhost/api/public/booking-request', {
      method: 'POST',
      body: JSON.stringify({
        token,
        customerName: '홍길동',
        customerPhone: '010-1234-5678',
        desiredStartsAt: '2020-01-01T10:00',
        consent: true,
      }),
    })
    expect((await POST(req)).status).toBe(400)
  })

  it('returns 400 if consent is not true', async () => {
    const token = await issueRequestToken({ workspaceId, secret })

    const req = new NextRequest('http://localhost/api/public/booking-request', {
      method: 'POST',
      body: JSON.stringify({
        token,
        customerName: '홍길동',
        customerPhone: '010-1234-5678',
        desiredStartsAt: '2099-11-20T10:00',
        consent: false,
      }),
    })
    expect((await POST(req)).status).toBe(400)
  })

  it('returns 429 when recent booking requests within 10 minutes reach limit (3 or more)', async () => {
    const mockAdmin = createMockAdmin({ recentCount: 3 })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockAdmin as any)

    const token = await issueRequestToken({ workspaceId, secret })
    const req = new NextRequest('http://localhost/api/public/booking-request', {
      method: 'POST',
      body: JSON.stringify({
        token,
        customerName: '홍길동',
        customerPhone: '010-1234-5678',
        desiredStartsAt: '2099-11-20T10:00',
        consent: true,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('요청 바디에 dmThreadId가 있고 customerUuid가 확인된 경우 linkCustomerIdentity를 호출하고 metadata에 dmThreadId를 기록한다', async () => {
    const mockAdmin = createMockAdmin({ threadCustomerId: 'igsid_from_body' })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockAdmin as any)
    vi.mocked(resolveCanonicalCustomer).mockResolvedValue({
      customerUuid: 'cust-uuid-body-1',
    })

    const token = await issueRequestToken({ workspaceId, secret })
    const futureDate = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 16)

    const req = new NextRequest('http://localhost/api/public/booking-request', {
      method: 'POST',
      body: JSON.stringify({
        token,
        customerName: '김인스타',
        customerPhone: '010-9876-5432',
        desiredStartsAt: futureDate,
        consent: true,
        dmThreadId: 'thread-from-body-99',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const resRow = mockAdmin._getInsertedReservation()
    expect(resRow.metadata.dmThreadId).toBe('thread-from-body-99')

    expect(linkCustomerIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        customerUuid: 'cust-uuid-body-1',
        channel: 'INSTAGRAM',
        subjectRef: 'igsid_from_body',
      }),
    )
  })

  it('토큰 페이로드에 igThreadId가 포함되어 발급된 경우에도 동일하게 linkCustomerIdentity를 호출한다', async () => {
    const mockAdmin = createMockAdmin({ threadCustomerId: 'igsid_from_token' })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockAdmin as any)
    vi.mocked(resolveCanonicalCustomer).mockResolvedValue({
      customerUuid: 'cust-uuid-token-1',
    })

    const token = await issueRequestToken({
      workspaceId,
      secret,
      igThreadId: 'thread-from-token-88',
    })
    const futureDate = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 16)

    const req = new NextRequest('http://localhost/api/public/booking-request', {
      method: 'POST',
      body: JSON.stringify({
        token,
        customerName: '이토큰',
        customerPhone: '010-5555-6666',
        desiredStartsAt: futureDate,
        consent: true,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const resRow = mockAdmin._getInsertedReservation()
    expect(resRow.metadata.dmThreadId).toBe('thread-from-token-88')

    expect(linkCustomerIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        customerUuid: 'cust-uuid-token-1',
        channel: 'INSTAGRAM',
        subjectRef: 'igsid_from_token',
      }),
    )
  })
})
