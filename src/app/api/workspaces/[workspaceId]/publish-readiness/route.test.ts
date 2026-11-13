import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { NextResponse } from 'next/server'

const mockAuth = vi.fn()
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: (...args: any[]) => mockAuth(...args),
  isResponse: (v: unknown) => v instanceof NextResponse,
}))

const mockGetPublishReadiness = vi.fn()
vi.mock('@/features/publish-readiness/service', () => ({
  getPublishReadiness: (...args: any[]) => mockGetPublishReadiness(...args),
}))

describe('GET /api/workspaces/[workspaceId]/publish-readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValueOnce(
      NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 })
    )

    const response = await GET(new Request('http://localhost/api/test'), {
      params: Promise.resolve({ workspaceId: 'ws-123' }),
    })

    expect(response.status).toBe(401)
  })

  it('returns 200 with no-store header when authorized', async () => {
    mockAuth.mockResolvedValueOnce({
      userId: 'user-1',
      workspaceId: 'ws-123',
      role: 'member',
      admin: {},
    })

    const mockData = {
      state: 'ready',
      channels: [],
      global_items: [],
    }
    mockGetPublishReadiness.mockResolvedValueOnce(mockData)

    const response = await GET(new Request('http://localhost/api/test'), {
      params: Promise.resolve({ workspaceId: 'ws-123' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const json = await response.json()
    expect(json).toEqual({ success: true, data: mockData })
  })
})
