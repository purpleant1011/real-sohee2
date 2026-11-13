import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mockReconcile = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn().mockReturnValue({}),
}))
vi.mock('@/features/channel-studio/naver/reconcile-naver-post-jobs', () => ({
  reconcileNaverPostJobs: (...args: unknown[]) => mockReconcile(...args),
}))

import { POST } from './route'

describe('POST /api/internal/naver/reconcile-jobs', () => {
  const secret = 'valid-test-cron-secret-with-entropy-12345'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = secret
  })

  it('returns 401 without authorization header', async () => {
    const request = new Request('https://example.com/api/internal/naver/reconcile-jobs', {
      method: 'POST',
    })
    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(mockReconcile).not.toHaveBeenCalled()
  })

  it('returns 401 with invalid secret', async () => {
    const request = new Request('https://example.com/api/internal/naver/reconcile-jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-secret-that-does-not-match',
      },
    })
    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(mockReconcile).not.toHaveBeenCalled()
  })

  it('returns 401 when CRON_SECRET is too short (< 20 chars)', async () => {
    process.env.CRON_SECRET = 'short-secret'
    const request = new Request('https://example.com/api/internal/naver/reconcile-jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer short-secret',
      },
    })
    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(mockReconcile).not.toHaveBeenCalled()
  })

  it('executes reconcileNaverPostJobs and returns summary with 200 on valid bearer secret', async () => {
    const expectedSummary = {
      examined: 2,
      markedFailed: 1,
      completedFromSavedVersion: 1,
      released: 2,
      flagged: 0,
      errors: 0,
    }
    mockReconcile.mockResolvedValue(expectedSummary)

    const request = new Request('https://example.com/api/internal/naver/reconcile-jobs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
      },
    })
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expectedSummary)
    expect(mockReconcile).toHaveBeenCalledOnce()
  })

  it('returns 500 when reconciler throws an unexpected error', async () => {
    mockReconcile.mockRejectedValue(new Error('Fatal DB partition'))

    const request = new Request('https://example.com/api/internal/naver/reconcile-jobs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
      },
    })
    const response = await POST(request)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'reconciliation_failed' })
  })
})
