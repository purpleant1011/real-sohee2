import type { MetaFetch } from '@/lib/providers/meta-api'
import { MetaProviderError, safeId, safeToken } from '@/lib/providers/meta-api'
import type { CorpusPost, ProfileCorpus } from './types'

const INSTAGRAM_BASE = 'https://graph.instagram.com/v26.0'
const THREADS_BASE = 'https://graph.threads.net/v1.0'

const INSTAGRAM_MEDIA_FIELDS = encodeURIComponent(
  'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,children{media_type,media_url,thumbnail_url}',
)

const THREADS_MEDIA_FIELDS = encodeURIComponent(
  'id,text,media_type,media_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}',
)

const MAX_PAGING_REQUESTS = 5

function isValidPagingNextUrl(candidate: string, allowedHost: string): boolean {
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'https:') return false
    if (parsed.port && parsed.port !== '443') return false
    return parsed.hostname.toLowerCase() === allowedHost
  } catch {
    return false
  }
}

async function requestGraphJson(
  fetcher: MetaFetch,
  url: string,
  token: string,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch {
    throw new MetaProviderError('TEMPORARY_NETWORK', '일시적인 네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요')
  }

  if (!response || typeof response.status !== 'number') {
    throw new MetaProviderError('TEMPORARY_NETWORK', '일시적인 네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new MetaProviderError(
      response.status >= 500 ? 'TEMPORARY_NETWORK' : 'PROVIDER_REJECTED',
      response.status >= 500
        ? '인스타그램 서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요'
        : '응답을 처리하지 못했습니다',
    )
  }

  if (!response.ok || typeof payload !== 'object' || payload === null) {
    if (response.status === 429) {
      throw new MetaProviderError('RATE_LIMITED', '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요')
    }
    if (response.status === 401 || response.status === 403) {
      throw new MetaProviderError('TOKEN_EXPIRED', '인증이 만료되었습니다. 계정을 다시 연결해 주세요')
    }
    if (response.status === 400 && typeof payload === 'object' && payload !== null) {
      const errorObj = (payload as { error?: Record<string, unknown> }).error
      const code = errorObj?.code
      const msg = typeof errorObj?.message === 'string' ? errorObj.message : ''
      if (code === 110 || /invalid user id/i.test(msg) || /business/i.test(msg)) {
        throw new MetaProviderError(
          'PROVIDER_REJECTED',
          '계정 정보를 확인하지 못했어요',
        )
      }
    }
    if (response.status >= 500) {
      throw new MetaProviderError('TEMPORARY_NETWORK', '인스타그램 서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요')
    }
    throw new MetaProviderError('PROVIDER_REJECTED', '계정 정보를 가져오지 못했습니다')
  }

  return payload
}

function mapInstagramPost(raw: unknown): CorpusPost | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>
  const id = typeof item.id === 'string' && item.id ? safeId(item.id) : null
  if (!id) return null

  const caption = typeof item.caption === 'string' ? item.caption : ''
  const permalink = typeof item.permalink === 'string' ? item.permalink : null
  const timestamp = typeof item.timestamp === 'string' ? item.timestamp : null

  let mediaType: CorpusPost['mediaType'] = 'UNKNOWN'
  if (item.media_type === 'IMAGE') mediaType = 'IMAGE'
  else if (item.media_type === 'VIDEO') mediaType = 'VIDEO'
  else if (item.media_type === 'CAROUSEL_ALBUM') mediaType = 'CAROUSEL_ALBUM'

  let imageUrls: string[] = []
  if (mediaType === 'IMAGE') {
    if (typeof item.media_url === 'string' && item.media_url) {
      imageUrls = [item.media_url]
    }
  } else if (mediaType === 'VIDEO') {
    if (typeof item.thumbnail_url === 'string' && item.thumbnail_url) {
      imageUrls = [item.thumbnail_url]
    } else if (typeof item.media_url === 'string' && item.media_url) {
      imageUrls = [item.media_url]
    }
  } else if (mediaType === 'CAROUSEL_ALBUM') {
    const childrenData = (item.children as { data?: unknown[] } | undefined)?.data
    if (Array.isArray(childrenData)) {
      const childImages: string[] = []
      for (const child of childrenData) {
        if (typeof child !== 'object' || child === null) continue
        const c = child as Record<string, unknown>
        if (c.media_type === 'IMAGE' && typeof c.media_url === 'string' && c.media_url) {
          childImages.push(c.media_url)
        } else if (c.media_type === 'VIDEO') {
          if (typeof c.thumbnail_url === 'string' && c.thumbnail_url) {
            childImages.push(c.thumbnail_url)
          } else if (typeof c.media_url === 'string' && c.media_url) {
            childImages.push(c.media_url)
          }
        }
      }
      if (childImages.length > 0) {
        imageUrls = childImages
      }
    }
    if (imageUrls.length === 0) {
      if (typeof item.thumbnail_url === 'string' && item.thumbnail_url) {
        imageUrls = [item.thumbnail_url]
      } else if (typeof item.media_url === 'string' && item.media_url) {
        imageUrls = [item.media_url]
      }
    }
  }

  const likeCount = typeof item.like_count === 'number' && Number.isFinite(item.like_count)
    ? item.like_count
    : null
  const commentsCount = typeof item.comments_count === 'number' && Number.isFinite(item.comments_count)
    ? item.comments_count
    : null

  return Object.freeze({
    id,
    caption,
    permalink,
    timestamp,
    mediaType,
    imageUrls: Object.freeze(imageUrls),
    likeCount,
    commentsCount,
  })
}

