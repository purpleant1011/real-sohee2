import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), observeBlogSearch: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/features/naver-publish/official-search-observation', () => ({
  observeBlogSearch: mocks.observeBlogSearch,
}))
import { GET } from './route'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const CONTENT_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_CONTENT = '33333333-3333-4333-8333-333333333333'
const VERSION = '44444444-4444-4444-8444-444444444444'
const OTHER_VERSION = '55555555-5555-4555-8555-555555555555'
const OLD_VERSION = '66666666-6666-4666-8666-666666666666'
type Row = Record<string, unknown>
let rows: Record<string, Row[]>
let failedTable: string | null

// Execute the read filters instead of returning the same row for every query.
function database() {
  return { from(table: string) {
    const filters: ((row: Row) => boolean)[] = []
    let sort = ''; let ascending = true; let count = Infinity
    const result = () => {
      if (table === failedTable) return { data: null, error: { message: 'private database detail' } }
      const data = (rows[table] ?? []).filter(row => filters.every(filter => filter(row)))
      if (sort) data.sort((a, b) => String(a[sort]).localeCompare(String(b[sort])) * (ascending ? 1 : -1))
      return { data: data.slice(0, count), error: null }
    }
    const query = {
      select() { return query },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query },
      order(key: string, options?: { ascending: boolean }) { sort = key; ascending = options?.ascending ?? true; return query },
      limit(value: number) { count = value; return query },
      maybeSingle() { const value = result(); return Promise.resolve({ ...value, data: value.data?.[0] ?? null }) },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve) },
    }
    return query
  } }
}
const get = (contentId = CONTENT_ID, queryParams = '') =>
  GET(new Request(`http://localhost/api/workspaces/${WORKSPACE}/naver-posts/${contentId}/rank${queryParams ? `?${queryParams}` : ''}`), {
    params: Promise.resolve({ workspaceId: WORKSPACE, contentId }),
  })

const mockObservation = {
  source: 'NAVER_OFFICIAL_BLOG_SEARCH_API' as const,
  query: '상담 안내',
  sort: 'sim' as const,
  start: 1,
  display: 100,
  requestedAt: '2026-11-03T00:00:00Z',
  respondedAt: '2026-11-03T00:00:01Z',
  status: 'OBSERVED_IN_SAMPLE' as const,
  matchedCanonicalUrl: 'https://blog.naver.com/owned_blog/111111111111',
  matchedSamplePosition: 3,
  sampleCount: 100,
  apiErrorCode: null,
  limitations: ['공식 검색 API 응답 표본 기준이며 네이버 통합검색 실제 노출 순위가 아니에요.'],
  postAgeHint: 'WITHIN_24H' as const,
}

beforeEach(() => {
  vi.clearAllMocks(); failedTable = null
  rows = {
    content_items: [
      { id: CONTENT_ID, workspace_id: WORKSPACE, channel: 'naver_blog', current_version_id: VERSION },
      { id: OTHER_CONTENT, workspace_id: WORKSPACE, channel: 'naver_blog', current_version_id: OTHER_VERSION },
    ],
    content_versions: [
      { id: VERSION, workspace_id: WORKSPACE, content_id: CONTENT_ID, structured_payload: { channel: 'naver_blog', keywords: ['상담 안내'] } },
      { id: OTHER_VERSION, workspace_id: WORKSPACE, content_id: OTHER_CONTENT, structured_payload: { channel: 'naver_blog', keywords: ['다른 원고'] } },
    ],
    external_action_requests: [
      { id: 'action-a', workspace_id: WORKSPACE, channel: 'naver_blog', status: 'succeeded', content_version_id: VERSION, created_at: '2026-10-01' },
      ...Array.from({ length: 6 }, (_, index) => ({ id: `action-b-${index}`, workspace_id: WORKSPACE, channel: 'naver_blog', status: 'succeeded', content_version_id: OTHER_VERSION, created_at: `2026-10-${10 + index}` })),
    ],
    external_action_receipts: [
      { action_request_id: 'action-a', workspace_id: WORKSPACE, result_url: 'https://blog.naver.com/owned_blog/111111111111', created_at: '2026-10-01' },
      ...Array.from({ length: 6 }, (_, index) => ({ action_request_id: `action-b-${index}`, workspace_id: WORKSPACE, result_url: 'https://blog.naver.com/other_blog/222222222222', created_at: `2026-10-${10 + index}` })),
    ],
  }
  mocks.authorize.mockResolvedValue({ workspaceId: WORKSPACE, supabase: database() })
  mocks.observeBlogSearch.mockResolvedValue(mockObservation)
})

