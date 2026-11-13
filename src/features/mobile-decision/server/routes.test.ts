import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const boundary = vi.hoisted(() => ({ authorize: vi.fn(), deps: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: boundary.authorize, isResponse: (v: unknown) => v instanceof Response }))
vi.mock('./production', () => ({ createMobileReadDeps: boundary.deps }))
vi.mock('@/features/reporting/dataset', () => ({ readWorkspaceDataset: async () => ({ mode: 'ACTUAL', state: 'OBSERVED' }) }))
import { GET as home } from '@/app/api/workspaces/[workspaceId]/mobile-home/route'
import { GET as approval } from '@/app/api/workspaces/[workspaceId]/mobile-approvals/[itemKey]/route'
import { ready, unknown } from '../contracts'
const id = 'dm:00000000-0000-4000-8000-000000000001'
const context = () => ({ params: Promise.resolve({ workspaceId: 'a', itemKey: id }) })
const request = new Request('http://localhost/api/read')
beforeEach(() => {
  vi.resetAllMocks()
  boundary.authorize.mockResolvedValue({ workspaceId: 'a', userId: 'owner', admin: {} })
  boundary.deps.mockReturnValue({ now: () => '2026-10-16T01:00:00Z',
    readIdentity: async () => ({ businessName: null, timeZone: null }), readAgent: async () => unknown(),
    readDecisions: async () => ready({ items: [], total: 0, complete: true }, '2026-10-16T01:00:00Z'),
    readActivity: async () => unknown(), readResults: async () => unknown(), readApproval: async () => null })
})
afterEach(() => vi.useRealTimers())
describe('mobile read endpoints', () => {
  it('실제 홈 집계의 도메인 timeout은 정상 영역을 보존한 부분 응답으로 반환한다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const deps = boundary.deps()
    deps.readResults = () => new Promise<never>(() => {})
    boundary.deps.mockReturnValue(deps)
    let response: Response | undefined
    void home(request, context()).then(result => { response = result })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(response?.status).toBe(200)
    expect(await response?.json()).toMatchObject({
      workspaceId: 'a',
      decisions: { state: 'ready', data: { items: [], total: 0, complete: true } },
      results: { state: 'error', data: null },
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('인가 결과가 다른 가게를 가리키면 홈 조회를 시작하지 않는다', async () => {
    boundary.authorize.mockResolvedValue({ workspaceId: 'other', userId: 'owner', admin: {} })
    const response = await home(request, context())
    expect(response.status).toBe(404)
    expect(boundary.deps).not.toHaveBeenCalled()
  })

  it.each([401, 403])('does not bypass %s authorization', async status => {
    boundary.authorize.mockResolvedValue(new Response('{}', { status }))
    expect((await home(request, context())).status).toBe(status)
    expect((await approval(request, context())).status).toBe(status)
  })
  it('returns workspace-scoped direct DTO with no-store', async () => {
    const response = await home(request, context())
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ workspaceId: 'a', decisions: { state: 'ready', data: { total: 0 } } })
  })
  it('uses nonrevealing not-found for invalid or other workspace items', async () => {
    expect((await approval(request, { params: Promise.resolve({ workspaceId: 'a', itemKey: 'recall:person' }) })).status).toBe(404)
    expect((await approval(request, context())).status).toBe(404)
  })
})
