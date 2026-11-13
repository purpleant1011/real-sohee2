import crypto from 'node:crypto'
import {
  LearningError,
  type LearningDocument,
  type LearningDocumentImage,
  type LearningSource,
} from './contracts'

export const MAX_COLLECTION_DAYS = 90
export const MAX_COLLECTION_POSTS = 30
export const MAX_COLLECTION_IMAGES = 10
export const MAX_COLLECTION_CHARS = 60000
export const MAX_DOCUMENT_BODY_BYTES = 2 * 1024 * 1024 // 2MB
export const MAX_IMAGE_BODY_BYTES = 10 * 1024 * 1024 // 10MB
export const MAX_RETRIES_429 = 3

export interface ProviderMediaChild {
  id: string
  media_url?: string
  media_type?: string
  sizeBytes?: number
}

export interface ProviderPost {
  id: string
  author_id: string
  caption?: string
  timestamp?: string
  permalink?: string
  media_type?: string
  media_url?: string
  sizeBytes?: number
  children?: ProviderMediaChild[]
}

export interface ProviderFetchResult {
  status: number
  data?: {
    data?: ProviderPost[]
    paging?: {
      cursors?: { after?: string }
      next?: string
    }
  }
  error?: string
  bodySizeBytes?: number
}

export interface MetaCollectorDeps {
  fetchProvider: (input: {
    platform: 'instagram' | 'threads'
    path: string
    params?: Record<string, string>
    maxBytes?: number
  }) => Promise<ProviderFetchResult>
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
}

function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

export function createDeterministicUuid(seed: string): string {
  const hash = crypto.createHash('sha256').update(seed).digest('hex')
  const p1 = hash.slice(0, 8)
  const p2 = hash.slice(8, 12)
  const p3 = `5${hash.slice(13, 16)}`
  const p4 = `8${hash.slice(17, 20)}`
  const p5 = hash.slice(20, 32)
  return `${p1}-${p2}-${p3}-${p4}-${p5}`
}

export async function* collectMetaDocuments(
  source: LearningSource,
  deps: MetaCollectorDeps,
): AsyncIterable<LearningDocument> {
  const getNow = deps.now ?? (() => new Date())
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = getNow()

  // Lease validation
  if (!source.lease) {
    throw new LearningError('INVALID_LEASE', 'Learning source has no valid lease')
  }
  if (source.lease.revokedAt) {
    throw new LearningError('LEASE_REVOKED', 'Learning source lease is revoked')
  }
  if (new Date(source.lease.expiresAt) <= now) {
    throw new LearningError('LEASE_EXPIRED', 'Learning source lease has expired')
  }

  // Consent validation
  if (!source.consent.text && !source.consent.images) {
    return
  }

  const expectedAuthorId = source.lease.providerAccountId || source.canonicalIdentity
  const platform = source.platform === 'threads' ? 'threads' : 'instagram'
  const cutoffTime = now.getTime() - MAX_COLLECTION_DAYS * 24 * 60 * 60 * 1000

  let postCount = 0
  let totalImagesCount = 0
  let cumulativeCharCount = 0
  let nextCursor: string | undefined
  let pages = 0
  const seenCursors = new Set<string>()

  // Rejected/old/foreign rows must not bypass the request budget by never incrementing postCount.
  while (postCount < MAX_COLLECTION_POSTS && cumulativeCharCount < MAX_COLLECTION_CHARS && pages < 5) {
    if (nextCursor && seenCursors.has(nextCursor)) break
    if (nextCursor) seenCursors.add(nextCursor)
    pages++
    let attempt = 0
    let fetchRes: ProviderFetchResult | null = null

    while (attempt <= MAX_RETRIES_429) {
      const params: Record<string, string> = {
        limit: '25',
      }
      if (nextCursor) {
        params.after = nextCursor
      }

      fetchRes = await deps.fetchProvider({
        platform,
        path: '/me/media',
        params,
        maxBytes: MAX_DOCUMENT_BODY_BYTES,
      })

      if (fetchRes.status === 429) {
        attempt++
        if (attempt > MAX_RETRIES_429) {
          throw new LearningError('RATE_LIMITED', 'Exceeded maximum 429 retries')
        }
        await sleep(Math.min(100 * Math.pow(2, attempt), 1000))
        continue
      }
      break
    }

    if (!fetchRes || fetchRes.status >= 400) {
      throw new LearningError(
        'PROVIDER_FETCH_FAILED',
        fetchRes?.error || `Provider fetch failed with status ${fetchRes?.status}`,
      )
    }

    if (fetchRes.bodySizeBytes && fetchRes.bodySizeBytes > MAX_DOCUMENT_BODY_BYTES) {
      throw new LearningError(
        'DOCUMENT_BODY_EXCEEDED',
        `Document response body size ${fetchRes.bodySizeBytes} exceeds 2MB cap`,
      )
    }

    const posts = fetchRes.data?.data || []
    if (posts.length === 0) {
      break
    }

    for (const post of posts) {
      if (postCount >= MAX_COLLECTION_POSTS) {
        return
      }

      // 1. Author account check (forged author defense)
      if (post.author_id !== expectedAuthorId) {
        continue
      }

      // 2. 90-day time boundary
      if (post.timestamp) {
        const postTime = new Date(post.timestamp).getTime()
        if (postTime < cutoffTime) {
          continue
        }
      }

      // 3. Text handling & character limits
      let postText = ''
      if (source.consent.text && post.caption) {
        const remainingChars = MAX_COLLECTION_CHARS - cumulativeCharCount
        if (remainingChars <= 0) {
          return
        }
        if (post.caption.length > remainingChars) {
          postText = post.caption.slice(0, remainingChars)
        } else {
          postText = post.caption
        }
        cumulativeCharCount += postText.length
      }

      // 4. Image handling & caps (max 10 cumulative)
      const images: LearningDocumentImage[] = []
      if (source.consent.images && totalImagesCount < MAX_COLLECTION_IMAGES) {
        const rawMediaList: ProviderMediaChild[] = []
        if (post.children && post.children.length > 0) {
          rawMediaList.push(...post.children)
        } else if (post.media_url) {
          rawMediaList.push({
            id: post.id,
            media_url: post.media_url,
            media_type: post.media_type,
            sizeBytes: post.sizeBytes,
          })
        }

        for (const media of rawMediaList) {
          if (totalImagesCount >= MAX_COLLECTION_IMAGES) {
            break
          }
          if (media.media_url) {
            if (media.sizeBytes && media.sizeBytes > MAX_IMAGE_BODY_BYTES) {
              continue // skip oversized images
            }
            images.push({
              mediaId: media.id,
              url: media.media_url,
              mimeType: 'image/jpeg',
            })
            totalImagesCount++
          }
        }
      }

      const contentHash = computeHash(postText + images.map((i) => i.mediaId).join(':'))
      const docId = createDeterministicUuid(
        `${source.workspaceId}:${source.sourceId}:${source.revision}:${post.id}:${contentHash}`,
      )

      const doc: LearningDocument = {
        id: docId,
        source: {
          workspaceId: source.workspaceId,
          sourceId: source.sourceId,
          revision: source.revision,
        },
        providerDocumentId: post.id,
        authorAccountId: post.author_id,
        url: post.permalink || source.canonicalUrl,
        publishedAt: post.timestamp ? new Date(post.timestamp).toISOString() : null,
        collectedAt: now.toISOString(),
        text: postText,
        contentHash,
        images,
      }

      postCount++
      yield doc
    }

    nextCursor = fetchRes.data?.paging?.cursors?.after
    if (!nextCursor) {
      break
    }
  }
}
