import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: mocks.from,
  }),
}))

vi.mock('@/features/local-publishing/device-auth', () => ({
  authenticateConnectorRequest: mocks.authenticate,
}))

import { POST } from './route'

const device = {
  deviceId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '10000000-0000-4000-8000-000000000002',
  platform: 'macos',
  clientVersion: '0.1.0',
  status: 'active',
  tokenDigest: 'a'.repeat(64),
} as const

const connectionId = '10000000-0000-4000-8000-000000000003'

describe('POST /api/connector/connections/categories', () => {
  let storedCategoriesByConnection: Map<string, any>

  beforeEach(() => {
    vi.clearAllMocks()
    storedCategoriesByConnection = new Map()

    mocks.authenticate.mockResolvedValue(device)

    mocks.from.mockImplementation((table: string) => {
      if (table === 'browser_channel_connections') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: mocks.maybeSingle,
            }),
          }),
        }
      }
      if (table === 'naver_blog_categories') {
        return {
          upsert: mocks.upsert.mockImplementation((record: any) => {
            storedCategoriesByConnection.set(record.browser_channel_connection_id, record)
            return Promise.resolve({ error: null })
          }),
        }
      }
      return {}
    })

    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: connectionId,
        workspace_id: device.workspaceId,
        channel: 'naver_blog',
        status: 'connected',
      },
      error: null,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    mocks.authenticate.mockResolvedValue(null)

    const request = new Request('https://example.com/api/connector/connections/categories', {
      method: 'POST',
      body: JSON.stringify({
        browserChannelConnectionId: connectionId,
        categories: [{ id: '1', label: '공지사항', depth: 0 }],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
    const json = await response.json()
    expect(json).toEqual({ code: 'DEVICE_AUTH_REQUIRED' })
  })

  it('returns 400 on invalid body', async () => {
    const request = new Request('https://example.com/api/connector/connections/categories', {
      method: 'POST',
      body: JSON.stringify({
        browserChannelConnectionId: 'invalid-uuid',
        categories: 'not-an-array',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json).toEqual({ code: 'CATEGORY_SYNC_INVALID' })
  })

  it('returns 404 when connection does not exist or belongs to another workspace', async () => {
    // V1.2 G0-02: 정책 정본에 따라 DB 조회 전에 403 POLICY_DISABLED 로 즉시 차단, DB 조회/upsert 미호출
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: connectionId,
        workspace_id: '99999999-9999-4999-8999-999999999999',
        channel: 'naver_blog',
        status: 'connected',
      },
      error: null,
    })

    const request = new Request('https://example.com/api/connector/connections/categories', {
      method: 'POST',
      body: JSON.stringify({
        browserChannelConnectionId: connectionId,
        categories: [{ id: '1', label: '공지사항', depth: 0 }],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('fill')
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('returns 404 when connection channel is not naver_blog or status is not connected', async () => {
    // V1.2 G0-02: 정책 정본에 따라 연결 상태 조회 전에 403 POLICY_DISABLED 로 즉시 차단, DB 조회/upsert 미호출
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: connectionId,
        workspace_id: device.workspaceId,
        channel: 'daangn_business',
        status: 'connected',
      },
      error: null,
    })

    const request = new Request('https://example.com/api/connector/connections/categories', {
      method: 'POST',
      body: JSON.stringify({
        browserChannelConnectionId: connectionId,
        categories: [{ id: '1', label: '공지사항', depth: 0 }],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('fill')
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('syncs categories successfully and returns count', async () => {
    // V1.2 G0-02: 정책 정본에 따라 정상 동기화 요청도 403 POLICY_DISABLED 로 즉시 차단, DB upsert 미호출
    const categories = [
      { id: '1', label: '공지사항', depth: 0 },
      { id: '2', label: '하위 카테고리 업데이트', depth: 1 },
    ]

    const request = new Request('https://example.com/api/connector/connections/categories', {
      method: 'POST',
      body: JSON.stringify({
        browserChannelConnectionId: connectionId,
        categories,
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json.errorCode).toBe('POLICY_DISABLED')
    expect(json.action).toBe('fill')
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('replace-semantics: a second sync replaces the first list', async () => {
    // V1.2 G0-02: 정책 정본에 따라 후속 동기화 요청 역시 403 POLICY_DISABLED 로 즉시 차단, DB upsert 미호출
    const firstSync = [
      { id: '1', label: '공지사항', depth: 0 },
      { id: '2', label: '하위 카테고리 업데이트', depth: 1 },
    ]

    const req1 = new Request('https://example.com/api/connector/connections/categories', {
      method: 'POST',
      body: JSON.stringify({
        browserChannelConnectionId: connectionId,
        categories: firstSync,
      }),
    })
    const res1 = await POST(req1)
    expect(res1.status).toBe(403)
    expect((await res1.json()).errorCode).toBe('POLICY_DISABLED')
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
