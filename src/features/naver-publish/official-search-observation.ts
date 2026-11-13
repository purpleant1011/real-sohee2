export type SearchObservationStatus =
  | 'OBSERVED_IN_SAMPLE'
  | 'NOT_FOUND_IN_SAMPLE'
  | 'API_ERROR'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'NOT_CONFIGURED'
  | 'STALE'

export interface BlogSearchObservation {
  source: 'NAVER_OFFICIAL_BLOG_SEARCH_API'
  query: string
  sort: 'sim' | 'date'
  start: number
  display: number
  requestedAt: string
  respondedAt: string | null
  status: SearchObservationStatus
  matchedCanonicalUrl: string | null
  matchedSamplePosition: number | null // API 응답 배열 내 1-based 위치. '순위' 아님
  sampleCount: number
  apiErrorCode: string | null
  limitations: string[]
  postAgeHint: 'WITHIN_24H' | 'OVER_24H' | 'UNKNOWN'
}

const ALLOWED_BLOG_HOSTS = new Set(['blog.naver.com', 'm.blog.naver.com'])
const POST_VIEW_PATHS = new Set(['postview.naver', 'postview.nhn'])
const BLOG_ID_PATTERN = /^[A-Za-z0-9_-]{2,30}$/
const LOG_NO_PATTERN = /^\d+$/

const LIMITATION_BASE = '공식 검색 API 응답 표본 기준이며 네이버 통합검색 실제 노출 순위가 아니에요.'
const LIMITATION_NOT_FOUND = '전체 검색에서 제외됐다는 뜻이 아니에요.'

/**
 * 네이버 블로그 URL을 표준 'https://blog.naver.com/{id}/{logNo}' 형식으로 정규화한다.
 * SSRF 방지를 위해 네이버 블로그 호스트 allowlist만 허용하며, 그 외 호스트는 null을 반환한다.
 */
export function canonicalizeNaverBlogUrl(url: string): string | null {
  const trimmed = (url || '').trim()
  if (!trimmed) return null

  const withProtocol =
    trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    return null
  }

  const hostname = parsed.hostname.toLowerCase()
  if (!ALLOWED_BLOG_HOSTS.has(hostname)) {
    return null
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  let blogId: string | null = null
  let logNo: string | null = null

  if (segments.length === 2) {
    blogId = segments[0]
    logNo = segments[1]
  } else if (segments.length === 1 && POST_VIEW_PATHS.has(segments[0].toLowerCase())) {
    blogId = parsed.searchParams.get('blogId')
    logNo = parsed.searchParams.get('logNo')
  }

  if (!blogId || !logNo) return null
  if (!BLOG_ID_PATTERN.test(blogId) || !LOG_NO_PATTERN.test(logNo)) return null

  return `https://blog.naver.com/${blogId}/${logNo}`
}

function computePostAgeHint(
  publishedAt?: string,
  nowDate?: Date,
): 'WITHIN_24H' | 'OVER_24H' | 'UNKNOWN' {
  if (!publishedAt) return 'UNKNOWN'
  const pubTime = new Date(publishedAt).getTime()
  if (isNaN(pubTime)) return 'UNKNOWN'

  const nowTime = (nowDate ?? new Date()).getTime()
  const diffMs = nowTime - pubTime
  if (diffMs < 0) return 'UNKNOWN'
  if (diffMs <= 24 * 60 * 60 * 1000) return 'WITHIN_24H'
  return 'OVER_24H'
}

function buildLimitations(status: SearchObservationStatus): string[] {
  const limitations = [LIMITATION_BASE]
  if (status === 'NOT_FOUND_IN_SAMPLE') {
    limitations.push(LIMITATION_NOT_FOUND)
  }
  return limitations
}

