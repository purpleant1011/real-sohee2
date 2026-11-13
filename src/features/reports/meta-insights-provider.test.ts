import { describe, expect, it, vi } from 'vitest'
import {
  collectMetaPostInsights,
  MetaInsightsError,
  type MetaInsightsFetch,
} from './meta-insights-provider'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Meta post insights provider', () => {
  it('preserves an actual Instagram zero and marks omitted supported metrics as no data', async () => {
    const fetcher = vi.fn<MetaInsightsFetch>().mockResolvedValue(response({
      data: [
        { name: 'views', period: 'lifetime', values: [{ value: 0 }] },
        { name: 'likes', period: 'lifetime', values: [{ value: 12 }] },
        { name: 'comments', period: 'lifetime', values: [{ value: 3 }] },
      ],
    }))

    await expect(collectMetaPostInsights({
      channel: 'instagram',
      providerPostId: 'ig-media-1',
      accessToken: 'instagram-secret-token',
      fetcher,
    })).resolves.toEqual({
      channel: 'instagram',
      metrics: [
        { metric: 'views', state: 'available', value: 0 },
        { metric: 'likes', state: 'available', value: 12 },
        { metric: 'comments', state: 'available', value: 3 },
        { metric: 'saved', state: 'no_data', value: null },
        { metric: 'shares', state: 'no_data', value: null },
        { metric: 'visits', state: 'not_supported', value: null },
        { metric: 'inquiries', state: 'not_supported', value: null },
      ],
    })

    const url = new URL(fetcher.mock.calls[0]?.[0] ?? '')
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.instagram.com/v26.0/ig-media-1/insights',
    )
    expect(url.searchParams.get('metric')).toBe('views,likes,comments,saved,shares')
    expect(url.toString()).not.toContain('instagram-secret-token')
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer instagram-secret-token',
    )
  })

  it('requests only official Threads post metrics and parses total values', async () => {
    const fetcher = vi.fn<MetaInsightsFetch>().mockResolvedValue(response({
      data: [
        { name: 'views', period: 'lifetime', values: [{ value: 40 }] },
        { name: 'likes', period: 'lifetime', total_value: { value: 9 } },
        { name: 'replies', period: 'lifetime', values: [{ value: 2 }] },
        { name: 'reposts', period: 'lifetime', values: [{ value: 1 }] },
        { name: 'quotes', period: 'lifetime', values: [{ value: 0 }] },
        { name: 'shares', period: 'lifetime', values: [{ value: 4 }] },
      ],
    }))

    const result = await collectMetaPostInsights({
      channel: 'threads',
      providerPostId: 'threads-post-1',
      accessToken: 'threads-secret-token',
      fetcher,
    })

    expect(result.metrics).toEqual([
      { metric: 'views', state: 'available', value: 40 },
      { metric: 'likes', state: 'available', value: 9 },
      { metric: 'replies', state: 'available', value: 2 },
      { metric: 'reposts', state: 'available', value: 1 },
      { metric: 'quotes', state: 'available', value: 0 },
      { metric: 'shares', state: 'available', value: 4 },
      { metric: 'comments', state: 'not_supported', value: null },
      { metric: 'saved', state: 'not_supported', value: null },
      { metric: 'visits', state: 'not_supported', value: null },
      { metric: 'inquiries', state: 'not_supported', value: null },
    ])
    const url = new URL(fetcher.mock.calls[0]?.[0] ?? '')
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.threads.com/v1.0/threads-post-1/insights',
    )
    expect(url.searchParams.get('metric')).toBe('views,likes,replies,reposts,quotes,shares')
  })

  it('distinguishes an empty response from a real zero', async () => {
    const fetcher = vi.fn<MetaInsightsFetch>().mockResolvedValue(response({ data: [] }))
    const result = await collectMetaPostInsights({
      channel: 'instagram', providerPostId: 'ig-media-1', accessToken: 'secret-token', fetcher,
    })

    expect(result.metrics.slice(0, 5)).toEqual([
      { metric: 'views', state: 'no_data', value: null },
      { metric: 'likes', state: 'no_data', value: null },
      { metric: 'comments', state: 'no_data', value: null },
      { metric: 'saved', state: 'no_data', value: null },
      { metric: 'shares', state: 'no_data', value: null },
    ])
  })

  it('returns a secret-free permission error for 401 and 403 responses', async () => {
    const fetcher = vi.fn<MetaInsightsFetch>().mockResolvedValue(response({
      error: { message: 'token secret-token cannot read insights' },
    }, 403))

    const promise = collectMetaPostInsights({
      channel: 'threads', providerPostId: 'threads-post-1', accessToken: 'secret-token', fetcher,
    })
    await expect(promise).rejects.toBeInstanceOf(MetaInsightsError)
    await expect(promise).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await expect(promise).rejects.not.toThrow(/secret-token/u)
  })
})
