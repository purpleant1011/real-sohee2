import { describe, expect, it, vi } from 'vitest'
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: vi.fn(), isResponse: (value: unknown) => value instanceof Response }))
vi.mock('@/features/vault/ui/release-panel/pg-dependencies', () => ({ createReleaseDependencies: vi.fn() }))
import { authorizeQuickRequest } from '@/features/quick-start/route-auth'
import { createReleaseDependencies } from '@/features/vault/ui/release-panel/pg-dependencies'
import { POST as preflight } from './preflight/route'
import { POST as request } from './request/route'

const params = { params: Promise.resolve({ workspaceId: 'shop' }) }
const auth = vi.mocked(authorizeQuickRequest)
const adapter = vi.mocked(createReleaseDependencies)
describe('release endpoints', () => {
  it('refuses unauthenticated and locked preflight, even with direct POST', async () => {
    auth.mockResolvedValueOnce(new Response(null, { status: 401 }) as never)
    expect((await preflight(new Request('http://localhost', { method: 'POST' }), params)).status).toBe(401)
    auth.mockResolvedValue({ workspaceId: 'shop', userId: 'owner', admin: {}, supabase: {} } as never)
    adapter.mockReturnValue({ listItems: async () => [{ id: 'a', channel: 'threads', releaseGate: 'HELD_USER', deletedAt: null }], readiness: async () => 'PREPARE_ONLY', readConnectionHealth: async () => null, runPreflight: async () => { throw Error('must be locked') }, markRequested: async () => false } as never)
    const response = await preflight(new Request('http://localhost', { method: 'POST' }), params)
    expect(response.status).toBe(423)
    expect((await response.json()).error).toContain('지금은 열 수 없어요')
  })
  it('rejects malformed release request before any mutation', async () => {
    auth.mockResolvedValue({ workspaceId: 'shop', userId: 'owner', admin: {}, supabase: {} } as never)
    const response = await request(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ itemIds: ['not-a-uuid'] }) }), params)
    expect(response.status).toBe(422)
  })
})