export async function observeBlogSearch(params: {
  ownerPostUrl: string
  query: string
  sort?: 'sim' | 'date'
  start?: number
  display?: number
  publishedAt?: string
  env?: { clientId?: string; clientSecret?: string }
  fetchImpl?: typeof fetch
  now?: () => Date
}): Promise<BlogSearchObservation> {
  const getNow = params.now ?? (() => new Date())
  const requestedAt = getNow().toISOString()

  const display = Math.max(1, Math.min(100, Math.floor(params.display ?? 100)))
  const start = Math.max(1, Math.min(1000, Math.floor(params.start ?? 1)))
  const sort = params.sort === 'date' ? 'date' : 'sim'
  const postAgeHint = computePostAgeHint(params.publishedAt, getNow())

  const clientId =
    params.env?.clientId ||
    process.env.NAVER_SEARCH_CLIENT_ID ||
    process.env.NAVER_CLIENT_ID
  const clientSecret =
    params.env?.clientSecret ||
    process.env.NAVER_SEARCH_CLIENT_SECRET ||
    process.env.NAVER_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return {
      source: 'NAVER_OFFICIAL_BLOG_SEARCH_API',
      query: params.query,
      sort,
      start,
      display,
      requestedAt,
      respondedAt: null,
      status: 'NOT_CONFIGURED',
      matchedCanonicalUrl: null,
      matchedSamplePosition: null,
      sampleCount: 0,
      apiErrorCode: null,
      limitations: buildLimitations('NOT_CONFIGURED'),
      postAgeHint,
    }
  }

  const apiUrl = new URL('https://openapi.naver.com/v1/search/blog.json')
  apiUrl.searchParams.set('query', params.query)
  apiUrl.searchParams.set('display', String(display))
  apiUrl.searchParams.set('start', String(start))
  apiUrl.searchParams.set('sort', sort)

  const fetchFn = params.fetchImpl ?? fetch

  let response: Response
  try {
    response = await fetchFn(apiUrl.toString(), {
      method: 'GET',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    })
  } catch (networkError) {
    const errMessage = networkError instanceof Error ? networkError.message : 'NETWORK_ERROR'
    return {
      source: 'NAVER_OFFICIAL_BLOG_SEARCH_API',
      query: params.query,
      sort,
      start,
      display,
      requestedAt,
      respondedAt: getNow().toISOString(),
      status: 'API_ERROR',
      matchedCanonicalUrl: null,
      matchedSamplePosition: null,
      sampleCount: 0,
      apiErrorCode: errMessage,
      limitations: buildLimitations('API_ERROR'),
      postAgeHint,
    }
  }

  const respondedAt = getNow().toISOString()

  if (response.status === 401 || response.status === 403) {
    return {
      source: 'NAVER_OFFICIAL_BLOG_SEARCH_API',
      query: params.query,
      sort,
      start,
      display,
      requestedAt,
      respondedAt,
      status: 'UNAUTHORIZED',
      matchedCanonicalUrl: null,
      matchedSamplePosition: null,
      sampleCount: 0,
      apiErrorCode: String(response.status),
      limitations: buildLimitations('UNAUTHORIZED'),
      postAgeHint,
    }
  }

  if (response.status === 429) {
    return {
      source: 'NAVER_OFFICIAL_BLOG_SEARCH_API',
      query: params.query,
      sort,
      start,
      display,
      requestedAt,
      respondedAt,
      status: 'RATE_LIMITED',
      matchedCanonicalUrl: null,
      matchedSamplePosition: null,
      sampleCount: 0,
      apiErrorCode: String(response.status),
      limitations: buildLimitations('RATE_LIMITED'),
      postAgeHint,
    }
  }

  if (!response.ok) {
    return {
      source: 'NAVER_OFFICIAL_BLOG_SEARCH_API',
      query: params.query,
      sort,
      start,
      display,
      requestedAt,
      respondedAt,
      status: 'API_ERROR',
      matchedCanonicalUrl: null,
      matchedSamplePosition: null,
      sampleCount: 0,
      apiErrorCode: String(response.status),
      limitations: buildLimitations('API_ERROR'),
      postAgeHint,
    }
  }

  interface NaverSearchBlogItem {
    title?: string
    link?: string
    description?: string
  }

  interface NaverSearchBlogResponse {
    total?: number
    start?: number
    display?: number
    items?: NaverSearchBlogItem[]
  }

  let data: NaverSearchBlogResponse
  try {
    data = (await response.json()) as NaverSearchBlogResponse
  } catch {
    return {
      source: 'NAVER_OFFICIAL_BLOG_SEARCH_API',
      query: params.query,
      sort,
      start,
      display,
      requestedAt,
      respondedAt,
      status: 'API_ERROR',
      matchedCanonicalUrl: null,
      matchedSamplePosition: null,
      sampleCount: 0,
      apiErrorCode: 'JSON_PARSE_ERROR',
      limitations: buildLimitations('API_ERROR'),
      postAgeHint,
    }
  }

  const items = Array.isArray(data?.items) ? data.items : []
  const sampleCount = items.length
  const targetCanonical = canonicalizeNaverBlogUrl(params.ownerPostUrl)

  let matchedSamplePosition: number | null = null
  let matchedCanonicalUrl: string | null = null

  if (targetCanonical) {
    for (let i = 0; i < items.length; i++) {
      const rawLink = items[i]?.link
      const itemLink = typeof rawLink === 'string' ? rawLink : ''
      const itemCanonical = canonicalizeNaverBlogUrl(itemLink)
      if (itemCanonical && itemCanonical === targetCanonical) {
        matchedSamplePosition = i + 1
        matchedCanonicalUrl = targetCanonical
        break
      }
    }
  }

  const status: SearchObservationStatus =
    matchedSamplePosition !== null ? 'OBSERVED_IN_SAMPLE' : 'NOT_FOUND_IN_SAMPLE'

  return {
    source: 'NAVER_OFFICIAL_BLOG_SEARCH_API',
    query: params.query,
    sort,
    start,
    display,
    requestedAt,
    respondedAt,
    status,
    matchedCanonicalUrl,
    matchedSamplePosition,
    sampleCount,
    apiErrorCode: null,
    limitations: buildLimitations(status),
    postAgeHint,
  }
}
