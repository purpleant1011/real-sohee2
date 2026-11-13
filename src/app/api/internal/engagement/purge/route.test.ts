import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    rpc: mocks.rpc,
  }),
}))

import { POST } from './route'

describe('internal engagement DM retention purge route', () => {
  const secret = 'valid-cron-secret-with-adequate-entropy'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = secret
  })

  it('rejects an unauthenticated request with 404', async () => {
    const req = new Request('https://example.com/api/internal/engagement/purge', {
      method: 'POST',
    })
    const response = await POST(req)
    expect(response.status).toBe(404)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects an invalid authorization header with 404', async () => {
    const req = new Request('https://example.com/api/internal/engagement/purge', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret-value-here' },
    })
    const response = await POST(req)
    expect(response.status).toBe(404)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('calls both DM and comment purge RPCs with p_retention_days = 30 and returns safe aggregate counts', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { threads: 5, messages: 12, drafts: 4, hasMore: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { comments: 8, drafts: 3, hasMore: false },
        error: null,
      })

    const req = new Request('https://example.com/api/internal/engagement/purge', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })
    const response = await POST(req)
    expect(response.status).toBe(200)

    const json = await response.json()
    expect(json).toEqual({
      ok: true,
      threads: 5,
      messages: 12,
      drafts: 4,
      hasMore: false,
      comments: 8,
      commentDrafts: 3,
      commentsHasMore: false,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('purge_expired_instagram_dm_data', {
      p_retention_days: 30,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('purge_expired_social_comment_data', {
      p_retention_days: 30,
    })
  })

  it('attempts comments RPC even if DM RPC returns a database error, and returns 503', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'P0001', message: 'Database connection failed' },
      })
      .mockResolvedValueOnce({
        data: { comments: 8, drafts: 3, hasMore: false },
        error: null,
      })

    const req = new Request('https://example.com/api/internal/engagement/purge', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })
    const response = await POST(req)
    expect(response.status).toBe(503)

    const json = await response.json()
    expect(json).toEqual({ error: 'purge_unavailable' })
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it('attempts comments RPC even if DM RPC throws an unexpected error, and returns 503', async () => {
    mocks.rpc
      .mockRejectedValueOnce(new Error('Unexpected network exception'))
      .mockResolvedValueOnce({
        data: { comments: 8, drafts: 3, hasMore: false },
        error: null,
      })

    const req = new Request('https://example.com/api/internal/engagement/purge', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })
    const response = await POST(req)
    expect(response.status).toBe(503)

    const json = await response.json()
    expect(json).toEqual({ error: 'purge_unavailable' })
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it('returns 503 when comments RPC fails after DM RPC succeeds', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { threads: 5, messages: 12, drafts: 4, hasMore: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: '42501', message: 'Permission denied' },
      })

    const req = new Request('https://example.com/api/internal/engagement/purge', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })
    const response = await POST(req)
    expect(response.status).toBe(503)

    const json = await response.json()
    expect(json).toEqual({ error: 'purge_unavailable' })
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
})