function mapThreadsPost(raw: unknown): CorpusPost | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>
  const id = typeof item.id === 'string' && item.id ? safeId(item.id) : null
  if (!id) return null

  const caption = typeof item.text === 'string' ? item.text : ''
  const permalink = typeof item.permalink === 'string' ? item.permalink : null
  const timestamp = typeof item.timestamp === 'string' ? item.timestamp : null

  let mediaType: CorpusPost['mediaType'] = 'UNKNOWN'
  if (item.media_type === 'TEXT_POST') mediaType = 'TEXT'
  else if (item.media_type === 'IMAGE') mediaType = 'IMAGE'
  else if (item.media_type === 'CAROUSEL_ALBUM') mediaType = 'CAROUSEL_ALBUM'
  else if (item.media_type === 'VIDEO') mediaType = 'VIDEO'

  let imageUrls: string[] = []
  if (mediaType === 'IMAGE') {
    if (typeof item.media_url === 'string' && item.media_url) {
      imageUrls = [item.media_url]
    }
  } else if (mediaType === 'VIDEO') {
    if (typeof item.thumbnail_url === 'string' && item.thumbnail_url) {
      imageUrls = [item.thumbnail_url]
    } else if (typeof item.media_url === 'string' && item.media_url) {
      imageUrls = [item.media_url]
    }
  } else if (mediaType === 'CAROUSEL_ALBUM') {
    const childrenData = (item.children as { data?: unknown[] } | undefined)?.data
    if (Array.isArray(childrenData)) {
      const childImages: string[] = []
      for (const child of childrenData) {
        if (typeof child !== 'object' || child === null) continue
        const c = child as Record<string, unknown>
        if ((c.media_type === 'IMAGE' || !c.media_type) && typeof c.media_url === 'string' && c.media_url) {
          childImages.push(c.media_url)
        } else if (c.media_type === 'VIDEO') {
          if (typeof c.thumbnail_url === 'string' && c.thumbnail_url) {
            childImages.push(c.thumbnail_url)
          } else if (typeof c.media_url === 'string' && c.media_url) {
            childImages.push(c.media_url)
          }
        }
      }
      if (childImages.length > 0) {
        imageUrls = childImages
      }
    }
    if (imageUrls.length === 0) {
      if (typeof item.thumbnail_url === 'string' && item.thumbnail_url) {
        imageUrls = [item.thumbnail_url]
      } else if (typeof item.media_url === 'string' && item.media_url) {
        imageUrls = [item.media_url]
      }
    }
  }

  return Object.freeze({
    id,
    caption,
    permalink,
    timestamp,
    mediaType,
    imageUrls: Object.freeze(imageUrls),
    likeCount: null,
    commentsCount: null,
  })
}

