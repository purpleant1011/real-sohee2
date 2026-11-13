import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { registerUrlSourceAction } from './register-url-source'

const workspaceId = '10000000-0000-4000-8000-000000000001'

describe('registerUrlSourceAction', () => {
  it('persists the ownership, safe collection state, and pattern-only reference rule', async () => {
    const insert = vi.fn(async (input) => ({ id: '20000000-0000-4000-8000-000000000001', ...input }))
    const result = await registerUrlSourceAction({
      workspaceId,
      channel: 'instagram',
      ownership: 'reference',
      url: 'https://www.instagram.com/example/',
    }, {
      authorize: async () => true,
      gateway: { insert },
    })

    expect(result.data).toMatchObject({
      collectionState: 'refresh_required',
      allowedUse: 'pattern_only',
    })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      ownership: 'reference',
      allowedUse: 'pattern_only',
    }))
  })

  it('does not persist invalid URLs or unapproved workspaces', async () => {
    const insert = vi.fn()
    await expect(registerUrlSourceAction({
      workspaceId,
      channel: 'naver_place',
      ownership: 'owned',
      url: 'https://example.com/place/123',
    }, { authorize: async () => true, gateway: { insert } })).resolves.toMatchObject({
      error: { requestId: 'knowledge-url-source-input' },
    })
    await expect(registerUrlSourceAction({
      workspaceId,
      channel: 'naver_place',
      ownership: 'owned',
      url: 'https://map.naver.com/p/entry/place/123',
    }, { authorize: async () => false, gateway: { insert } })).resolves.toMatchObject({
      error: { requestId: 'knowledge-url-source-authorize' },
    })
    expect(insert).not.toHaveBeenCalled()
  })
})
