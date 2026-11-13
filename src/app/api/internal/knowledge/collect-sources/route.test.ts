import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), collect: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/features/knowledge/url-collection-service', () => ({
  createAdminUrlSourceCollectionGateway: vi.fn(() => ({})),
}))
vi.mock('@/features/knowledge/url-collection-runner', () => ({ collectKnowledgeSource: mocks.collect }))

import { POST } from './route'

describe('knowledge source collector endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret-with-enough-entropy'
    mocks.rpc.mockResolvedValue({ data: [{
      workspace_id: '10000000-0000-4000-8000-000000000001',
      source_id: '20000000-0000-4000-8000-000000000001',
    }], error: null })
    mocks.collect.mockResolvedValue({ data: { collectionState: 'partial' } })
  })

  it('requires internal authorization and exposes counts rather than source bodies', async () => {
    const response = await POST(new Request('https://example.com/api/internal/knowledge/collect-sources', {
      method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ claimed: 1, complete: 0, partial: 1, blocked: 0, refreshRequired: 0 })
    expect(mocks.collect).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: '20000000-0000-4000-8000-000000000001' }),
      expect.any(Object),
      {},
    )
  })

  it('returns not found without revealing the collector secret state', async () => {
    const response = await POST(new Request('https://example.com/api/internal/knowledge/collect-sources', { method: 'POST' }))
    expect(response.status).toBe(404)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
