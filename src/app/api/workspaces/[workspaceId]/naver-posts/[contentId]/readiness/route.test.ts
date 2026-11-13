import { beforeEach, describe, expect, it, vi } from 'vitest'

type EvaluateFn = typeof import('@/features/channel-studio/naver/editorial-readiness').evaluateEditorialReadiness

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  evaluateEditorialReadiness: vi.fn(),
  actualEvaluate: { fn: null as unknown as EvaluateFn },
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))

vi.mock('@/features/channel-studio/naver/editorial-readiness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/channel-studio/naver/editorial-readiness')>()
  mocks.actualEvaluate.fn = actual.evaluateEditorialReadiness
  return {
    ...actual,
    evaluateEditorialReadiness: mocks.evaluateEditorialReadiness,
  }
})

import { GET } from './route'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const OTHER_WORKSPACE = '99999999-9999-4999-8999-999999999999'
const CONTENT_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_CONTENT = '33333333-3333-4333-8333-333333333333'
const VERSION = '44444444-4444-4444-8444-444444444444'
const OTHER_VERSION = '55555555-5555-4555-8555-555555555555'

type Row = Record<string, unknown>
let rows: Record<string, Row[]>
let failedTable: string | null

function database() {
  return {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = []
      let sort = ''
      let ascending = true
      let count = Infinity
      const result = () => {
        if (table === failedTable) return { data: null, error: { message: 'database failure' } }
        const data = (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
        if (sort) data.sort((a, b) => String(a[sort]).localeCompare(String(b[sort])) * (ascending ? 1 : -1))
        return { data: data.slice(0, count), error: null }
      }
      const query = {
        select() {
          return query
        },
        eq(key: string, value: unknown) {
          filters.push((row) => row[key] === value)
          return query
        },
        neq(key: string, value: unknown) {
          filters.push((row) => row[key] !== value)
          return query
        },
        in(key: string, values: unknown[]) {
          filters.push((row) => values.includes(row[key]))
          return query
        },
        order(key: string, options?: { ascending: boolean }) {
          sort = key
          ascending = options?.ascending ?? true
          return query
        },
        limit(value: number) {
          count = value
          return query
        },
        maybeSingle() {
          const value = result()
          return Promise.resolve({ ...value, data: value.data?.[0] ?? null })
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve)
        },
      }
      return query
    },
  }
}

const get = (contentId: string = CONTENT_ID, workspaceId: string = WORKSPACE, search = '') =>
  GET(new Request(`http://localhost/api/workspaces/${workspaceId}/naver-posts/${contentId}/readiness${search}`), {
    params: Promise.resolve({ workspaceId, contentId }),
  })

const mockEvaluation = {
  rubricVersion: '1.2.0',
  evaluatedAt: '2026-11-03T00:00:00Z',
  dimensions: [
    {
      key: 'FACTUAL_SUPPORT' as const,
      maxScore: 30,
      rawScore: null,
      status: 'NOT_ASSESSED' as const,
      reason: '승인된 사실 근거가 제공되지 않아 평가하지 않았습니다.',
      suggestedFixes: ['본문의 사실 관계를 확인하고 승인 근거를 등록해 주세요.'],
    },
  ],
  hardStops: [],
  totalIfComplete: null,
  eligibility: 'INCOMPLETE' as const,
  actionableFixes: ['본문의 사실 관계를 확인하고 승인 근거를 등록해 주세요.'],
  disclaimer: '소희가 발행 전 원고를 점검한 내부 진단이며 네이버 검색 순위·노출과는 관련 없어요.',
}

beforeEach(() => {
  vi.clearAllMocks()
  failedTable = null
  rows = {
    content_items: [
      { id: CONTENT_ID, workspace_id: WORKSPACE, channel: 'naver_blog', title: '강남 피부관리 후기', current_version_id: VERSION, created_at: '2026-10-01' },
      { id: OTHER_CONTENT, workspace_id: WORKSPACE, channel: 'naver_blog', title: '이전 글 제목', current_version_id: OTHER_VERSION, created_at: '2026-09-01' },
    ],
    content_versions: [
      {
        id: VERSION,
        workspace_id: WORKSPACE,
        content_id: CONTENT_ID,
        structured_payload: {
          channel: 'naver_blog',
          title: '강남 피부관리 솔직 후기',
          introduction: '피부 관리 팁 소개합니다.',
          sections: [{ heading: '관리 전후', body: '보습이 중요합니다.' }],
          keywords: ['피부관리', '강남'],
          cta: '지금 예약해 보세요.',
        },
      },
      {
        id: OTHER_VERSION,
        workspace_id: WORKSPACE,
        content_id: OTHER_CONTENT,
        structured_payload: {
          channel: 'naver_blog',
          title: '이전 글 제목',
          keywords: ['이전'],
        },
      },
    ],
    media_assets: [],
  }
  mocks.authorize.mockResolvedValue({ workspaceId: WORKSPACE, supabase: database() })
  mocks.evaluateEditorialReadiness.mockReturnValue(mockEvaluation)
})

