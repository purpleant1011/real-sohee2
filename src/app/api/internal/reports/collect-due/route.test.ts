import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), collect: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/features/reports/actions/collect-social-performance-core', () => ({ executeSocialPerformanceCollection: mocks.collect }))
vi.mock('@/features/channels/credential-repository', () => ({ loadChannelCredential: vi.fn() }))
vi.mock('@/features/reports/meta-insights-provider', () => ({ collectMetaPostInsights: vi.fn() }))
vi.mock('@/features/reports/social-metric-repository', () => ({ loadPublishedMetricContext: vi.fn(), saveMetricCollection: vi.fn() }))

import { POST } from './route'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const publishAttemptId = '20000000-0000-4000-8000-000000000001'

describe('four-hour social report collector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret-with-enough-entropy'
    mocks.rpc.mockResolvedValue({ data: [{
      workspace_id: workspaceId,
      publish_attempt_id: publishAttemptId,
      published_at: '2026-08-14T00:00:00.000Z',
    }], error: null })
    mocks.collect.mockResolvedValue({ data: { collectionId: '30000000-0000-4000-8000-000000000001', status: 'succeeded' } })
  })

  it('collects only database-selected due posts through the existing metric service', async () => {
    const response = await POST(new Request('https://example.com/api/internal/reports/collect-due', {
      method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ claimed: 1, completed: 1, unavailable: 0, failed: 0 })
    expect(mocks.rpc).toHaveBeenCalledWith('list_due_social_metric_contexts', expect.objectContaining({ p_limit: 10 }))
    expect(mocks.collect).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId, publishAttemptId, periodStart: '2026-08-14T00:00:00.000Z',
    }), expect.any(Object))
  })

  it('returns not found without revealing cron configuration', async () => {
    const response = await POST(new Request('https://example.com/api/internal/reports/collect-due', { method: 'POST' }))
    expect(response.status).toBe(404)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.collect).not.toHaveBeenCalled()
  })
})
