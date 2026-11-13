import { describe, expect, it, vi } from 'vitest'
import { marketingStrategyFixture as brief } from '@/features/content/blog-strategy-brief.fixture'
import { createBlogStrategyHandlers } from './route'

const params = { workspaceId: brief.workspaceId, threadId: brief.lineage.conversationId }
const context = { params: Promise.resolve(params) }
function setup(options: { user?: string | null; allowed?: boolean; error?: string } = {}) {
  const operate = vi.fn(async () => {
    if (options.error) throw new Error(options.error)
    return { id: brief.id, status: 'proposed' }
  })
  const handlers = createBlogStrategyHandlers({
    authenticate: async () => options.user === undefined ? brief.id : options.user,
    authorize: async () => options.allowed !== false, operate,
  })
  return { ...handlers, operate }
}
const request = (body: unknown) => new Request('http://localhost/blog-strategy', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
})
describe('conversation blog decision API', () => {
  it.each([
    ['anonymous', { user: null }, 401], ['foreign thread', { allowed: false }, 403],
  ] as const)('rejects %s before reading strategy data', async (_name, options, status) => {
    const route = setup(options)
    expect((await route.POST(request({ action: 'open' }), context)).status).toBe(status)
    expect(route.operate).not.toHaveBeenCalled()
  })
  it('rejects client-authored topics, lineage and implicit approval', async () => {
    const route = setup()
    for (const body of [{ action: 'open', missionId: brief.lineage.missionId },
      { action: 'approve', proposalId: brief.id, expectedRevision: 1, outcome: 'valid_inquiry' },
      { action: 'select', proposalId: brief.id, expectedRevision: 1, selectedIndex: 7 }]) {
      expect((await route.POST(request(body), context)).status).toBe(400)
    }
    expect(route.operate).not.toHaveBeenCalled()
  })
  it('passes only authenticated scope and validated decision, without reserving or generating', async () => {
    const route = setup()
    const response = await route.POST(request({ action: 'open' }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { id: brief.id, status: 'proposed' } })
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(route.operate).toHaveBeenCalledWith({ ...params, userId: brief.id, decision: { action: 'open' } })
  })
  it('exposes only a configured credit amount, not an invented estimate', async () => {
    const route = createBlogStrategyHandlers({ authenticate: async () => brief.id, authorize: async () => true,
      operate: async () => null, generationCredits: () => 30 })
    const response = await route.GET(new Request('http://localhost/blog-strategy'), context)
    expect(await response.json()).toEqual({ data: null, generationCredits: 30 })
  })
  it('restores without opening a new decision on GET', async () => {
    const route = setup()
    expect((await route.GET(new Request('http://localhost/blog-strategy'), context)).status).toBe(200)
    expect(route.operate).toHaveBeenCalledWith({ ...params, userId: brief.id, decision: { action: 'read' } })
  })
  it.each([
    ['MARKETING_STRATEGY_STALE', 409], ['MARKETING_STRATEGY_FORBIDDEN', 403],
    ['approved_knowledge_facts_unavailable', 503], ['database secret detail', 503],
  ])('returns bounded errors for %s', async (error, status) => {
    const route = setup({ error })
    const response = await route.POST(request({ action: 'open' }), context)
    expect(response.status).toBe(status)
    expect(JSON.stringify(await response.json())).not.toContain('database secret detail')
  })
})
