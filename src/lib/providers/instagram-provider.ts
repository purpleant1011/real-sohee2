/**
 * Instagram & Meta Graph Independent Readback Provider (ANI-950, ANI-956)
 *
 * Implements true independent GET verification against Meta Graph API:
 * GET /{media-id}?fields=id,permalink,caption,status_code
 *
 * Separates write success response from readback verification evidence.
 */

import crypto from 'crypto'
import type { MetaFetch } from './meta-api'
import { MetaProviderError } from './meta-api'

export interface InstagramReadbackOptions {
  fetcher?: MetaFetch
  baseUrl?: string
  channel?: 'instagram' | 'threads'
}

export interface MetaPostReadbackResult {
  isLive: boolean
  postId: string
  permalink?: string
  caption?: string
  captionDigest?: string
  statusCode?: string
  observedAt: string
  readbackRequestId: string
  rawResponse?: unknown
  error?: string
}

let defaultReadbackFetcher: MetaFetch = fetch

export function setInstagramReadbackFetcher(fetcher: MetaFetch): void {
  defaultReadbackFetcher = fetcher
}

export function resetInstagramReadbackFetcher(): void {
  defaultReadbackFetcher = fetch
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,255}$/u.test(value)) {
    throw new MetaProviderError('PROVIDER_REJECTED')
  }
  return value
}

function safeToken(value: string): string {
  if (value.length < 8 || value.length > 4096) {
    throw new MetaProviderError('TOKEN_EXPIRED')
  }
  return value
}

function safeDestinationUrl(channel: 'instagram' | 'threads', value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const url = new URL(value)
    const allowedHosts = channel === 'instagram'
      ? new Set(['instagram.com', 'www.instagram.com'])
      : new Set(['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'])
    return url.protocol === 'https:' && allowedHosts.has(url.hostname) ? url.toString() : null
  } catch {
    return null
  }
}

export async function getPostReadback(
  postId: string,
  accessToken: string,
  options?: InstagramReadbackOptions
): Promise<MetaPostReadbackResult> {
  const channel = options?.channel ?? 'instagram'
  const fetcher = options?.fetcher ?? defaultReadbackFetcher
  const observedAt = new Date().toISOString()
  const fallbackReadbackId = `readback_req_${crypto.randomUUID().slice(0, 12)}_${Date.now()}`

  let cleanedPostId: string
  let cleanedToken: string
  try {
    cleanedPostId = safeId(postId)
    cleanedToken = safeToken(accessToken)
  } catch (err: any) {
    return {
      isLive: false,
      postId,
      observedAt,
      readbackRequestId: fallbackReadbackId,
      error: `Invalid post ID or access token: ${err?.message || String(err)}`,
    }
  }

  const defaultBase = channel === 'instagram'
    ? 'https://graph.instagram.com/v26.0'
    : 'https://graph.threads.net/v1.0'
  const baseUrl = options?.baseUrl ?? defaultBase

  const fields = channel === 'instagram'
    ? 'id,permalink,caption'
    : 'id,permalink,text'
  const url = `${baseUrl}/${cleanedPostId}?fields=${fields}`

  let response: Response
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${cleanedToken}`,
        'cache-control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('[getPostReadback fetch error]:', err)
    throw new MetaProviderError('TEMPORARY_NETWORK')
  }

  const traceId = response.headers?.get?.('x-fb-trace-id') || response.headers?.get?.('X-FB-Trace-ID')
  const readbackRequestId = traceId ? `trace_${traceId}` : fallbackReadbackId

  if (response.status >= 500) {
    throw new MetaProviderError('TEMPORARY_NETWORK')
  }

  if (response.status === 429) {
    throw new MetaProviderError('RATE_LIMITED')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return {
      isLive: false,
      postId: cleanedPostId,
      observedAt,
      readbackRequestId,
      error: 'Invalid JSON response from Meta Graph API GET',
    }
  }

  if (!response.ok) {
    const errorMsg = (payload as any)?.error?.message || `HTTP ${response.status}`
    return {
      isLive: false,
      postId: cleanedPostId,
      observedAt,
      readbackRequestId,
      rawResponse: payload,
      error: `Meta Graph GET failed: ${errorMsg}`,
    }
  }

  if (typeof payload !== 'object' || payload === null) {
    return {
      isLive: false,
      postId: cleanedPostId,
      observedAt,
      readbackRequestId,
      error: 'Empty or non-object response from Meta Graph API',
    }
  }

  const data = payload as Record<string, unknown>
  const returnedId = typeof data.id === 'string' ? data.id : undefined
  const rawPermalink = typeof data.permalink === 'string' ? data.permalink : undefined
  const permalink = safeDestinationUrl(channel, rawPermalink)
  const rawCaption = typeof data.caption === 'string' ? data.caption : (typeof data.text === 'string' ? data.text : '')
  const statusCode = typeof data.status_code === 'string' ? data.status_code : (typeof data.status === 'string' ? data.status : undefined)

  if (!returnedId) {
    return {
      isLive: false,
      postId: cleanedPostId,
      observedAt,
      readbackRequestId,
      rawResponse: payload,
      error: 'Meta Graph GET response missing media id',
    }
  }

  if (!permalink) {
    return {
      isLive: false,
      postId: returnedId,
      observedAt,
      readbackRequestId,
      rawResponse: payload,
      error: 'Meta Graph GET response missing valid permalink',
    }
  }

  if (statusCode === 'EXPIRED' || statusCode === 'ERROR') {
    return {
      isLive: false,
      postId: returnedId,
      permalink,
      statusCode,
      observedAt,
      readbackRequestId,
      rawResponse: payload,
      error: `Meta container status indicates failure: ${statusCode}`,
    }
  }

  const captionDigest = crypto.createHash('sha256').update(rawCaption, 'utf8').digest('hex')

  return {
    isLive: true,
    postId: returnedId,
    permalink,
    caption: rawCaption,
    captionDigest,
    statusCode,
    observedAt,
    readbackRequestId,
    rawResponse: payload,
  }
}
