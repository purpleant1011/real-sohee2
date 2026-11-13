import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { NextResponse } from 'next/server'
import { verifyRequestToken } from '@/features/booking-request/request-token'

const mockAuth = vi.fn()
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: (...args: any[]) => mockAuth(...args),
  isResponse: (v: unknown) => v instanceof Response || v instanceof NextResponse,
}))

describe('GET /api/workspaces/[workspaceId]/booking-request/link', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
  })

  it('checks manager authorization', async () => {
    mockAuth.mockResolvedValueOnce(
      NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
    )

    const req = new Request('https://example.com/api/workspaces/ws-1/booking-request/link')
    const res = await GET(req, {
      params: Promise.resolve({ workspaceId: 'ws-1' }),
    })

    expect(res.status).toBe(403)
    expect(mockAuth).toHaveBeenCalledWith('ws-1', { requireRole: 'manager' })
  })

  it('returns 503 if PASS_TOKEN_SECRET is not configured', async () => {
    delete process.env.PASS_TOKEN_SECRET
    mockAuth.mockResolvedValueOnce({
      userId: 'user-1',
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/booking-request/link')
    const res = await GET(req, {
      params: Promise.resolve({ workspaceId: 'ws-1' }),
    })

    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('예약 신청 링크를 만들 수 없어요(설정 필요)')
  })

  it('returns 503 if PASS_TOKEN_SECRET is blank', async () => {
    process.env.PASS_TOKEN_SECRET = '   '
    mockAuth.mockResolvedValueOnce({
      userId: 'user-1',
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const req = new Request('https://example.com/api/workspaces/ws-1/booking-request/link')
    const res = await GET(req, {
      params: Promise.resolve({ workspaceId: 'ws-1' }),
    })

    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('예약 신청 링크를 만들 수 없어요(설정 필요)')
  })

  it('returns 200 with valid booking request link when PASS_TOKEN_SECRET is configured', async () => {
    process.env.PASS_TOKEN_SECRET = 'secret-key-12345'
    mockAuth.mockResolvedValueOnce({
      userId: 'user-1',
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const req = new Request('https://test.example.com/api/workspaces/ws-1/booking-request/link', {
      headers: {
        host: 'test.example.com',
        'x-forwarded-proto': 'https',
      },
    })
    const res = await GET(req, {
      params: Promise.resolve({ workspaceId: 'ws-1' }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.url).toMatch(/^https:\/\/test\.sohee\.ai\.kr\/booking-request\?token=/)

    const urlObj = new URL(json.url)
    const token = urlObj.searchParams.get('token')
    expect(token).toBeTruthy()

    const verified = await verifyRequestToken(token!, { secret: 'secret-key-12345' })
    expect(verified.ok).toBe(true)
    if (verified.ok) expect(verified.payload.workspaceId).toBe('ws-1')
  })

  it('falls back to APP_URL if headers do not specify origin', async () => {
    process.env.PASS_TOKEN_SECRET = 'secret-key-12345'
    process.env.APP_URL = 'https://app.real-sohee.com'
    mockAuth.mockResolvedValueOnce({
      userId: 'user-1',
      workspaceId: 'ws-1',
      role: 'manager',
    })

    const req = new Request('http://localhost/api/workspaces/ws-1/booking-request/link')
    const res = await GET(req, {
      params: Promise.resolve({ workspaceId: 'ws-1' }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.url.startsWith('https://app.real-sohee.com/booking-request?token=')).toBe(true)
  })
})