export async function fetchInstagramCorpus(input: {
  accountId: string
  accessToken: string
  ownHandle: string | null
  targetHandle: string
  fetcher?: MetaFetch
  limit?: number
}): Promise<ProfileCorpus> {
  const fetcher = input.fetcher ?? fetch
  const accountId = safeId(input.accountId)
  const token = safeToken(input.accessToken)
  const targetHandle = input.targetHandle.trim()
  const ownHandle = input.ownHandle?.trim() ?? null
  const isOwnAccount = ownHandle !== null && targetHandle.toLowerCase() === ownHandle.toLowerCase()

  if (!isOwnAccount) {
    throw new MetaProviderError(
      'PROVIDER_REJECTED',
      '인스타그램은 현재 연결한 내 계정만 분석할 수 있어요. 다른 계정은 사진·텍스트 자료로 직접 등록해 주세요.',
    )
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 50)
  const profileUrl = `${INSTAGRAM_BASE}/${accountId}?fields=username,name,biography,followers_count,media_count`
  const profilePayload = await requestGraphJson(fetcher, profileUrl, token)

  const posts: CorpusPost[] = []
  let currentUrl: string | null = `${INSTAGRAM_BASE}/${accountId}/media?fields=${INSTAGRAM_MEDIA_FIELDS}&limit=50`
  let pageRequests = 0
  const seenUrls = new Set<string>()

  while (currentUrl && posts.length < limit && pageRequests < MAX_PAGING_REQUESTS) {
    pageRequests += 1
    seenUrls.add(currentUrl)

    const mediaPayload = await requestGraphJson(fetcher, currentUrl, token)
    const media = (mediaPayload ?? {}) as { data?: unknown[]; paging?: { next?: string } }
    const rawList = Array.isArray(media.data) ? media.data : []

    for (const raw of rawList) {
      const post = mapInstagramPost(raw)
      if (post) {
        posts.push(post)
        if (posts.length >= limit) break
      }
    }

    const nextUrlCandidate = typeof media.paging?.next === 'string' ? media.paging.next : null
    if (
      nextUrlCandidate
      && isValidPagingNextUrl(nextUrlCandidate, 'graph.instagram.com')
      && !seenUrls.has(nextUrlCandidate)
    ) {
      currentUrl = nextUrlCandidate
    } else {
      currentUrl = null
    }
  }

  const profile = (profilePayload ?? {}) as Record<string, unknown>

  return Object.freeze({
    platform: 'instagram',
    handle: typeof profile.username === 'string' && profile.username ? profile.username : targetHandle,
    displayName: typeof profile.name === 'string' && profile.name ? profile.name : null,
    biography: typeof profile.biography === 'string' && profile.biography ? profile.biography : null,
    followersCount: typeof profile.followers_count === 'number' && Number.isFinite(profile.followers_count)
      ? profile.followers_count
      : null,
    mediaCount: typeof profile.media_count === 'number' && Number.isFinite(profile.media_count)
      ? profile.media_count
      : null,
    posts: Object.freeze(posts),
    isOwnAccount: true,
  })
}

export async function fetchThreadsOwnCorpus(input: {
  accessToken: string
  ownHandle: string | null
  targetHandle: string
  fetcher?: MetaFetch
  limit?: number
}): Promise<ProfileCorpus> {
  const fetcher = input.fetcher ?? fetch
  const token = safeToken(input.accessToken)
  const targetHandle = input.targetHandle.trim()
  const ownHandle = input.ownHandle?.trim() ?? null

  if (!ownHandle || targetHandle.toLowerCase() !== ownHandle.toLowerCase()) {
    throw new MetaProviderError(
      'PROVIDER_REJECTED',
      '스레드는 내가 연결한 계정만 분석할 수 있어요',
    )
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 50)
  const posts: CorpusPost[] = []
  let currentUrl: string | null = `${THREADS_BASE}/me/threads?fields=${THREADS_MEDIA_FIELDS}&limit=50`
  let pageRequests = 0
  const seenUrls = new Set<string>()

  while (currentUrl && posts.length < limit && pageRequests < MAX_PAGING_REQUESTS) {
    pageRequests += 1
    seenUrls.add(currentUrl)

    const payload = await requestGraphJson(fetcher, currentUrl, token)
    const media = (payload ?? {}) as { data?: unknown[]; paging?: { next?: string } }
    const rawList = Array.isArray(media.data) ? media.data : []

    for (const raw of rawList) {
      const post = mapThreadsPost(raw)
      if (post) {
        posts.push(post)
        if (posts.length >= limit) break
      }
    }

    const nextUrlCandidate = typeof media.paging?.next === 'string' ? media.paging.next : null
    if (
      nextUrlCandidate
      && isValidPagingNextUrl(nextUrlCandidate, 'graph.threads.net')
      && !seenUrls.has(nextUrlCandidate)
    ) {
      currentUrl = nextUrlCandidate
    } else {
      currentUrl = null
    }
  }

  return Object.freeze({
    platform: 'threads',
    handle: targetHandle,
    displayName: null,
    biography: null,
    followersCount: null,
    mediaCount: null,
    posts: Object.freeze(posts),
    isOwnAccount: true,
  })
}
