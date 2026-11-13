import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { issuePassToken } from '@/features/kakao/booking-pass/pass-token'
import { clearRateLimits } from '@/features/kakao/booking-pass/pass-rate-limit'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { POST } from './route'

describe('POST /api/public/booking-pass/verify', () => {
  const secret = 'test-pass-secret-token-verify-key'
  const workspaceId = 'ws_salon_verify_01'
  const bookingId = 'bk_verify_001'

  beforeEach(() => {
    vi.resetAllMocks()
    clearRateLimits()
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

  it('returns 400 if token or last4 is missing or format is invalid', async () => {
    const emptyBodyReq = new NextRequest('http://localhost/api/public/booking-pass/verify', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res1 = await POST(emptyBodyReq)
    expect(res1.status).toBe(400)
    const json1 = await res1.json()
    expect(json1.ok).toBe(false)
    expect(json1.reason).toBe('invalid_input')

    const invalidLast4Req = new NextRequest('http://localhost/api/public/booking-pass/verify', {
      method: 'POST',
      body: JSON.stringify({ token: 'abc.def', last4: '12' }),
    })
    const res2 = await POST(invalidLast4Req)
    expect(res2.status).toBe(400)
    const json2 = await res2.json()
    expect(json2.reason).toBe('invalid_format')
  })

  it('returns 503 if PASS_TOKEN_SECRET is not configured (never falls back to KAKAO_STATE_SECRET)', async () => {
    delete process.env.PASS_TOKEN_SECRET
    process.env.KAKAO_STATE_SECRET = 'invalid-fallback-secret'

    const req = new NextRequest('http://localhost/api/public/booking-pass/verify', {
      method: 'POST',
      body: JSON.stringify({ token: 'sample.token', last4: '1234' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('token_verification_unavailable')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('returns 401 if token is invalid or tampered', async () => {
    const validToken = await issuePassToken({ workspaceId, bookingId, secret })
    const tampered = validToken.slice(0, -6) + 'XXXXXX'

    const req = new NextRequest('http://localhost/api/public/booking-pass/verify', {
      method: 'POST',
      body: JSON.stringify({ token: tampered, last4: '1234' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('tampered')
  })

  it('returns 404 if reservation is not found', async () => {
    const token = await issuePassToken({ workspaceId, bookingId, secret })
    const mockDb = createMockDb(null)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    const req = new NextRequest('http://localhost/api/public/booking-pass/verify', {
      method: 'POST',
      body: JSON.stringify({ token, last4: '5678' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.reason).toBe('not_found')
  })

  it('returns 401 with uniform fixed error message when last4 does not match', async () => {
    const token = await issuePassToken({ workspaceId, bookingId, secret })
    const mockDb = createMockDb({
      id: bookingId,
      workspace_id: workspaceId,
      customer_name: '홍길동',
      customer_phone: '010-1234-5678',
      service_name: '스페셜 케어',
      status: 'CONFIRMED',
      deposit_krw: 0,
      total_amount_krw: 50000,
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    const req = new NextRequest('http://localhost/api/public/booking-pass/verify', {
      method: 'POST',
      body: JSON.stringify({ token, last4: '9999' }), // wrong last4
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toBe('전화번호 뒤 4자리가 일치하지 않습니다.')
    expect(json.reason).toBe('auth_failed')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('returns 200 and unlocks full booking pass when last4 matches correctly', async () => {
    const token = await issuePassToken({ workspaceId, bookingId, secret, requiresReauth: true })
    const mockDb = createMockDb(
      {
        id: bookingId,
        workspace_id: workspaceId,
        customer_name: '홍길동',
        customer_phone: '010-1234-5678',
        service_name: '프리미엄 헤어컷 & 스파',
        status: 'CONFIRMED',
        deposit_krw: 20000,
        total_amount_krw: 70000,
        payment_status: 'PAID',
        metadata: {
          startsAt: '2026-11-20 15:00',
          bookingNumber: 'BK-5678',
        },
      },
      {
        business_name: '살롱 드 소희',
        address: '서울시 강남구 압구정로 10',
      },
    )
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    const req = new NextRequest('http://localhost/api/public/booking-pass/verify', {
      method: 'POST',
      body: JSON.stringify({ token, last4: '5678' }), // matches 010-1234-5678
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.pass.requiresReauth).toBe(false)
    expect(json.pass.serviceName).toBe('프리미엄 헤어컷 & 스파')
    expect(json.pass.paymentSummary).toContain('20,000원 결제 완료')
    expect(json.pass.customerNameMasked).toBe('홍*동')
    expect(json.pass.customerPhoneMasked).toBe('010-****-5678')
    expect(json.pass.address).toBe('서울시 강남구 압구정로 10')
  })

  it('blocks brute-force attempts with 429 when 5 failed attempts occur for the same token', async () => {
    const token = await issuePassToken({ workspaceId, bookingId, secret })
    const mockDb = createMockDb({
      id: bookingId,
      workspace_id: workspaceId,
      customer_name: '홍길동',
      customer_phone: '010-1234-5678',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    // 5 failed attempts with incorrect last4 (each returns 401)
    for (let i = 0; i < 5; i++) {
      const req = new NextRequest('http://localhost/api/public/booking-pass/verify', {
        method: 'POST',
        body: JSON.stringify({ token, last4: `000${i}` }),
      })
      const res = await POST(req)
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.reason).toBe('auth_failed')
    }

    // 6th attempt: should be blocked with 429 rate_limited even if correct last4 is sent
    const blockedReq = new NextRequest('http://localhost/api/public/booking-pass/verify', {
      method: 'POST',
      body: JSON.stringify({ token, last4: '5678' }),
    })
    const resBlocked = await POST(blockedReq)
    expect(resBlocked.status).toBe(429)
    const jsonBlocked = await resBlocked.json()
    expect(jsonBlocked.ok).toBe(false)
    expect(jsonBlocked.reason).toBe('rate_limited')
    expect(jsonBlocked.error).toBe('인증 시도 횟수를 초과했습니다. 15분 후 다시 시도해 주세요.')
    expect(resBlocked.headers.get('cache-control')).toBe('no-store')
    expect(resBlocked.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('blocks brute-force attempts with 429 based on client IP across different tokens', async () => {
    const clientIp = '198.51.100.55'
    const mockDb = createMockDb({
      id: bookingId,
      workspace_id: workspaceId,
      customer_name: '홍길동',
      customer_phone: '010-1234-5678',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    // 5 failed attempts from the same IP with different tokens
    for (let i = 0; i < 5; i++) {
      const token = await issuePassToken({ workspaceId, bookingId: `bk_${i}`, secret })
      const req = new NextRequest('http://localhost/api/public/booking-pass/verify', {
        method: 'POST',
        headers: { 'cf-connecting-ip': clientIp },
        body: JSON.stringify({ token, last4: '9999' }),
      })
      const res = await POST(req)
      expect(res.status).toBe(401)
    }

    // 6th attempt from same IP with a new token: blocked by IP rate limit
    const newToken = await issuePassToken({ workspaceId, bookingId: 'bk_new', secret })
    const blockedReq = new NextRequest('http://localhost/api/public/booking-pass/verify', {
      method: 'POST',
      headers: { 'cf-connecting-ip': clientIp },
      body: JSON.stringify({ token: newToken, last4: '5678' }),
    })
    const resBlocked = await POST(blockedReq)
    expect(resBlocked.status).toBe(429)
    const jsonBlocked = await resBlocked.json()
    expect(jsonBlocked.reason).toBe('rate_limited')
  })

  it('resets rate limit counter upon successful verification', async () => {
    const token = await issuePassToken({ workspaceId, bookingId, secret })
    const mockDb = createMockDb({
      id: bookingId,
      workspace_id: workspaceId,
      customer_name: '홍길동',
      customer_phone: '010-1234-5678',
      service_name: '헤어컷',
      status: 'CONFIRMED',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockDb as any)

    // 4 failed attempts (not blocked yet)
    for (let i = 0; i < 4; i++) {
      const req = new NextRequest('http://localhost/api/public/booking-pass/verify', {
        method: 'POST',
        body: JSON.stringify({ token, last4: '0000' }),
      })
      const res = await POST(req)
      expect(res.status).toBe(401)
    }

    // 5th attempt succeeds with correct last4
    const successReq = new NextRequest('http://localhost/api/public/booking-pass/verify', {
      method: 'POST',
      body: JSON.stringify({ token, last4: '5678' }),
    })
    const successRes = await POST(successReq)
    expect(successRes.status).toBe(200)

    // Now user should be able to attempt again without immediate 429
    const reqAfterReset = new NextRequest('http://localhost/api/public/booking-pass/verify', {
      method: 'POST',
      body: JSON.stringify({ token, last4: '0000' }),
    })
    const resAfterReset = await POST(reqAfterReset)
    expect(resAfterReset.status).toBe(401) // 401 instead of 429 because counter was reset
  })
})
