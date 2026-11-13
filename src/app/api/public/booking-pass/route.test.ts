import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { issuePassToken } from '@/features/kakao/booking-pass/pass-token'

// Mock createAdminSupabaseClient
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { GET } from './route'

describe('GET /api/public/booking-pass', () => {
  const secret = 'test-pass-secret-token-key-123'
  const workspaceId = 'ws_salon_public_01'
  const bookingId = 'bk_public_001'

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.PASS_TOKEN_SECRET = secret
  })

  function createMockDb(reservationData: Record<string, unknown> | null, profileData?: Record<string, unknown> | null) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: reservationData,
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: profileData ?? null,
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }
  }

  it('returns 400 if token parameter is missing', async () => {
    const req = new NextRequest('http://localhost/api/public/booking-pass')
    const res = await GET(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('missing_token')
  })

  it('returns 503 if PASS_TOKEN_SECRET is not configured (ignores KAKAO_STATE_SECRET fallback)', async () => {
    delete process.env.PASS_TOKEN_SECRET
    process.env.KAKAO_STATE_SECRET = 'should-never-be-used-as-fallback'

    const req = new NextRequest('http://localhost/api/public/booking-pass?token=sample.token')
    const res = await GET(req)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('token_verification_unavailable')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('includes Cache-Control: no-store and Referrer-Policy: no-referrer on all responses', async () => {
    const req = new NextRequest('http://localhost/api/public/booking-pass')
    const res = await GET(req)
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('returns 400 if token is tampered', async () => {
    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
    })

    const tampered = token.slice(0, -6) + 'XXXXXX'
    const req = new NextRequest(`http://localhost/api/public/booking-pass?token=${tampered}`)
    const res = await GET(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('tampered')
  })

  it('returns 400 if token is expired', async () => {
    const pastNow = 1700000000
    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
      ttlSeconds: 60,
      now: pastNow,
    })

    const req = new NextRequest(`http://localhost/api/public/booking-pass?token=${token}`)
    const res = await GET(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('expired')
  })

  it('returns 404 if reservation is not found in database', async () => {
    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
      ttlSeconds: 3600,
    })

    const mockDb = createMockDb(null)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    const req = new NextRequest(`http://localhost/api/public/booking-pass?token=${token}`)
    const res = await GET(req)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('not_found')
  })

  it('returns 200 with minimal booking pass data when requiresReauth is true', async () => {
    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
      ttlSeconds: 3600,
      requiresReauth: true,
    })

    const mockDb = createMockDb(
      {
        id: bookingId,
        workspace_id: workspaceId,
        customer_name: '홍길동',
        customer_phone: '010-1234-5678',
        service_name: '디자인 펌',
        status: 'CONFIRMED',
        deposit_krw: 30000,
        total_amount_krw: 80000,
        metadata: { startsAt: '2026-11-20 15:00' },
      },
      {
        business_name: '소희 헤어 살롱',
        address: '서울시 강남구 테헤란로 123',
      },
    )
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    const req = new NextRequest(`http://localhost/api/public/booking-pass?token=${token}`)
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.pass.bookingId).toBe(bookingId)
    expect(json.pass.shopName).toBe('소희 헤어 살롱')
    expect(json.pass.statusLabel).toBe('예약 확정')
    expect(json.pass.requiresReauth).toBe(true)
    expect(json.pass.serviceName).toBeUndefined()
    expect(json.pass.paymentSummary).toBeUndefined()
    expect(json.pass.customerNameMasked).toBeUndefined()
  })

  it('returns 200 with full booking pass data when token requiresReauth is false', async () => {
    const token = await issuePassToken({
      workspaceId,
      bookingId,
      secret,
      ttlSeconds: 3600,
      requiresReauth: false,
    })

    const mockDb = createMockDb(
      {
        id: bookingId,
        workspace_id: workspaceId,
        customer_name: '홍길동',
        customer_phone: '010-1234-5678',
        service_name: '디자인 펌',
        status: 'CONFIRMED',
        deposit_krw: 30000,
        total_amount_krw: 80000,
        metadata: { startsAt: '2026-11-20 15:00' },
      },
      {
        business_name: '소희 헤어 살롱',
        address: '서울시 강남구 테헤란로 123',
      },
    )
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    const req = new NextRequest(`http://localhost/api/public/booking-pass?token=${token}`)
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.pass.bookingId).toBe(bookingId)
    expect(json.pass.customerNameMasked).toBe('홍*동')
    expect(json.pass.customerPhoneMasked).toBe('010-****-5678')
    expect(json.pass.shopName).toBe('소희 헤어 살롱')
    expect(json.pass.statusLabel).toBe('예약 확정')
    expect(json.pass.serviceName).toBe('디자인 펌')
  })
})
