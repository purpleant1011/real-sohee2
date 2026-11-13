import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const auth = vi.hoisted(() => ({ authorize: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: auth.authorize }))
import { createLearningRoute } from './server'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const sourceId = '22222222-2222-4222-8222-222222222222'
const url = `http://localhost:3195/api/workspaces/${workspaceId}/knowledge/channels`

describe('learning Next route adapter', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('preserves unauthenticated denial without constructing an admin repository', async () => {
    auth.authorize.mockResolvedValue(new Response('로그인이 필요해요.', { status: 401 }))
    const result = await createLearningRoute('list')(new Request(url), { params: Promise.resolve({ workspaceId }) })
    expect(result.status).toBe(401)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(await result.text()).toContain('로그인')
  })
  it('rejects viewer writes after server actor resolution', async () => {
    auth.authorize.mockResolvedValue({ workspaceId, userId: sourceId, role: 'viewer', admin: null })
    const result = await createLearningRoute('collect')(new Request(url, { method: 'POST',
      headers: { origin: 'http://localhost:3195', 'content-type': 'application/json' }, body: JSON.stringify({ revision: 1 }) }),
    { params: Promise.resolve({ workspaceId, sourceId }) })
    expect(result.status).toBe(403)
  })
  it('fails closed with a safe response when authenticated infrastructure is unavailable', async () => {
    auth.authorize.mockResolvedValue({ workspaceId, userId: sourceId, role: 'owner', admin: null })
    const result = await createLearningRoute('list')(new Request(url), { params: Promise.resolve({ workspaceId }) })
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain('service_role')
  })
})
