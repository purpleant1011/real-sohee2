import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), list: vi.fn(), create: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.authorize, isResponse: (v: unknown) => v instanceof Response }))
vi.mock('@/features/quick-start/quick-post-query', async importOriginal => ({ ...await importOriginal<typeof import('@/features/quick-start/quick-post-query')>(), listQuickPostsPage: mocks.list }))
vi.mock('@/features/quick-start/quick-post-service', async importOriginal => ({ ...await importOriginal<typeof import('@/features/quick-start/quick-post-service')>(), createQuickDraft: mocks.create }))
vi.mock('@/features/readiness/load', () => ({ loadReadiness: async () => ({}) }))
vi.mock('@/features/readiness', () => ({ evaluateGate: () => ({ allowed: true }) }))
vi.mock('@/features/quick-start/funnel-events', () => ({ recordFunnelEvent: async () => undefined }))
import { GET, POST } from './route'
const ctx = { params: Promise.resolve({ workspaceId: 'requested' }) }
beforeEach(() => {
  mocks.authorize.mockReset()
  mocks.list.mockReset()
  mocks.create.mockReset()
  const credit: any = { select: () => credit, eq: () => credit, maybeSingle: async () => ({ data: { total_available_credits: 100 } }) }
  mocks.authorize.mockResolvedValue({ workspaceId: 'authorized', admin: { from: () => credit } })
  mocks.list.mockResolvedValue({ items: [], nextCursor: null, prevCursor: 'previous', hasNextPage: false, hasAnySupportedContent: true })
})
describe('POST original-photo quick draft', () => {
  const requestId = '40000000-0000-4000-8000-000000000001'
  const sourceId = '60000000-0000-4000-8000-000000000001'
  it('passes a selected persisted original and stable request id through the existing authorized draft pipeline', async () => {
    mocks.authorize.mockResolvedValueOnce({ workspaceId: 'authorized', userId: 'owner', admin: {}, supabase: {} })
    mocks.create.mockResolvedValueOnce({ missionId: requestId, imageIds: [sourceId] })
    const response = await POST(new Request('http://localhost/api/quick-post', { method: 'POST', body: JSON.stringify({ topic: '이번 주 소식', requestId, sourceAssetIds: [sourceId], maxDraftCredits: 100 }) }), ctx)
    expect(response.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'authorized', userId: 'owner', missionId: requestId, sourceAssetIds: [sourceId] }))
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('refuses a changed cost above the owner limit before generating a draft', async () => {
    mocks.authorize.mockResolvedValueOnce({ workspaceId: 'authorized', userId: 'owner', admin: {}, supabase: {} })
    const response = await POST(new Request('http://localhost/api/quick-post', { method: 'POST', body: JSON.stringify({ topic: '이번 주 소식', requestId, sourceAssetIds: [sourceId], maxDraftCredits: 99 }) }), ctx)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'DRAFT_COST_CHANGED', requiredCredits: 100 })
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('quotes the original-photo text cost separately from new AI-image generation', async () => {
    const response = await GET(new Request('http://localhost/api/quick-post?limit=1'), ctx)
    expect(await response.json()).toMatchObject({ credits: { photoDraftCost: 100 } })
  })
})

describe('GET quick-post page', () => {
  it('uses authorized workspace and legacy all/40 defaults, preserving credit and previous cursor fields', async () => {
    const res = await GET(new Request('http://localhost/api/quick-post'), ctx)
    expect(res.status).toBe(200)
    expect(mocks.list.mock.calls[0][1]).toBe('authorized')
    expect(mocks.list.mock.calls[0][2]).toMatchObject({ status: 'all', channel: 'all', limit: 40 })
    expect(await res.json()).toMatchObject({ prevCursor: 'previous', hasAnySupportedContent: true, credits: { available: 100 } })
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
  it('keeps ContentHub explicit waiting requests at 20 items', async () => {
    const res = await GET(new Request('http://localhost/api/quick-post?status=waiting'), ctx)
    expect(res.status).toBe(200)
    expect(mocks.list.mock.calls[0][2]).toMatchObject({ status: 'waiting', limit: 20 })
  })
  it.each(['limit=Infinity', 'limit=1.5', 'cursor=broken', 'status=bad', 'channel=naver_blog'])('rejects invalid parameters: %s', async query => {
    const res = await GET(new Request(`http://localhost/api/quick-post?${query}`), ctx)
    expect(res.status).toBe(422)
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('never queries after authorization rejects the workspace', async () => {
    mocks.authorize.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await GET(new Request('http://localhost/api/quick-post'), ctx)).status).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
