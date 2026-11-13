import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), retry: vi.fn() }))
vi.mock('@/features/publishing/actions/live-publish', () => ({ executeLivePublishRetry: mocks.retry }))
vi.mock('@/features/publishing/instagram-retry-preparation', () => ({
  prepareInstagramProviderRejectedRetry: mocks.prepare,
}))

import { POST } from './route'

const input = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  actorUserId: '20000000-0000-4000-8000-000000000001',
  failedAttemptId: '30000000-0000-4000-8000-000000000001',
}
const retrySecret = 'one-shot-retry-secret-with-enough-entropy'

describe('internal one-shot publishing retry endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.INTERNAL_PUBLISH_RETRY_SECRET
    delete process.env.CRON_SECRET
    process.env.INTERNAL_PUBLISH_RETRY_SECRET_SHA256 = createHash('sha256').update(retrySecret).digest('hex')
    mocks.prepare.mockResolvedValue({ ok: true })
    mocks.retry.mockResolvedValue({ data: {
      attemptId: '40000000-0000-4000-8000-000000000001',
      status: 'published',
      providerPostId: 'ig-post-1',
      errorCode: null,
    } })
  })

  it('rejects public callers without exposing the protected retry surface', async () => {
    const response = await POST(new Request('https://example.com/api/internal/publishing/retry', {
      method: 'POST',
      body: JSON.stringify(input),
    }))
    expect(response.status).toBe(404)
    expect(mocks.retry).not.toHaveBeenCalled()
  })

  it('invokes the exact idempotent live retry service once for an authenticated request', async () => {
    const response = await POST(new Request('https://example.com/api/internal/publishing/retry', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${retrySecret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      attemptId: '40000000-0000-4000-8000-000000000001',
      status: 'published',
      providerPostId: 'ig-post-1',
      errorCode: null,
    })
    expect(mocks.retry).toHaveBeenCalledOnce()
    expect(mocks.retry).toHaveBeenCalledWith(input)
    expect(mocks.prepare).toHaveBeenCalledOnce()
    expect(mocks.prepare).toHaveBeenCalledWith({
      workspaceId: input.workspaceId,
      failedAttemptId: input.failedAttemptId,
    })
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.retry.mock.invocationCallOrder[0]!)
  })
})
