import { describe, expect, it, vi } from 'vitest'
import { createMediaGetHandler } from './route'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const assetId = '77777777-7777-4777-8777-777777777777'
const userId = '33333333-3333-4333-8333-333333333333'
const context = { params: Promise.resolve({ workspaceId, assetId }) }

describe('GET private conversation media', () => {
  it('redirects an authorized workspace member to a short-lived private object URL', async () => {
    const createSignedUrl = vi.fn(async () => 'https://storage.example.test/signed-image.png?token=private')
    const resolveAuthorizedAsset = vi.fn(async () => ({
      kind: 'authorized' as const,
      asset: { bucket: 'content-media' as const, objectPath: `${workspaceId}/${userId}/${assetId}/asset.png` },
    }))
    const response = await createMediaGetHandler({
      resolveAuthorizedAsset,
      createSignedUrl,
    })(new Request('http://localhost/image'), context)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://storage.example.test/signed-image.png?token=private')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(resolveAuthorizedAsset).toHaveBeenCalledWith({ workspaceId, assetId })
    expect(resolveAuthorizedAsset).toHaveBeenCalledOnce()
    expect(createSignedUrl).toHaveBeenCalledOnce()
  })

  it('does not reveal whether an asset exists outside the current workspace membership', async () => {
    const response = await createMediaGetHandler({
      resolveAuthorizedAsset: vi.fn(async () => ({ kind: 'not_found' as const })),
      createSignedUrl: vi.fn(),
    })(new Request('http://localhost/image'), context)

    expect(response.status).toBe(404)
  })

  it('keeps the authentication-required response distinct from a missing asset', async () => {
    const response = await createMediaGetHandler({
      resolveAuthorizedAsset: vi.fn(async () => ({ kind: 'auth_required' as const })),
      createSignedUrl: vi.fn(),
    })(new Request('http://localhost/image'), context)

    expect(response.status).toBe(401)
  })
})
