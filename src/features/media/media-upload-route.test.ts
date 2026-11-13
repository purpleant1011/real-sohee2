import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), begin: vi.fn(), complete: vi.fn(), select: vi.fn(async () => ['33333333-3333-4333-8333-333333333333']) }))
vi.mock('./first-value-source', () => ({ resolveFirstValueSourceIds: mocks.select, firstValueSourceCookieName: (workspaceId: string) => `sohee-first-value-photo-${workspaceId}` }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.auth, isResponse: (v: unknown) => v instanceof Response }))
vi.mock('./media-upload', async importOriginal => ({ ...await importOriginal<typeof import('./media-upload')>(), beginMediaUpload: mocks.begin, completeMediaUpload: mocks.complete }))
import { GET, POST } from '@/app/api/onboarding/media/route'

describe('media upload API authorization', () => {
  it('does not call storage for an unauthenticated request', async () => {
    mocks.auth.mockResolvedValue(new Response(null, { status: 401 }))
    expect((await POST(new Request('https://local.invalid', { method: 'POST', body: '{}' }))).status).toBe(401)
    expect(mocks.begin).not.toHaveBeenCalled()
  })
  it('uses the authorized actor and workspace rather than JSON supplied identity', async () => {
    mocks.auth.mockResolvedValue({ admin: {}, workspaceId: 'authorized', userId: 'actor' })
    mocks.begin.mockResolvedValue({ assetId: 'asset' })
    const body = { action: 'begin', input: {}, workspaceId: 'requested', userId: 'forged' }
    const res = await POST(new Request('https://local.invalid', { method: 'POST', body: JSON.stringify(body) }))
    expect(res.status).toBe(200)
    expect(mocks.auth).toHaveBeenLastCalledWith('requested', { requireRole: 'manager' })
    expect(mocks.begin).toHaveBeenCalledWith({ admin: {}, workspaceId: 'authorized', userId: 'actor', input: {} })
  })
  it('stores only a workspace-bound, server-revalidated explicit selection as request preference', async () => {
    const assetId = '33333333-3333-4333-8333-333333333333'
    const res = await POST(new Request('https://local.invalid', { method: 'POST', body: JSON.stringify({ action: 'select', assetId }) }))
    expect(res.status).toBe(200)
    expect(mocks.select).toHaveBeenCalledWith({ admin: {}, workspaceId: 'authorized', explicitAssetId: assetId })
    expect(res.headers.get('set-cookie')).toContain(`sohee-first-value-photo-authorized=${assetId}`)
    expect(res.headers.get('set-cookie')).toContain('HttpOnly')
  })
  it('rejects a completion without a valid asset id before readback', async () => {
    const res = await POST(new Request('https://local.invalid', { method: 'POST', body: JSON.stringify({ action: 'complete', assetId: '../../foreign' }) }))
    expect(res.status).toBe(422)
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('fails closed with 503 MEDIA_READ_FAILED when media list query returns non-array (null, undefined)', async () => {
    function customAdmin(data: any, error: any = null) {
      const q: any = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data, error }),
      }
      return { from: () => q }
    }

    mocks.auth.mockResolvedValue({ admin: customAdmin(null, null), workspaceId: 'w1', userId: 'u1' })
    const resNull = await GET(new Request('https://local.invalid'))
    expect(resNull.status).toBe(503)
    expect((await resNull.json()).code).toBe('MEDIA_READ_FAILED')

    mocks.auth.mockResolvedValue({ admin: customAdmin(undefined, null), workspaceId: 'w1', userId: 'u1' })
    const resUndef = await GET(new Request('https://local.invalid'))
    expect(resUndef.status).toBe(503)
    expect((await resUndef.json()).code).toBe('MEDIA_READ_FAILED')

    mocks.auth.mockResolvedValue({ admin: customAdmin([], null), workspaceId: 'w1', userId: 'u1' })
    const resEmpty = await GET(new Request('https://local.invalid'))
    expect(resEmpty.status).toBe(200)
    expect((await resEmpty.json()).items).toEqual([])
  })
})
