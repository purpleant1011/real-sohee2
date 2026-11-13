import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.auth, isResponse: (v: unknown) => v instanceof Response }))
vi.mock('@/features/quick-start/quick-post-query', () => ({ getQuickPost: mocks.get }))
import { QuickPostError } from '@/features/quick-start/quick-post-service'
import { GET } from './route'
const ctx = { params: Promise.resolve({ workspaceId: 'requested', id: 'post' }) }
const req = new Request('http://localhost/api/quick-post/post')
beforeEach(() => { mocks.auth.mockReset(); mocks.get.mockReset(); mocks.auth.mockResolvedValue({ workspaceId: 'authorized', admin: {} }) })
describe('GET quick-post detail', () => {
  it('returns 404 only for an absent post', async () => {
    mocks.get.mockResolvedValue(null)
    expect((await GET(req, ctx)).status).toBe(404)
  })
  it('returns a retryable error for database failure without leaking internals', async () => {
    mocks.get.mockRejectedValue(new Error('private internal message'))
    const response = await GET(req, ctx)
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('private internal message')
  })
  it('preserves validation errors and private cache policy', async () => {
    mocks.get.mockRejectedValueOnce(new QuickPostError('입력 확인', 'INVALID_INPUT', 422))
    expect((await GET(req, ctx)).status).toBe(422)
    mocks.get.mockResolvedValueOnce({ missionId: 'post' })
    const response = await GET(req, ctx)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.get.mock.calls.at(-1)?.slice(1)).toEqual(['authorized', 'post'])
  })
  it('never queries when authorization fails', async () => {
    mocks.auth.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await GET(req, ctx)).status).toBe(403)
    expect(mocks.get).not.toHaveBeenCalled()
  })
})