describe('Naver rank content/version lineage and official search observation', () => {
  it('preserves the authentication boundary', async () => {
    mocks.authorize.mockResolvedValue(new Response('auth required', { status: 401 }))
    expect((await get()).status).toBe(401)
    expect(mocks.observeBlogSearch).not.toHaveBeenCalled()
  })

  it('rejects invalid content IDs before looking up observations', async () => {
    expect((await get('not-a-content-id')).status).toBe(400)
    expect(mocks.observeBlogSearch).not.toHaveBeenCalled()
  })

  it('does not return another article when the requested content is missing', async () => {
    rows.content_items = rows.content_items.filter(row => row.id !== CONTENT_ID)
    expect((await get()).status).toBe(404)
    expect(mocks.observeBlogSearch).not.toHaveBeenCalled()
  })

  it('observes blog search with owner url and keyword and returns observation directly without rank fields', async () => {
    const response = await get()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual(mockObservation)
    expect(body).not.toHaveProperty('bestRank')
    expect(body).not.toHaveProperty('ranks')
    expect(mocks.observeBlogSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerPostUrl: 'https://blog.naver.com/owned_blog/111111111111',
        query: '상담 안내',
      }),
    )
  })

  it('allows overriding query and url via request query parameters', async () => {
    const response = await get(CONTENT_ID, 'query=새로운검색어&url=https://blog.naver.com/custom/3333')
    expect(response.status).toBe(200)
    expect(mocks.observeBlogSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerPostUrl: 'https://blog.naver.com/custom/3333',
        query: '새로운검색어',
      }),
    )
  })

  it('returns NOT_CONFIGURED when search keys are not configured', async () => {
    mocks.observeBlogSearch.mockResolvedValue({
      ...mockObservation,
      status: 'NOT_CONFIGURED',
      matchedCanonicalUrl: null,
      matchedSamplePosition: null,
    })
    const response = await get()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('NOT_CONFIGURED')
    expect(body).not.toHaveProperty('bestRank')
  })

  it('keeps the explicit latest alias bound to a real content and its current version', async () => {
    const response = await get('latest')
    expect(response.status).toBe(200)
    expect(mocks.observeBlogSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerPostUrl: 'https://blog.naver.com/other_blog/222222222222',
        query: '다른 원고',
      }),
    )
  })

  it.each(['older version', 'other workspace', 'no publication'])('does not reuse an unrelated action: %s', scenario => {
    if (scenario === 'older version') rows.external_action_requests[0].content_version_id = OLD_VERSION
    if (scenario === 'other workspace') rows.external_action_requests[0].workspace_id = OTHER_CONTENT
    if (scenario === 'no publication') rows.external_action_requests[0].status = 'pending'
    return get().then(response => {
      expect(response.status).toBe(404)
      expect(mocks.observeBlogSearch).not.toHaveBeenCalled()
    })
  })

  it('rejects a version belonging to another article', async () => {
    rows.content_items[0].current_version_id = OTHER_VERSION
    expect((await get()).status).toBe(404)
    expect(mocks.observeBlogSearch).not.toHaveBeenCalled()
  })

  it('does not expose a receipt from another workspace', async () => {
    rows.external_action_receipts[0].workspace_id = OTHER_CONTENT
    expect((await get()).status).toBe(404)
    expect(mocks.observeBlogSearch).not.toHaveBeenCalled()
  })

  it.each(['content_items', 'content_versions', 'external_action_requests', 'external_action_receipts'])('distinguishes a database failure from no published article: %s', async table => {
    failedTable = table
    const response = await get()
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private database detail')
    expect(mocks.observeBlogSearch).not.toHaveBeenCalled()
  })
})