describe('Naver readiness route (GET)', () => {
  it('preserves the authentication boundary', async () => {
    mocks.authorize.mockResolvedValue(new Response('auth required', { status: 401 }))
    const res = await get()
    expect(res.status).toBe(401)
    expect(mocks.evaluateEditorialReadiness).not.toHaveBeenCalled()
  })

  it('enforces tenant boundary (403 when auth workspace differs)', async () => {
    mocks.authorize.mockResolvedValue({ workspaceId: OTHER_WORKSPACE, supabase: database() })
    const res = await get()
    expect(res.status).toBe(403)
    expect(mocks.evaluateEditorialReadiness).not.toHaveBeenCalled()
  })

  it('rejects invalid content IDs (not uuid or latest) with 400', async () => {
    const res = await get('invalid-id')
    expect(res.status).toBe(400)
    expect(mocks.evaluateEditorialReadiness).not.toHaveBeenCalled()
  })

  it('returns 404 when content is missing or not naver_blog', async () => {
    rows.content_items = []
    const res = await get()
    expect(res.status).toBe(404)
    expect(mocks.evaluateEditorialReadiness).not.toHaveBeenCalled()
  })

  it('evaluates readiness and returns evaluation JSON with approvedFacts undefined (NOT_ASSESSED, no fake 0)', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual(mockEvaluation)
    expect(mocks.evaluateEditorialReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '강남 피부관리 솔직 후기',
        tags: ['피부관리', '강남'],
        approvedFacts: undefined,
        hasCta: true,
      }),
    )
  })

  it('supports latest alias to evaluate the latest naver_blog post', async () => {
    const res = await get('latest')
    expect(res.status).toBe(200)
    expect(mocks.evaluateEditorialReadiness).toHaveBeenCalled()
  })

  it('distinguishes database failure with 503', async () => {
    failedTable = 'content_items'
    const res = await get()
    expect(res.status).toBe(503)
  })

  it('evaluates 3 confirmed images from editorBlocks as ASSESSED on IMAGE_RIGHTS_AND_CTA dimension', async () => {
    mocks.evaluateEditorialReadiness.mockImplementation((input) => mocks.actualEvaluate.fn(input))
    const payload = (rows.content_versions[0].structured_payload as Record<string, unknown>)
    payload.editorBlocks = [
      { kind: 'image', mediaId: 'img-1', altText: '피부 관리 장면 1' },
      { kind: 'paragraph', text: '중간 설명 문구입니다.' },
      { kind: 'image', mediaId: 'img-2', altText: '피부 관리 장면 2' },
      { kind: 'image', mediaId: 'img-3', altText: '피부 관리 장면 3' },
    ]
    rows.media_assets = [
      { id: 'img-1', workspace_id: WORKSPACE, rights_status: 'confirmed', provenance_kind: 'LEGACY_UNKNOWN', generation_metadata: null },
      { id: 'img-2', workspace_id: WORKSPACE, rights_status: 'confirmed', provenance_kind: 'LEGACY_UNKNOWN', generation_metadata: null },
      { id: 'img-3', workspace_id: WORKSPACE, rights_status: 'confirmed', provenance_kind: 'LEGACY_UNKNOWN', generation_metadata: null },
    ]

    const res = await get()
    expect(res.status).toBe(200)
    const json = await res.json()
    const imageDimension = json.dimensions.find((d: { key: string }) => d.key === 'IMAGE_RIGHTS_AND_CTA')
    expect(imageDimension).toBeDefined()
    expect(imageDimension.status).toBe('ASSESSED')
    expect(mocks.evaluateEditorialReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          { sourceKind: 'OWNER_UPLOAD', rightsStatus: 'CONFIRMED', altText: '피부 관리 장면 1', aiLabeled: undefined },
          { sourceKind: 'OWNER_UPLOAD', rightsStatus: 'CONFIRMED', altText: '피부 관리 장면 2', aiLabeled: undefined },
          { sourceKind: 'OWNER_UPLOAD', rightsStatus: 'CONFIRMED', altText: '피부 관리 장면 3', aiLabeled: undefined },
        ],
      }),
    )
  })

  it('evaluates reader questions from query param q as ASSESSED on READER_QUESTION_COVERAGE dimension', async () => {
    mocks.evaluateEditorialReadiness.mockImplementation((input) => mocks.actualEvaluate.fn(input))
    const res = await get(
      CONTENT_ID,
      WORKSPACE,
      '?q=%20피부%20관리%20시간은%20얼마나%20걸리나요?%20&q=보습%20관리는%20어떻게%20하나요?&q=',
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    const rqDimension = json.dimensions.find((d: { key: string }) => d.key === 'READER_QUESTION_COVERAGE')
    expect(rqDimension).toBeDefined()
    expect(rqDimension.status).toBe('ASSESSED')
    expect(mocks.evaluateEditorialReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        readerQuestions: ['피부 관리 시간은 얼마나 걸리나요?', '보습 관리는 어떻게 하나요?'],
      }),
    )
  })

  it('evaluates 0 image blocks in editorBlocks as text-only manuscript (images: [], ASSESSED)', async () => {
    mocks.evaluateEditorialReadiness.mockImplementation((input) => mocks.actualEvaluate.fn(input))
    const payload = (rows.content_versions[0].structured_payload as Record<string, unknown>)
    payload.editorBlocks = [
      { kind: 'header', text: '제목' },
      { kind: 'paragraph', text: '이미지 없는 텍스트 전용 글입니다.' },
    ]

    const res = await get()
    expect(res.status).toBe(200)
    const json = await res.json()
    const imageDimension = json.dimensions.find((d: { key: string }) => d.key === 'IMAGE_RIGHTS_AND_CTA')
    expect(imageDimension).toBeDefined()
    expect(imageDimension.status).toBe('ASSESSED')
    expect(mocks.evaluateEditorialReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [],
      }),
    )
  })

  it('leaves IMAGE_RIGHTS_AND_CTA as NOT_ASSESSED when media asset lookup fails completely', async () => {
    mocks.evaluateEditorialReadiness.mockImplementation((input) => mocks.actualEvaluate.fn(input))
    const payload = (rows.content_versions[0].structured_payload as Record<string, unknown>)
    payload.editorBlocks = [
      { kind: 'image', mediaId: 'img-missing', altText: '누락된 이미지' },
    ]
    rows.media_assets = [] // no matching asset

    const res = await get()
    expect(res.status).toBe(200)
    const json = await res.json()
    const imageDimension = json.dimensions.find((d: { key: string }) => d.key === 'IMAGE_RIGHTS_AND_CTA')
    expect(imageDimension).toBeDefined()
    expect(imageDimension.status).toBe('NOT_ASSESSED')
    expect(mocks.evaluateEditorialReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        images: undefined,
      }),
    )
  })

  it('evaluates AI illustrations with disclosure labeling', async () => {
    mocks.evaluateEditorialReadiness.mockImplementation((input) => mocks.actualEvaluate.fn(input))
    const payload = (rows.content_versions[0].structured_payload as Record<string, unknown>)
    payload.disclosure = '생성형 AI로 작성된 이미지 및 글입니다.'
    payload.editorBlocks = [
      { kind: 'image', mediaId: 'img-ai-1', altText: 'AI 생성 이미지 1' },
      { kind: 'image', mediaId: 'img-ai-2', altText: 'AI 생성 이미지 2' },
    ]
    rows.media_assets = [
      { id: 'img-ai-1', workspace_id: WORKSPACE, rights_status: 'confirmed', provenance_kind: 'AI_GENERATED', generation_metadata: null },
      { id: 'img-ai-2', workspace_id: WORKSPACE, rights_status: 'confirmed', provenance_kind: 'USER_UPLOAD', generation_metadata: { prompt: '피부 모델' } },
    ]

    const res = await get()
    expect(res.status).toBe(200)
    expect(mocks.evaluateEditorialReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          { sourceKind: 'AI_ILLUSTRATION', rightsStatus: 'CONFIRMED', altText: 'AI 생성 이미지 1', aiLabeled: true },
          { sourceKind: 'AI_ILLUSTRATION', rightsStatus: 'CONFIRMED', altText: 'AI 생성 이미지 2', aiLabeled: true },
        ],
      }),
    )
  })

  it('excludes missing media assets and preserves only successfully resolved assets without defaulting to UNCONFIRMED', async () => {
    mocks.evaluateEditorialReadiness.mockImplementation((input) => mocks.actualEvaluate.fn(input))
    const payload = (rows.content_versions[0].structured_payload as Record<string, unknown>)
    payload.editorBlocks = [
      { kind: 'image', mediaId: 'img-found', altText: '존재하는 이미지' },
      { kind: 'image', mediaId: 'img-missing', altText: '누락된 이미지' },
    ]
    rows.media_assets = [
      { id: 'img-found', workspace_id: WORKSPACE, rights_status: 'confirmed', provenance_kind: 'LEGACY_UNKNOWN', generation_metadata: null },
    ]

    const res = await get()
    expect(res.status).toBe(200)
    expect(mocks.evaluateEditorialReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          { sourceKind: 'OWNER_UPLOAD', rightsStatus: 'CONFIRMED', altText: '존재하는 이미지', aiLabeled: undefined },
        ],
      }),
    )
  })

  it('limits reader questions from q query params to 5 and trims/filters length (1..200)', async () => {
    mocks.evaluateEditorialReadiness.mockImplementation((input) => mocks.actualEvaluate.fn(input))
    const tooLong = 'a'.repeat(201)
    const search = `?q=q1&q=q2&q=&q=   &q=${tooLong}&q=q3&q=q4&q=q5&q=q6`
    const res = await get(CONTENT_ID, WORKSPACE, search)
    expect(res.status).toBe(200)
    expect(mocks.evaluateEditorialReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        readerQuestions: ['q1', 'q2', 'q3', 'q4', 'q5'],
      }),
    )
  })
})
