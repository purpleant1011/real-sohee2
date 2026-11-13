import { describe, expect, it } from 'vitest'
import { createOwnedMediaFetcher } from './provider-media'
import type { FetchLearningProviderInput } from './provider-fetch'

describe('official owned-media normalization', () => {
  it('uses the Threads endpoint and fields and normalizes own text and carousel images', async () => {
    let request: FetchLearningProviderInput | undefined
    const fetcher = createOwnedMediaFetcher({ platform: 'threads', accountId: '123', username: 'shop', async fetchProvider(input) {
      request = input
      return { data: [{ id: 'post1', text: '영업 안내', owner: { id: '123' }, username: 'shop', timestamp: '2026-11-10T00:00:00Z',
        media_type: 'CAROUSEL', children: { data: [{ id: 'child1', media_type: 'IMAGE', media_url: 'https://cdninstagram.com/a.jpg' }] } }] }
    } })
    const result = await fetcher({ provider: 'threads', path: '/me/media', accessToken: 'private', maxBytes: 1024 }) as { data: { author_id: string; caption: string; children: unknown[] }[] }
    expect(request?.path).toBe('/me/threads')
    expect(request?.query?.fields).toContain('text')
    expect(result.data[0]).toMatchObject({ author_id: '123', caption: '영업 안내', children: [{ id: 'child1' }] })
  })
  it('excludes foreign authors, reposts and video originals instead of learning third-party media', async () => {
    const fetcher = createOwnedMediaFetcher({ platform: 'instagram', accountId: '123', username: 'shop', async fetchProvider() {
      return { data: [
        { id: 'foreign', owner: { id: 'other' }, timestamp: '2026-11-10T00:00:00Z' },
        { id: 'quote', is_quote_post: true, timestamp: '2026-11-10T00:00:00Z' },
        { id: 'video', media_type: 'VIDEO', media_url: 'https://cdninstagram.com/video.mp4', timestamp: '2026-11-10T00:00:00Z' },
      ] }
    } })
    const result = await fetcher({ provider: 'instagram', path: '/me/media', accessToken: 'private', maxBytes: 1024 }) as { data: { id: string; media_url?: string }[] }
    expect(result.data.map((item) => item.id)).toEqual(['video'])
    expect(result.data[0].media_url).toBeUndefined()
  })
  it('refuses an arbitrary endpoint or provider and malformed response instead of an empty success', async () => {
    const fetcher = createOwnedMediaFetcher({ platform: 'instagram', accountId: '123', username: 'shop', async fetchProvider() { return { bad: true } } })
    await expect(fetcher({ provider: 'threads', path: '/me/media', accessToken: 'private', maxBytes: 1024 })).rejects.toMatchObject({ code: 'PROVIDER_ACCOUNT_BOUNDARY' })
    await expect(fetcher({ provider: 'instagram', path: '/999/insights', accessToken: 'private', maxBytes: 1024 })).rejects.toMatchObject({ code: 'PROVIDER_ACCOUNT_BOUNDARY' })
    await expect(fetcher({ provider: 'instagram', path: '/me/media', accessToken: 'private', maxBytes: 1024 })).rejects.toMatchObject({ code: 'PROVIDER_MEDIA_INVALID' })
  })
})
