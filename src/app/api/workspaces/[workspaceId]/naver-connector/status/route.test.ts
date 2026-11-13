import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))

import { GET } from './route'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'

const get = () =>
  GET(new Request(`http://localhost/api/workspaces/${WORKSPACE}/naver-connector/status`), {
    params: Promise.resolve({ workspaceId: WORKSPACE }),
  })

describe('GET /api/workspaces/[workspaceId]/naver-connector/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthorized requests with auth response', async () => {
    mocks.authorize.mockResolvedValue(new Response(JSON.stringify({ error: '인증 실패' }), { status: 401 }))

    const res = await get()
    expect(res.status).toBe(401)
  })

  it('returns hasConnection: false when no browser connection exists', async () => {
    mocks.authorize.mockResolvedValue({
      workspaceId: WORKSPACE,
      admin: {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        })),
      },
    })

    const res = await get()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.hasConnection).toBe(false)
    expect(json.isOnline).toBe(false)
    expect(json.canAutoPublish).toBe(false)
  })

  it('reports fresh heartbeat without certifying live browser readiness', async () => {
    const recentDate = new Date(Date.now() - 30_000).toISOString() // 30s ago

    mocks.authorize.mockResolvedValue({
      workspaceId: WORKSPACE,
      admin: {
        from: vi.fn((table: string) => {
          if (table === 'browser_channel_connections') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'conn-1',
                  device_id: 'dev-1',
                  channel: 'naver_blog',
                  external_account_label: 'findk3 테스트 블로그',
                  status: 'verified',
                  last_seen_at: recentDate,
                },
              }),
            }
          }
          if (table === 'connector_devices') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'dev-1',
                  last_seen_at: recentDate,
                  status: 'active',
                },
              }),
            }
          }
          return { select: vi.fn().mockReturnThis() }
        }),
      },
    })

    const res = await get()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.hasConnection).toBe(true)
    expect(json.isOnline).toBe(true)
    expect(json.canAutoPublish).toBe(false)
    expect(json.readiness).toBe('unknown')
    expect(json.accountLabel).toBe('findk3 테스트 블로그')
  })

  it('returns isOnline: false and canAutoPublish: false when device last seen is stale (> 2m)', async () => {
    const staleDate = new Date(Date.now() - 300_000).toISOString() // 5m ago

    mocks.authorize.mockResolvedValue({
      workspaceId: WORKSPACE,
      admin: {
        from: vi.fn((table: string) => {
          if (table === 'browser_channel_connections') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'conn-1',
                  device_id: 'dev-1',
                  channel: 'naver_blog',
                  external_account_label: 'findk3 테스트 블로그',
                  status: 'verified',
                  last_seen_at: staleDate,
                },
              }),
            }
          }
          if (table === 'connector_devices') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'dev-1',
                  last_seen_at: staleDate,
                  status: 'active',
                },
              }),
            }
          }
          return { select: vi.fn().mockReturnThis() }
        }),
      },
    })

    const res = await get()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.hasConnection).toBe(true)
    expect(json.isOnline).toBe(false)
    expect(json.canAutoPublish).toBe(false)
  })

  function queryResult(data: unknown, error: unknown = null) {
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data, error }) }
  }

  it.each(['revoked', 'unavailable'])('does not call a %s device online from a fresh timestamp', async (status) => {
    const date = new Date().toISOString()
    const conn = queryResult({ id: 'c', device_id: 'd', status: 'verified', last_seen_at: date })
    const device = queryResult({ id: 'd', status, last_seen_at: date })
    mocks.authorize.mockResolvedValue({ admin: { from: (table: string) => table === 'connector_devices' ? device : conn } })
    const response = await get()
    expect(await response.json()).toMatchObject({ hasConnection: true, isOnline: false, canAutoPublish: false, readiness: 'unknown' })
    expect(device.eq).toHaveBeenCalledWith('workspace_id', WORKSPACE)
  })

  it('does not treat a future heartbeat as online', async () => {
    const date = new Date(Date.now() + 3600_000).toISOString()
    const conn = queryResult({ id: 'c', device_id: 'd', status: 'verified', last_seen_at: date })
    const device = queryResult({ id: 'd', status: 'active', last_seen_at: date })
    mocks.authorize.mockResolvedValue({ admin: { from: (table: string) => table === 'connector_devices' ? device : conn } })
    expect(await (await get()).json()).toMatchObject({ isOnline: false, canAutoPublish: false })
  })

  it.each(['browser_channel_connections', 'connector_devices'])('reports %s query failure instead of no connection', async (tableWithError) => {
    const conn = queryResult({ id: 'c', device_id: 'd', status: 'verified' }, tableWithError === 'browser_channel_connections' ? { message: 'private db detail' } : null)
    const device = queryResult(null, tableWithError === 'connector_devices' ? { message: 'private db detail' } : null)
    mocks.authorize.mockResolvedValue({ admin: { from: (table: string) => table === 'connector_devices' ? device : conn } })
    const response = await get()
    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: '커넥터 상태를 조회하지 못했습니다.' })
  })

})
