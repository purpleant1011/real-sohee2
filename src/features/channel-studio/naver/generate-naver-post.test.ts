import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  generateNaverBlogPost,
  NaverPostGenerationError,
  deterministicUuid,
  normalizeHashtags,
  enrichLocalSeoKeywords,
  type GenerateNaverBlogPostDependencies,
  type NaverPostJobStore,
  type JobClaimResult,
} from './generate-naver-post'
import type { NaverBlogDraft } from '@/features/chat/naver-blog-draft-provider'
import type { InstagramGenerationContext } from '@/features/auth/workspace-context'
import type { QuickPostReservation } from '@/features/quick-start/quick-post-credits'
import { marketingStrategyFixture } from '@/features/content/blog-strategy-brief.fixture'
import { buildBlogStrategyBrief } from '@/features/content/blog-strategy-brief'

function createFakeCreditGateway(initialCredits = 3000) {
  let available = initialCredits
  const reservations = new Map<string, {
    reservationId: string
    state: 'reserved' | 'settled' | 'released'
    credits: number
    scope: 'text' | 'image'
    operationKey: string
  }>()

  return {
    getAvailable: () => available,
    getReservations: () => Array.from(reservations.values()),
    reserve: vi.fn(async (_ws: string, requestKey: string, scope: 'text' | 'image') => {
      // F1: EXACT DB contract from 20261009030000_signup_600_verified_plus_1000.sql:366-369
      // text MUST be exactly 100 credits, image MUST be exactly 150 credits.
      const expectedCost = scope === 'text' ? 100 : 150
      const operationKey = `quick-post:${requestKey}:1:${scope}`
      const existing = reservations.get(operationKey)
      if (existing) {
        if (existing.credits !== expectedCost) {
          throw new Error('QUICK_POST_CREDIT_IDEMPOTENCY_CONFLICT')
        }
        return {
          reservationId: existing.reservationId,
          state: existing.state,
          requestedCredits: existing.credits,
          operationKey: existing.operationKey,
          isReplay: true,
        }
      }
      if (available < expectedCost) {
        throw new NaverPostGenerationError('CREDIT_INSUFFICIENT', `사장님 크레딧이 부족해요. 필요 ${expectedCost} / 보유 ${available}`, 402)
      }
      available -= expectedCost
      const res = {
        reservationId: `res-${scope}-${requestKey}`,
        state: 'reserved' as const,
        credits: expectedCost,
        scope,
        operationKey,
      }
      reservations.set(operationKey, res)
      return {
        ...res,
        requestedCredits: expectedCost,
        isReplay: false,
      }
    }),
    settle: vi.fn(async (_ws: string, reservation: QuickPostReservation) => {
      const row = reservations.get(reservation.operationKey)
      if (!row || row.state === 'released') {
        throw new Error('QUICK_POST_CREDIT_RESERVATION_STALE')
      }
      row.state = 'settled'
    }),
    release: vi.fn(async (_ws: string, reservation: QuickPostReservation) => {
      const row = reservations.get(reservation.operationKey)
      if (!row || row.state === 'settled') {
        throw new Error('QUICK_POST_CREDIT_RESERVATION_STALE')
      }
      if (row.state === 'reserved') {
        row.state = 'released'
        available += row.credits
      }
    }),
  }
}

function createFakeJobStore(): NaverPostJobStore & {
  jobs: Map<string, { status: 'running' | 'succeeded' | 'failed'; contentId?: string; versionId?: string; creditReconcileNeeded?: boolean }>
} {
  const jobs = new Map<string, { status: 'running' | 'succeeded' | 'failed'; contentId?: string; versionId?: string; creditReconcileNeeded?: boolean }>()
  return {
    jobs,
    claim: vi.fn(async (workspaceId: string, requestKey: string): Promise<JobClaimResult> => {
      const key = `${workspaceId}:${requestKey}`
      const existing = jobs.get(key)
      if (existing) {
        if (existing.status === 'running') {
          return { kind: 'running' as const, jobId: `job-${requestKey}` }
        }
        if (existing.status === 'succeeded' && existing.contentId && existing.versionId) {
          return { kind: 'succeeded' as const, jobId: `job-${requestKey}`, contentId: existing.contentId, versionId: existing.versionId }
        }
        if (existing.status === 'failed' && !existing.versionId) {
          existing.status = 'running'
          return { kind: 'acquired' as const, jobId: `job-${requestKey}` }
        }
      }
      jobs.set(key, { status: 'running' })
      return { kind: 'acquired' as const, jobId: `job-${requestKey}` }
    }),
    complete: vi.fn(async (workspaceId: string, requestKey: string, contentId: string, versionId: string, creditReconcileNeeded = false) => {
      const key = `${workspaceId}:${requestKey}`
      jobs.set(key, { status: 'succeeded', contentId, versionId, creditReconcileNeeded })
    }),
    fail: vi.fn(async (workspaceId: string, requestKey: string, creditReconcileNeeded = false) => {
      const key = `${workspaceId}:${requestKey}`
      const existing = jobs.get(key)
      jobs.set(key, { status: 'failed', contentId: existing?.contentId, versionId: existing?.versionId, creditReconcileNeeded })
    }),
  }
}

describe('generateNaverBlogPost', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const userId = '20000000-0000-4000-8000-000000000001'
  const requestKey = '30000000-0000-4000-8000-000000000001'
  const contentId = '40000000-0000-4000-8000-000000000001'
  const versionId = '50000000-0000-4000-8000-000000000001'

  const mockContext: InstagramGenerationContext = {
    businessName: '태양세무회계',
    industry: '세무',
    location: '서울',
    businessSummary: '전문 세무사',
    brandVoice: '신뢰감 있는',
    keywords: ['세무'],
    prohibitedTerms: [],
    ownedKnowledgeSources: [],
  }

  const mockDraft: NaverBlogDraft = {
    title: '종합소득세 절세 가이드',
    introduction: '5월 종합소득세 신고 시 꼭 알아야 할 팁을 공유합니다.',
    sections: [
      { heading: '공제 항목 확인', body: '누락되기 쉬운 공제 항목을 꼼꼼히 점검하세요.' },
      { heading: '신고 기한 준수', body: '기한 내 신고하여 가산세를 방지하세요.' },
    ],
    editorBlueprint: [
      { kind: 'heading', text: '종합소득세 절세 가이드' },
      { kind: 'paragraph', text: '5월 종합소득세 신고 시 꼭 알아야 할 팁을 공유합니다.' },
      { kind: 'image_slot', position: 1, altText: '세무 상담 표지' },
      { kind: 'paragraph', text: '누락되기 쉬운 공제 항목을 꼼꼼히 점검하세요.' },
      { kind: 'image_slot', position: 2, altText: '공제 서류 검토' },
      { kind: 'paragraph', text: '기한 내 신고하여 가산세를 방지하세요.' },
      { kind: 'image_slot', position: 3, altText: '세무 신고 달력' },
      { kind: 'quote', text: '전문 세무 상담으로 안전하게 절세하세요.' },
      { kind: 'cta', text: '상담 문의하기' },
      { kind: 'link', url: 'https://tax-example.com', title: '세무사 상담실' },
    ],
    keywords: ['#종합소득세', '절세', '  #세무상담  ', '#'],
    cta: '상담 문의하기',
    disclosure: '',
    observations: [],
    limitations: [],
    evidence: [],
    unresolvedQuestions: [],
    visibility: 'public',
  }

  let creditGateway: ReturnType<typeof createFakeCreditGateway>
  let jobStore: ReturnType<typeof createFakeJobStore>
  let mockDeps: GenerateNaverBlogPostDependencies
  let generatedImagePrompts: string[]
  let fakeUserClient: any

  beforeEach(() => {
    creditGateway = createFakeCreditGateway(2000)
    jobStore = createFakeJobStore()
    generatedImagePrompts = []

    fakeUserClient = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: userId } }, error: null })) },
      from: vi.fn(),
      rpc: vi.fn(),
    }

    mockDeps = {
      findExisting: vi.fn(async () => null),
      loadContext: vi.fn(async () => mockContext),
      loadApprovedFacts: vi.fn(async () => ({ workspaceId, resolvedAt: '2026-10-28T00:00:00Z', hash: 'empty', facts: [] })),
      generateDraft: vi.fn(async () => mockDraft),
      generateImage: vi.fn(async (input) => {
        generatedImagePrompts.push(input.prompt)
        const id = `60000000-0000-4000-8000-${String(generatedImagePrompts.length).padStart(12, '0')}`
        return { id, title: `이미지 ${generatedImagePrompts.length}` }
      }),
      createItem: vi.fn(async () => ({ data: { contentId, next: `/app/work/${contentId}/edit` } })),
      createVersion: vi.fn(async () => ({
        data: {
          versionId,
          versionNumber: 1,
          fingerprint: 'f'.repeat(64),
        },
      })),
      credits: creditGateway as any,
      jobStore,
      userClient: fakeUserClient,
      checkClaims: vi.fn(() => ({ status: 'OK' as const, issues: [] })),
      loadPlacePhotos: vi.fn(async () => [
        'https://ldb-phinf.pstatic.net/test1.jpg',
        'https://ldb-phinf.pstatic.net/test2.jpg',
        'https://ldb-phinf.pstatic.net/test3.jpg',
      ]),
      storePlacePhoto: vi.fn(async (input) => {
        return { id: `70000000-0000-4000-8000-${input.imageUrl.slice(-5)}`, title: input.title }
      }),
    }
  })

  it('passes approved evidence to both initial and corrective writing requests', async () => {
    mockDeps.loadApprovedFacts = vi.fn(async () => ({
      workspaceId, resolvedAt: '2026-10-28T00:00:00Z', hash: 'approved-service', facts: [{
        id: 'fact-1', workspace_id: workspaceId, category: 'service', content: '상담은 사전 문의 후 진행합니다.',
        status: 'active', source_candidate_id: 'source-1', approved_by_user_id: userId,
        approved_at: '2026-10-27T00:00:00Z', valid_from: '2026-10-27T00:00:00Z', valid_until: null,
        supersedes_fact_id: null, created_at: '2026-10-27T00:00:00Z',
      }],
    }))
    mockDeps.checkClaims = vi.fn()
      .mockReturnValueOnce({ status: 'UNKNOWN', issues: ['검토 필요'] })
      .mockReturnValue({ status: 'OK', issues: [] })
    await generateNaverBlogPost({ workspaceId, userId, topic: '매장 안내', imageCount: 3, requestKey, deps: mockDeps })
    expect(vi.mocked(mockDeps.createVersion!).mock.calls[0]?.[1]).toMatchObject({
      structuredPayload: { factBasis: { provenance: [{
        factId: 'fact-1', sourceType: 'owner_approved_fact', sourceSpan: '상담은 사전 문의 후 진행합니다.',
        ownerApproval: { approvedByUserId: userId, approvedAt: '2026-10-27T00:00:00Z' },
      }] } },
    })
    expect(mockDeps.generateDraft).toHaveBeenCalledTimes(2)
    for (const [request] of vi.mocked(mockDeps.generateDraft!).mock.calls) {
      expect(request).toHaveProperty('approvedFacts', [{ category: 'service', content: '상담은 사전 문의 후 진행합니다.' }])
    }
  })

  it('재작성 요청에는 첫 초안에서 지적된 문제를 알려 준다(원고 본문 제외)', async () => {
    mockDeps.checkClaims = vi.fn()
      .mockReturnValueOnce({ status: 'UNKNOWN', issues: ['확인된 영업시간이 없어 영업시간 문구를 쓸 수 없어요.'] })
      .mockReturnValue({ status: 'OK', issues: [] })
    await generateNaverBlogPost({ workspaceId, userId, topic: '매장 안내', imageCount: 3, requestKey, deps: mockDeps })
    const retryPrompt = String(vi.mocked(mockDeps.generateDraft!).mock.calls[1]?.[0]?.prompt)
    expect(retryPrompt).toContain('지적된 문제: 확인된 영업시간이 없어 영업시간 문구를 쓸 수 없어요.')
  })

  it('rejects cross-workspace fact evidence before the initial writing request', async () => {
    mockDeps.loadApprovedFacts = vi.fn(async () => ({ workspaceId: userId, resolvedAt: '2026-10-28T00:00:00Z', hash: 'other', facts: [] }))
    await expect(generateNaverBlogPost({ workspaceId, userId, topic: '매장 안내', imageCount: 3, requestKey, deps: mockDeps }))
      .rejects.toMatchObject({ code: 'CONTEXT_UNAVAILABLE' })
    expect(mockDeps.generateDraft).not.toHaveBeenCalled()
    expect(mockDeps.generateImage).not.toHaveBeenCalled()
  })

  it('fails closed when approved facts cannot be read before generating a draft', async () => {
    mockDeps.loadApprovedFacts = vi.fn(async () => { throw new Error('FACT_READ_FAILED') })
    await expect(generateNaverBlogPost({ workspaceId, userId, topic: '매장 안내', imageCount: 3, requestKey, deps: mockDeps }))
      .rejects.toMatchObject({ code: 'CONTEXT_UNAVAILABLE' })
    expect(mockDeps.generateDraft).not.toHaveBeenCalled()
    expect(mockDeps.generateImage).not.toHaveBeenCalled()
    expect(mockDeps.createItem).not.toHaveBeenCalled()
  })

  it('refuses to save if approved facts change while images are generated', async () => {
    mockDeps.generateImage = vi.fn(async () => {
      mockDeps.loadApprovedFacts = vi.fn(async () => ({ workspaceId, resolvedAt: '2026-10-28T00:01:00Z', hash: 'changed', facts: [] }))
      return { id: '60000000-0000-4000-8000-000000000001', title: '표지' }
    })
    await expect(generateNaverBlogPost({ workspaceId, userId, topic: '매장 안내', imageCount: 3, requestKey, deps: mockDeps }))
      .rejects.toThrow('FACT_SNAPSHOT_STALE')
    expect(mockDeps.createItem).not.toHaveBeenCalled()
  })

  it.each([
    ['커트 1.5만원', '커트 5만원'],
    ['커트 10만5천원', '커트 5천원'],
    ['커트 ₩1.5', '커트 ₩1'],
    ['커트 5원', '커트 1.5원'],
    ['커트 5k', '커트 1.5k'],
  ])('blocks altered final prices before images and persistence: %s', async (text, content) => {
    mockDeps.loadApprovedFacts = vi.fn(async () => ({
      workspaceId, resolvedAt: '2026-10-28T00:00:00Z', hash: 'approved-price', facts: [{
        id: 'price-1', workspace_id: workspaceId, category: 'PRICE', content,
        status: 'active', source_candidate_id: 'source-1', approved_by_user_id: userId,
        approved_at: '2026-10-27T00:00:00Z', valid_from: '2026-10-27T00:00:00Z', valid_until: null,
        supersedes_fact_id: null, created_at: '2026-10-27T00:00:00Z',
      }],
    }))
    mockDeps.generateDraft = vi.fn(async () => ({ ...mockDraft, introduction: text }))
    await expect(generateNaverBlogPost({ workspaceId, userId, topic: '매장 안내', imageCount: 3, requestKey, deps: mockDeps }))
      .rejects.toMatchObject({ code: 'CLAIMS_NEED_REVIEW' })
    expect(mockDeps.generateImage).not.toHaveBeenCalled()
    expect(mockDeps.createItem).not.toHaveBeenCalled()
    expect(mockDeps.createVersion).not.toHaveBeenCalled()
  })

  it('does not let aggregate profile ratings authorize an unsupported final claim', async () => {
    mockDeps.generateDraft = vi.fn(async () => ({ ...mockDraft, introduction: '방문자 평점 4.98점' }))
    await expect(generateNaverBlogPost({ workspaceId, userId, topic: '매장 안내', imageCount: 3, requestKey, deps: mockDeps }))
      .rejects.toMatchObject({ code: 'CLAIMS_NEED_REVIEW' })
    expect(mockDeps.generateImage).not.toHaveBeenCalled()
    expect(mockDeps.createItem).not.toHaveBeenCalled()
  })

  it.each(['외부 음식 반입 금지', '금지: 외부 음식 반입, 반려동물 동반'])('blocks draft containing approved PROHIBITED terms before buying images: %s', async content => {
    mockDeps.loadApprovedFacts = vi.fn(async () => ({
      workspaceId, resolvedAt: '2026-10-28T00:00:00Z', hash: 'approved-prohibited', facts: [{
        id: 'prohibited-1', workspace_id: workspaceId, category: 'PROHIBITED', content,
        status: 'active', source_candidate_id: 'source-1', approved_by_user_id: userId,
        approved_at: '2026-10-27T00:00:00Z', valid_from: '2026-10-27T00:00:00Z', valid_until: null,
        supersedes_fact_id: null, created_at: '2026-10-27T00:00:00Z',
      }],
    }))
    mockDeps.generateDraft = vi.fn(async () => ({ ...mockDraft, introduction: '외부 음식 반입 가능합니다' }))
    await expect(generateNaverBlogPost({ workspaceId, userId, topic: '매장 안내', imageCount: 3, requestKey, deps: mockDeps }))
      .rejects.toMatchObject({ code: 'CLAIMS_NEED_REVIEW' })
    expect(mockDeps.generateImage).not.toHaveBeenCalled()
    expect(mockDeps.createItem).not.toHaveBeenCalled()
    expect(mockDeps.createVersion).not.toHaveBeenCalled()
  })

  it('F1 & F4: reserves 1 text hold (100 SC) + 1 hold per image (150 SC), settles each image as stored, and completes job', async () => {
    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '종합소득세 절세 방법',
      imageCount: 3,
      requestKey,
      deps: mockDeps,
    })

    expect(result).toEqual({
      contentId,
      versionId,
      versionNumber: 1,
      fingerprint: 'f'.repeat(64),
      title: '종합소득세 절세 가이드',
      imageCount: 3,
    })

    // F1: Total 4 distinct reservations: 1 text (100) + 3 images (150 each)
    const reservations = creditGateway.getReservations()
    expect(reservations).toHaveLength(4)
    expect(creditGateway.reserve).toHaveBeenCalledTimes(4)

    const textRes = reservations.find((r) => r.scope === 'text')!
    expect(textRes.credits).toBe(100)
    expect(textRes.state).toBe('settled')
    expect(textRes.operationKey).toBe(`quick-post:${deterministicUuid(`${requestKey}:text`)}:1:text`)

    const imageReservations = reservations.filter((r) => r.scope === 'image')
    expect(imageReservations).toHaveLength(3)
    for (let i = 0; i < 3; i++) {
      expect(imageReservations[i].credits).toBe(150)
      expect(imageReservations[i].state).toBe('settled')
      expect(imageReservations[i].operationKey).toBe(`quick-post:${deterministicUuid(`${requestKey}:image:${i}`)}:1:image`)
    }

    // All settled, none released
    expect(creditGateway.settle).toHaveBeenCalledTimes(4)
    expect(creditGateway.release).not.toHaveBeenCalled()

    // F3: Job marked succeeded
    expect(jobStore.complete).toHaveBeenCalledWith(workspaceId, requestKey, contentId, versionId, false)

    // F8: createItem and createVersion were called with userClient
    expect(mockDeps.createItem).toHaveBeenCalledWith(fakeUserClient, expect.anything())
    expect(mockDeps.createVersion).toHaveBeenCalledWith(fakeUserClient, expect.anything())

    // F9: hashtags normalized before saving
    expect(mockDeps.createVersion).toHaveBeenCalledWith(
      fakeUserClient,
      expect.objectContaining({
        hashtags: expect.arrayContaining(['#종합소득세', '#절세', '#세무상담']),
      }),
    )
  })

  it('F1 regression: fake reservation gateway strictly enforces 100 SC for text and 150 SC for image', async () => {
    // Calling with non-150 for image must fail
    await expect(creditGateway.reserve(workspaceId, 'test-key', 'image' as any)).resolves.toMatchObject({
      requestedCredits: 150,
    })
    await expect(creditGateway.reserve(workspaceId, 'test-key-2', 'text' as any)).resolves.toMatchObject({
      requestedCredits: 100,
    })
  })

  it('F3: existing running job throws IN_PROGRESS (409) with friendly Korean message', async () => {
    jobStore.claim = vi.fn(async (): Promise<JobClaimResult> => ({ kind: 'running' as const, jobId: 'job-1' }))

    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '종합소득세 절세 방법',
        imageCount: 3,
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({
      code: 'IN_PROGRESS',
      status: 409,
      message: '이미 글을 만들고 있어요. 잠시만 기다려 주세요.',
    })

    expect(creditGateway.reserve).not.toHaveBeenCalled()
    expect(mockDeps.generateDraft).not.toHaveBeenCalled()
  })

  it('F3: existing succeeded job returns stored IDs without regenerating or recharging', async () => {
    jobStore.claim = vi.fn(async (): Promise<JobClaimResult> => ({
      kind: 'succeeded' as const,
      jobId: 'job-1',
      contentId: 'existing-content-id',
      versionId: 'existing-version-id',
    }))
    mockDeps.findExisting = vi.fn(async () => ({
      contentId: 'existing-content-id',
      versionId: 'existing-version-id',
      versionNumber: 2,
      fingerprint: 'a'.repeat(64),
      title: '기존 글 제목',
      imageCount: 3,
    }))

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '종합소득세 절세 방법',
      imageCount: 3,
      requestKey,
      deps: mockDeps,
    })

    expect(result.contentId).toBe('existing-content-id')
    expect(result.versionId).toBe('existing-version-id')
    expect(creditGateway.reserve).not.toHaveBeenCalled()
    expect(mockDeps.generateDraft).not.toHaveBeenCalled()
  })

  describe('실제 단계 기록(recordStage)', () => {
    const run = (deps: GenerateNaverBlogPostDependencies, imageCount = 3) =>
      generateNaverBlogPost({ workspaceId, userId, topic: '종합소득세 절세 방법', imageCount, requestKey, deps })

    it('초안 검수 통과 후와 이미지 전부 저장 후에만 verified를 기록한다', async () => {
      const facts: any[] = []
      mockDeps.recordStage = vi.fn(async (fact) => { facts.push(fact) })
      await run(mockDeps)
      expect(facts.map((f) => `${f.stage}:${f.status}`)).toEqual([
        'draft_writing:started', 'draft_writing:verified', 'image_generation:started', 'image_generation:verified',
      ])
      expect(facts[3].coverage).toEqual({ covered: 3, total: 3 })
      expect(new Set(facts.map((f) => f.dedupeKey)).size).toBe(4)
      expect(JSON.stringify(facts)).not.toMatch(/종합소득세|userId|prompt/)
    })

    it('이미지 중간 실패는 저장된 수만큼 partial, 하나도 없으면 failed로 기록하고 원래 오류를 유지한다', async () => {
      for (const [failAt, expected] of [[2, 'partial'], [1, 'failed']] as const) {
        const facts: any[] = []
        let calls = 0
        mockDeps.recordStage = vi.fn(async (fact) => { facts.push(fact) })
        mockDeps.generateImage = vi.fn(async () => {
          if (++calls === failAt) throw new Error('provider')
          return { id: `img-${calls}`, title: 'x' }
        })
        await expect(run(mockDeps)).rejects.toThrow(NaverPostGenerationError)
        const last = facts.at(-1)
        expect(last).toMatchObject({ stage: 'image_generation', status: expected })
        if (expected === 'partial') expect(last.coverage).toEqual({ covered: 1, total: 3 })
        expect(facts.some((f) => f.stage === 'image_generation' && f.status === 'verified')).toBe(false)
      }
    })

    it('초안 작성 실패는 draft_writing failed로 기록한다', async () => {
      const facts: any[] = []
      mockDeps.recordStage = vi.fn(async (fact) => { facts.push(fact) })
      mockDeps.generateDraft = vi.fn(async () => { throw new Error('model down') })
      await expect(run(mockDeps)).rejects.toThrow(NaverPostGenerationError)
      expect(facts.map((f) => `${f.stage}:${f.status}`)).toEqual(['draft_writing:started', 'draft_writing:failed'])
    })

    it('기록 저장이 실패해도 글 생성과 크레딧 정산은 영향받지 않는다', async () => {
      mockDeps.recordStage = vi.fn(async () => { throw new Error('ledger down') })
      await expect(run(mockDeps)).resolves.toMatchObject({ imageCount: 3 })
      expect(creditGateway.release).not.toHaveBeenCalled()
    })
  })

  it('F1 & F4: image generation failure releases unused reservations and marks job failed', async () => {
    let callCount = 0
    mockDeps.generateImage = vi.fn(async () => {
      callCount += 1
      if (callCount === 2) {
        throw new Error('Image provider failed')
      }
      return { id: `img-${callCount}`, title: `이미지 ${callCount}` }
    })

    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '종합소득세 절세 방법',
        imageCount: 3,
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toThrow(NaverPostGenerationError)

    // Image 0 was stored and settled (150 SC consumed for the stored artifact)
    // Text reservation and remaining image reservations (slot 1 and 2) must be released!
    const reservations = creditGateway.getReservations()
    const textRes = reservations.find((r) => r.scope === 'text')!
    expect(textRes.state).toBe('released')

    const img0 = reservations.find((r) => r.operationKey.includes(deterministicUuid(`${requestKey}:image:0`)))!
    expect(img0).toBeDefined()
    expect(img0.state).toBe('settled')

    const img1 = reservations.find((r) => r.operationKey.includes(deterministicUuid(`${requestKey}:image:1`)))!
    expect(img1).toBeDefined()
    expect(img1.state).toBe('released')

    const img2 = reservations.find((r) => r.operationKey.includes(deterministicUuid(`${requestKey}:image:2`)))!
    expect(img2).toBeDefined()
    expect(img2.state).toBe('released')

    expect(jobStore.fail).toHaveBeenCalledWith(workspaceId, requestKey, false)
    expect(mockDeps.createItem).not.toHaveBeenCalled()
  })

  it('F4: signal cancellation aborts between slots and releases remaining holds', async () => {
    const controller = new AbortController()
    let slotCount = 0
    mockDeps.generateImage = vi.fn(async () => {
      slotCount += 1
      if (slotCount === 1) {
        controller.abort() // abort after first image
      }
      return { id: `img-${slotCount}`, title: `이미지 ${slotCount}` }
    })

    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '종합소득세 절세 방법',
        imageCount: 3,
        requestKey,
        signal: controller.signal,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({
      code: 'IMAGES_INCOMPLETE',
    })

    const reservations = creditGateway.getReservations()
    const textRes = reservations.find((r) => r.scope === 'text')!
    expect(textRes.state).toBe('released')

    const img1 = reservations.find((r) => r.operationKey.includes(deterministicUuid(`${requestKey}:image:1`)))!
    expect(img1).toBeDefined()
    expect(img1.state).toBe('released')

    expect(jobStore.fail).toHaveBeenCalled()
  })

  it('F4: never refund credits for a version that was saved, even if text settlement warns', async () => {
    // Settle for text fails
    creditGateway.settle = vi.fn(async (_ws, res) => {
      if (res.operationKey.includes('text')) {
        throw new Error('Settlement timeout')
      }
    })

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '종합소득세 절세 방법',
      imageCount: 3,
      requestKey,
      deps: mockDeps,
    })

    // Succeeded result returned
    expect(result.versionId).toBe(versionId)
    // Job completed with creditReconcileNeeded = true
    expect(jobStore.complete).toHaveBeenCalledWith(workspaceId, requestKey, contentId, versionId, true)
    // Never released
    expect(creditGateway.release).not.toHaveBeenCalled()
  })

  it('F8: missing userClient aborts before any credit reservation with AUTH_REQUIRED (401)', async () => {
    mockDeps.userClient = undefined

    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '종합소득세 절세 방법',
        imageCount: 3,
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      status: 401,
      message: '로그인 세션을 확인하지 못했습니다.',
    })

    expect(creditGateway.reserve).not.toHaveBeenCalled()
    expect(jobStore.claim).not.toHaveBeenCalled()
  })

  it('F6: applies industry-neutral sentence for non-Byreum business without eyebrow/beauty scenes', async () => {
    await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '세무 신고 안내',
      imageCount: 3,
      requestKey,
      deps: mockDeps,
    })

    expect(generatedImagePrompts).toHaveLength(3)
    for (const prompt of generatedImagePrompts) {
      expect(prompt).toContain('텍스트와 이미지가 본문 내용 및 주제와 자연스럽게 이어져야 합니다.')
      expect(prompt).not.toContain('바이름')
      expect(prompt).not.toContain('눈썹 반영구')
    }
  })

  it('F6 regression: Byreum business uses the exact fixed historical prompt sentence', async () => {
    mockDeps.loadContext = vi.fn(async () => ({
      ...mockContext,
      businessName: '스튜디오 바이름',
      industry: '반영구 화장',
    }))

    await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '자연스러운 눈썹 디자인',
      imageCount: 3,
      requestKey,
      deps: mockDeps,
    })

    // F6: Must contain the fixed historical sentence from commit history
    const expectedHistoricalSentence = '텍스트와 이미지가 같은 바이름 눈썹 반영구 상담 이야기로 이어져야 합니다.'
    expect(generatedImagePrompts[0]).toContain(expectedHistoricalSentence)
  })

  it('F7: draft with unconfirmed price/claims triggers 1 retry; if clean, proceeds', async () => {
    let draftCall = 0
    mockDeps.generateDraft = vi.fn(async () => {
      draftCall += 1
      if (draftCall === 1) {
        return {
          ...mockDraft,
          sections: [{ heading: '할인 이벤트', body: '아메리카노 1,000원에 50% 할인 제공!' }],
        }
      }
      return mockDraft
    })

    let claimCall = 0
    mockDeps.checkClaims = vi.fn(() => {
      claimCall += 1
      if (claimCall === 1) {
        return { status: 'UNKNOWN' as const, issues: ['확인된 가격 정보가 없어 가격 문구를 사용할 수 없어요.'] }
      }
      return { status: 'OK' as const, issues: [] }
    })

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '커피 할인 안내',
      imageCount: 3,
      requestKey,
      deps: mockDeps,
    })

    expect(result.versionId).toBe(versionId)
    expect(draftCall).toBe(2) // 1st try + 1 retry
    expect(claimCall).toBe(3) // draft, retry, materialized payload
    expect(mockDeps.generateImage).toHaveBeenCalledTimes(3)
  })

  it('F7: draft flagged again on retry self-heals ungrounded claims and proceeds successfully without failing', async () => {
    let capturedVersionPayload: any = null
    mockDeps.createVersion = vi.fn(async (_client, input: any) => {
      capturedVersionPayload = input.structuredPayload
      return {
        data: {
          versionId,
          versionNumber: 1,
          fingerprint: 'f'.repeat(64),
        },
      }
    })

    mockDeps.generateDraft = vi.fn(async () => ({
      ...mockDraft,
      title: '50% 할인 이벤트 및 완치 효능',
      sections: [{ heading: '최고의 10000원 특가', body: '부작용없는 완치 케어' }],
    }))

    // Use the real guard: successful sanitization must pass a fresh check.
    mockDeps.checkClaims = undefined

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '피부 재생 효능 안내',
      imageCount: 3,
      requestKey,
      deps: mockDeps,
    })

    // Succeeded without throwing 422!
    expect(result.versionId).toBe(versionId)
    expect(mockDeps.generateImage).toHaveBeenCalledTimes(3)
    expect(capturedVersionPayload.title).not.toContain('50%')
    expect(capturedVersionPayload.title).not.toContain('할인')
    expect(capturedVersionPayload.sections[0].heading).not.toContain('10000원')
    expect(capturedVersionPayload.sections[0].body).not.toContain('완치')
  })

  it('checks claims in editor blocks even when legacy sections are safe', async () => {
    mockDeps.checkClaims = undefined
    mockDeps.generateDraft = vi.fn(async () => ({
      ...mockDraft,
      editorBlueprint: [
        { kind: 'paragraph' as const, text: '확인되지 않은 99000원 무료 이벤트' },
        ...(mockDraft.editorBlueprint ?? []),
      ],
    }))
    let saved: any
    mockDeps.createVersion = vi.fn(async (_client, input: any) => {
      saved = input.structuredPayload
      return { data: { versionId, versionNumber: 1, fingerprint: 'f'.repeat(64) } }
    })

    await generateNaverBlogPost({ workspaceId, userId, topic: '매장 소개', imageCount: 3, requestKey, deps: mockDeps })

    expect(JSON.stringify(saved.editorBlocks)).not.toMatch(/99000원|무료|이벤트/)
  })

  it('blocks paid images and persistence when sanitized claims still need review', async () => {
    mockDeps.checkClaims = vi.fn(() => ({ status: 'UNKNOWN' as const, issues: ['사장님 확인이 필요해요.'] }))

    await expect(generateNaverBlogPost({ workspaceId, userId, topic: '매장 소개', imageCount: 3, requestKey, deps: mockDeps }))
      .rejects.toMatchObject({ code: 'CLAIMS_NEED_REVIEW' })

    expect(mockDeps.generateImage).not.toHaveBeenCalled()
    expect(mockDeps.createItem).not.toHaveBeenCalled()
    expect(mockDeps.createVersion).not.toHaveBeenCalled()
  })

  it('1차·2차 검사 실패 후 3차 엄격 모드 시도에서 통과하면 최종 성공한다', async () => {
    let callCount = 0
    const promptsReceived: string[] = []
    mockDeps.generateDraft = vi.fn(async (inp: any) => {
      callCount++
      promptsReceived.push(inp.prompt)
      return {
        ...mockDraft,
        title: `초안 시도 ${callCount}`,
      }
    })

    // 1차 실패, 2차 실패, 3차 성공
    let checkCount = 0
    mockDeps.checkClaims = vi.fn(() => {
      checkCount++
      if (checkCount <= 3) {
        // 1차 검사, 2차 검사, 2차 selfHeal 후 검사까지 실패
        return { status: 'UNKNOWN' as const, issues: ['가격 확인 필요: 50,000원'] }
      }
      // 3차 검사 통과
      return { status: 'OK' as const, issues: [] }
    })

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '가을 신메뉴 소개',
      imageCount: 3,
      requestKey,
      deps: mockDeps,
    })

    expect(result.contentId).toBe(contentId)
    expect(mockDeps.generateDraft).toHaveBeenCalledTimes(3)
    // 3차 프롬프트에 엄격 모드 지시와 지적된 문제가 포함되어야 함
    expect(promptsReceived[2]).toContain('[엄격 모드: 숫자·가격·할인·영업시간·효능/효과/치료/보장·최고/1위·기간/횟수 표현을 일체 쓰지 말고, 사진 설명은 눈에 보이는 장면·분위기·공간 느낌만 쓰며, 확인된 사실 자료에 없는 서비스 과정/절차를 지어내지 말 것')
    expect(promptsReceived[2]).toContain('가격 확인 필요: 50,000원')
    expect(mockDeps.createItem).toHaveBeenCalled()
    expect(mockDeps.createVersion).toHaveBeenCalled()
  })

  it('3차 엄격 모드 시도 및 selfHeal 후에도 검사 실패하면 CLAIMS_NEED_REVIEW로 실패하고 console.error(strict_draft)가 로깅된다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockDeps.checkClaims = vi.fn(() => ({
      status: 'UNKNOWN' as const,
      issues: ['확인되지 않은 할인율 표기'],
    }))

    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '가을 신메뉴 소개',
        imageCount: 3,
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({ code: 'CLAIMS_NEED_REVIEW' })

    expect(mockDeps.generateDraft).toHaveBeenCalledTimes(3)

    const stageCalls = errorSpy.mock.calls
      .filter(([msg]) => msg === '[naver-posts] claim check flagged')
      .map(([, info]) => (info as any)?.stage)

    expect(stageCalls).toContain('first_draft')
    expect(stageCalls).toContain('retry_draft')
    expect(stageCalls).toContain('strict_draft')

    errorSpy.mockRestore()
  })

  it('경과 시간이 150초 이상이면 3차 엄격 모드 시도를 건너뛰고 바로 CLAIMS_NEED_REVIEW로 실패한다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let currentTime = 1_000_000
    mockDeps.now = vi.fn(() => currentTime)

    mockDeps.generateDraft = vi.fn(async () => {
      // 2차 생성 후 시간을 151초 경과시킴
      currentTime += 160_000
      return mockDraft
    })

    mockDeps.checkClaims = vi.fn(() => ({
      status: 'UNKNOWN' as const,
      issues: ['확인되지 않은 영업시간'],
    }))

    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '가을 신메뉴 소개',
        imageCount: 3,
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({ code: 'CLAIMS_NEED_REVIEW' })

    // 1차, 2차까지만 생성하고 3차는 건너뜀
    expect(mockDeps.generateDraft).toHaveBeenCalledTimes(2)

    const stageCalls = errorSpy.mock.calls
      .filter(([msg]) => msg === '[naver-posts] claim check flagged')
      .map(([, info]) => (info as any)?.stage)

    expect(stageCalls).toContain('first_draft')
    expect(stageCalls).toContain('retry_draft')
    expect(stageCalls).not.toContain('strict_draft')

    errorSpy.mockRestore()
  })

  it('checks the final materialized payload before saving a content item', async () => {
    mockDeps.checkClaims = vi.fn((_channel, payload) => (
      'editorBlocks' in payload
        ? { status: 'UNKNOWN' as const, issues: ['최종 원고 확인이 필요해요.'] }
        : { status: 'OK' as const, issues: [] }
    ))

    await expect(generateNaverBlogPost({ workspaceId, userId, topic: '매장 소개', imageCount: 3, requestKey, deps: mockDeps }))
      .rejects.toMatchObject({ code: 'CLAIMS_NEED_REVIEW' })

    expect(mockDeps.createItem).not.toHaveBeenCalled()
    expect(mockDeps.createVersion).not.toHaveBeenCalled()
  })

  it('F9 helper: normalizeHashtags strips # and whitespace and ignores empty tokens', () => {
    expect(normalizeHashtags(['#소희', '  #맛집  ', '###카페', '#', '   ', '네이버'])).toEqual([
      '#소희',
      '#맛집',
      '#카페',
      '#네이버',
    ])
  })

  it('deterministicUuid helper generates reproducible RFC 4122 v4 UUIDs', () => {
    const u1 = deterministicUuid('30000000-0000-4000-8000-000000000001:text')
    const u2 = deterministicUuid('30000000-0000-4000-8000-000000000001:text')
    const u3 = deterministicUuid('30000000-0000-4000-8000-000000000001:image:0')

    expect(u1).toBe(u2)
    expect(u1).not.toBe(u3)
    expect(u1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('rejects with 400 CATEGORY_INVALID before any paid work if categoryId is not in non-empty synced list', async () => {
    mockDeps.getSyncedCategories = vi.fn().mockResolvedValue([
      { id: 'cat-1', name: '공지사항', parentId: null },
      { id: 'cat-2', name: '이벤트', parentId: null },
    ])

    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '카테고리 테스트',
        imageCount: 3,
        requestKey,
        categoryId: 'non-existent-cat',
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({
      code: 'CATEGORY_INVALID',
      status: 400,
      message: '선택한 카테고리를 찾을 수 없어요. 카테고리 목록을 새로 불러와 주세요.',
    })

    // Verified: No credits reserved, no images generated, no job claimed!
    expect(creditGateway.reserve).not.toHaveBeenCalled()
    expect(mockDeps.generateImage).not.toHaveBeenCalled()
    expect(jobStore.claim).not.toHaveBeenCalled()
  })

  it('allows any categoryId when synced category list is empty', async () => {
    mockDeps.getSyncedCategories = vi.fn().mockResolvedValue([])

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '카테고리 빈 목록 테스트',
      imageCount: 3,
      requestKey,
      categoryId: 'any-new-cat',
      deps: mockDeps,
    })

    expect(result.versionId).toBe(versionId)
    expect(mockDeps.generateImage).toHaveBeenCalledTimes(3)
  })

  it('allows matching categoryId when present in synced list', async () => {
    mockDeps.getSyncedCategories = vi.fn().mockResolvedValue([
      { id: 'valid-cat', name: '공지사항', parentId: null },
    ])

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '정상 카테고리 테스트',
      imageCount: 3,
      requestKey,
      categoryId: 'valid-cat',
      deps: mockDeps,
    })

    expect(result.versionId).toBe(versionId)
  })

  it('photoSource="place" waives all image credits (0 SC), uses storePlacePhoto, and does not call generateImage', async () => {
    creditGateway = createFakeCreditGateway(500) // 500 SC is not enough for 100 + 3*150=550 SC, but enough for 100 SC
    mockDeps.credits = creditGateway

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '스마트플레이스 실제 사진 활용 블로그 글',
      imageCount: 3,
      photoSource: 'place',
      requestKey,
      deps: mockDeps,
    })

    expect(result.versionId).toBe(versionId)
    // Only 1 text reservation was made
    expect(creditGateway.reserve).toHaveBeenCalledTimes(1)
    expect(creditGateway.reserve).toHaveBeenCalledWith(workspaceId, expect.anything(), 'text')
    // No image reservation or settlement occurred
    expect(creditGateway.settle).toHaveBeenCalledTimes(1) // only text settled
    const reservations = creditGateway.getReservations()
    expect(reservations).toHaveLength(1)
    expect(reservations[0].scope).toBe('text')
    expect(reservations[0].credits).toBe(100)
    expect(creditGateway.getAvailable()).toBe(400) // 500 - 100 = 400

    // Stored photos via storePlacePhoto, NEVER called generateImage
    expect(mockDeps.loadPlacePhotos).toHaveBeenCalledWith(workspaceId)
    expect(mockDeps.storePlacePhoto).toHaveBeenCalledTimes(3)
    expect(mockDeps.generateImage).not.toHaveBeenCalled()
  })

  it('photoSource="place" throws NO_PLACE_PHOTOS (400) when place has no photos', async () => {
    mockDeps.loadPlacePhotos = vi.fn(async () => [])

    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '사진 없는 플레이스 테스트',
        imageCount: 3,
        photoSource: 'place',
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toThrow('연동된 네이버 플레이스 매장 사진이 없습니다. AI 사진 생성을 선택해 주세요.')

    // Credits should NOT be reserved or charged for images, text hold released
    expect(mockDeps.storePlacePhoto).not.toHaveBeenCalled()
    expect(mockDeps.generateImage).not.toHaveBeenCalled()
  })

  it('photoSource="place" cycles photos when imageCount > placePhotos.length', async () => {
    mockDeps.loadPlacePhotos = vi.fn(async () => ['https://ldb-phinf.pstatic.net/only-one.jpg'])

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '사진 1장 순환 테스트',
      imageCount: 3,
      photoSource: 'place',
      requestKey,
      deps: mockDeps,
    })

    expect(result.versionId).toBe(versionId)
    expect(mockDeps.storePlacePhoto).toHaveBeenCalledTimes(3)
    // All 3 slots use the same photo since there's only 1
    for (let i = 1; i <= 3; i++) {
      expect(mockDeps.storePlacePhoto).toHaveBeenNthCalledWith(
        i,
        expect.objectContaining({
          imageUrl: 'https://ldb-phinf.pstatic.net/only-one.jpg',
        }),
      )
    }
  })

  it('photoSource="ai" reserves both text (100 SC) and image credits (150 SC per image)', async () => {
    creditGateway = createFakeCreditGateway(3000)
    mockDeps.credits = creditGateway

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: 'AI 사진 생성 블로그 글',
      imageCount: 3,
      photoSource: 'ai',
      requestKey,
      deps: mockDeps,
    })

    expect(result.versionId).toBe(versionId)
    // 1 text + 3 images = 4 reservations
    expect(creditGateway.reserve).toHaveBeenCalledTimes(4)
    expect(creditGateway.settle).toHaveBeenCalledTimes(4)
    const reservations = creditGateway.getReservations()
    expect(reservations).toHaveLength(4)
    expect(reservations.filter((r) => r.scope === 'image')).toHaveLength(3)
    expect(creditGateway.getAvailable()).toBe(3000 - (100 + 3 * 150)) // 2450
  })

  it('enrichLocalSeoKeywords generates up to 10 unique SEO keywords combining location, industry, and business name', () => {
    const keywords = enrichLocalSeoKeywords(['#세무상담', '#절세팁'], {
      businessName: '태양세무회계',
      industry: '세무',
      location: '서울 강남구 역삼동',
    })

    expect(keywords.length).toBeLessThanOrEqual(10)
    expect(keywords).not.toEqual(expect.arrayContaining(['서울세무추천', '서울세무잘하는곳', '세무전문', '세무후기', '서울핫플', '방문후기', '솔직후기']))
    expect(keywords).toContain('세무상담')
    expect(keywords).toContain('절세팁')
    expect(keywords).toContain('서울세무')
    expect(keywords).toContain('서울태양세무회계')
    expect(keywords).toContain('태양세무회계')
  })

  it('scheduledAt is passed through and preserved in structuredPayload', async () => {
    let capturedPayload: any = null
    mockDeps.createVersion = vi.fn(async (_client, input: any) => {
      capturedPayload = input.structuredPayload
      return {
        data: {
          versionId,
          versionNumber: 1,
          fingerprint: 'f'.repeat(64),
        },
      }
    })

    const targetTime = '2026-10-16T09:30:00.000Z'
    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '예약 발행 테스트',
      imageCount: 3,
      scheduledAt: targetTime,
      requestKey,
      deps: mockDeps,
    })

    expect(result.versionId).toBe(versionId)
    expect(capturedPayload).not.toBeNull()
    expect(capturedPayload.scheduledAt).toBe(targetTime)
    expect(capturedPayload.keywords.length).toBeLessThanOrEqual(10)
    expect(capturedPayload.keywords.length).toBeGreaterThan(0)
  })

  it('keeps booking guidance without fabricating a customer quote from aggregate place ratings', async () => {
    let capturedPayload: any = null
    mockDeps.createVersion = vi.fn(async (_client, input: any) => {
      capturedPayload = input.structuredPayload
      return {
        data: {
          versionId,
          versionNumber: 1,
          fingerprint: 'f'.repeat(64),
        },
      }
    })

    const fakeAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'knowledge_sources') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                refresh_policy: {
                  placeSummary: {
                    placeId: '12345678',
                    name: '태양세무회계',
                    hasTalktalk: true,
                    visitorReviewScore: 4.95,
                    visitorReviewCount: 120,
                  },
                },
              },
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }),
      rpc: vi.fn(),
    }
    mockDeps.admin = fakeAdmin as any
    mockDeps.generateDraft = vi.fn(async () => ({
      ...mockDraft,
      editorBlueprint: (mockDraft.editorBlueprint ?? []).filter((b) => b.kind !== 'quote'),
    }))

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '전환 배너 및 리뷰 인용구 테스트',
      imageCount: 3,
      requestKey,
      deps: mockDeps,
    })

    expect(result.versionId).toBe(versionId)
    expect(capturedPayload).not.toBeNull()

    // Aggregate ratings do not establish a customer quote or a 1:1 service promise.
    const blocks = capturedPayload.editorBlocks
    expect(blocks.some((b: any) => b.kind === 'quote')).toBe(false)
    expect(JSON.stringify(blocks)).not.toMatch(/실제 방문자 리뷰 인증|1:1 맞춤|세심하게 케어|만족 매장/)

    // Booking guidance does not promise availability or a waiting-time benefit.
    const bookingParagraph = blocks.find((b: any) => b.kind === 'paragraph' && b.text.includes('12345678/ticket'))
    expect(bookingParagraph).toBeDefined()
    expect(bookingParagraph.text).not.toContain('대기 없이')
  })

  it('ANI-1901: injects validated BlogStrategyBrief into generateDraft and preserves it in structuredPayload', async () => {
    const brief = buildBlogStrategyBrief({
      ...marketingStrategyFixture,
      workspaceId,
    }, {
      workspaceId,
      datasetMode: 'ACTUAL',
      lineage: marketingStrategyFixture.lineage,
    })

    let capturedPayload: any = null
    mockDeps.createVersion = vi.fn(async (_client, input: any) => {
      capturedPayload = input.structuredPayload
      return {
        data: {
          versionId,
          versionNumber: 1,
          fingerprint: 'f'.repeat(64),
        },
      }
    })

    await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '전략 기반 포스팅',
      imageCount: 3,
      requestKey,
      blogStrategyBrief: brief,
      deps: mockDeps,
    })

    // 1. generateDraft에 blogStrategyBrief가 그대로 전달되어 프롬프트에 반영되는지 검증
    expect(mockDeps.generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        blogStrategyBrief: brief,
      }),
    )

    // 2. 저장되는 structuredPayload에 strategyBrief가 불변으로 보존되는지 검증
    expect(capturedPayload).not.toBeNull()
    expect(capturedPayload.strategyBrief).toEqual(brief)
  })

  it('승인한 핵심 키워드가 저장되는 태그 맨 앞에 오고 태그 상한 10개를 넘지 않는다', async () => {
    const brief = buildBlogStrategyBrief({
      ...marketingStrategyFixture, workspaceId,
      focusKeyword: { keyword: '신규 핵심 키워드', searchStatus: 'NOT_OBSERVED', internalScore: 64 },
    }, { workspaceId, datasetMode: 'ACTUAL', lineage: marketingStrategyFixture.lineage })
    let capturedPayload: any = null
    mockDeps.createVersion = vi.fn(async (_client, input: any) => {
      capturedPayload = input.structuredPayload
      return { data: { versionId, versionNumber: 1, fingerprint: 'f'.repeat(64) } }
    })

    await generateNaverBlogPost({
      workspaceId, userId, topic: '전략 기반 포스팅', imageCount: 3, requestKey, blogStrategyBrief: brief, deps: mockDeps,
    })

    expect(capturedPayload.keywords[0]).toBe('신규 핵심 키워드')
    expect(capturedPayload.keywords.length).toBeLessThanOrEqual(10)
    expect(capturedPayload.keywords.filter((k: string) => k === '신규 핵심 키워드')).toHaveLength(1)
  })

  it('ANI-1901: blocks a draft that contains a claim the owner excluded in conversation, before any save', async () => {
    const brief = buildBlogStrategyBrief({
      ...marketingStrategyFixture, workspaceId, excludedClaims: ['할인'],
    }, { workspaceId, datasetMode: 'ACTUAL', lineage: marketingStrategyFixture.lineage })
    mockDeps.generateDraft = vi.fn(async () => ({ ...mockDraft, introduction: '이번 달 첫 방문 할인 안내' }))
    mockDeps.createItem = vi.fn()

    await expect(generateNaverBlogPost({
      workspaceId, userId, topic: '전략 기반 포스팅', imageCount: 3, requestKey,
      blogStrategyBrief: brief, deps: mockDeps,
    })).rejects.toMatchObject({ code: 'CLAIMS_NEED_REVIEW' })
    expect(mockDeps.createItem).not.toHaveBeenCalled()
  })

  it('ANI-1901: rejects cross-workspace blogStrategyBrief fail-closed before draft generation', async () => {
    const crossWorkspaceBrief = buildBlogStrategyBrief({
      ...marketingStrategyFixture,
      workspaceId: '90000000-0000-4000-8000-000000000009',
    }, {
      workspaceId: '90000000-0000-4000-8000-000000000009',
      datasetMode: 'ACTUAL',
      lineage: marketingStrategyFixture.lineage,
    })

    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '타 워크스페이스 전략 주입 시도',
        imageCount: 3,
        requestKey,
        blogStrategyBrief: crossWorkspaceBrief,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    expect(mockDeps.generateDraft).not.toHaveBeenCalled()
  })

  it('ANI-1902: passes reader question postMode (faq, comparison, consultation) to generateDraft and persists it', async () => {
    let capturedPayload: any = null
    mockDeps.createVersion = vi.fn(async (_client, input: any) => {
      capturedPayload = input.structuredPayload
      return {
        data: {
          versionId,
          versionNumber: 1,
          fingerprint: 'f'.repeat(64),
        },
      }
    })

    await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '독자 질문 중심 FAQ 포스팅',
      imageCount: 3,
      requestKey,
      postMode: 'faq',
      deps: mockDeps,
    })

    expect(mockDeps.generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        postMode: 'faq',
      }),
    )

    expect(capturedPayload).not.toBeNull()
    expect(capturedPayload.postMode).toBe('faq')
  })

  it('ANI-1902: rejects invalid postMode fail-closed before draft generation', async () => {
    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '유효하지 않은 모드',
        imageCount: 3,
        requestKey,
        postMode: 'invalid_mode' as any,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    expect(mockDeps.generateDraft).not.toHaveBeenCalled()
  })

  it('형식과 무관하게 1장~20장까지 생성 가능하며 0장과 21장은 400 INVALID_INPUT으로 거절한다', async () => {
    // 0장 거절 (information)
    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '0장 정보형 글',
        imageCount: 0,
        postMode: 'information',
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 })

    // 21장 거절 (information)
    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '21장 정보형 글',
        imageCount: 21,
        postMode: 'information',
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 })

    // 21장 거절 (photo_story)
    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '21장 포토스토리 글',
        imageCount: 21,
        postMode: 'photo_story',
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 })

    // 1. information + 1장 통과
    const blueprint1 = [
      { kind: 'paragraph' as const, text: '도입' },
      { kind: 'image_slot' as const, position: 1, altText: '사진 1' },
      { kind: 'paragraph' as const, text: '설명 1' },
      { kind: 'cta' as const, text: '문의' },
    ]
    mockDeps.generateDraft = vi.fn(async () => ({
      ...mockDraft,
      editorBlueprint: blueprint1,
      postMode: 'information' as const,
    }))
    const resInfo1 = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '1장 정보형 글',
      imageCount: 1,
      postMode: 'information',
      photoSource: 'place',
      requestKey: '30000000-0000-4000-8000-000000000011',
      deps: mockDeps,
    })
    expect(resInfo1.imageCount).toBe(1)

    // 2. information + 20장 통과
    const blueprint20 = [
      { kind: 'paragraph' as const, text: '도입' },
      ...Array.from({ length: 20 }, (_, i) => [
        { kind: 'image_slot' as const, position: i + 1, altText: `사진 ${i + 1}` },
        { kind: 'paragraph' as const, text: `설명 ${i + 1}` },
      ]).flat(),
      { kind: 'cta' as const, text: '문의' },
    ]
    mockDeps.generateDraft = vi.fn(async () => ({
      ...mockDraft,
      editorBlueprint: blueprint20,
      postMode: 'information' as const,
    }))
    const resInfo20 = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '20장 정보형 글',
      imageCount: 20,
      postMode: 'information',
      photoSource: 'place',
      requestKey: '30000000-0000-4000-8000-000000000020',
      deps: mockDeps,
    })
    expect(resInfo20.imageCount).toBe(20)

    // 3. photo_story + 20장 통과 및 동시성 4 확인 (imageCount > 12)
    mockDeps.generateDraft = vi.fn(async () => ({
      ...mockDraft,
      editorBlueprint: blueprint20,
      postMode: 'photo_story' as const,
    }))
    let concurrentCount = 0
    let maxConcurrent = 0
    mockDeps.generateImage = vi.fn(async (imgInput: any) => {
      concurrentCount++
      maxConcurrent = Math.max(maxConcurrent, concurrentCount)
      await new Promise((resolve) => setTimeout(resolve, 5))
      concurrentCount--
      return { id: `art-${imgInput.prompt}`, title: imgInput.prompt }
    })

    const creditGateway20 = createFakeCreditGateway(6000)
    mockDeps.credits = creditGateway20

    const resPhoto20 = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '20장 포토스토리 블로그 글',
      imageCount: 20,
      postMode: 'photo_story',
      photoSource: 'ai',
      requestKey: '30000000-0000-4000-8000-000000000021',
      deps: mockDeps,
    })

    expect(resPhoto20.imageCount).toBe(20)
    expect(mockDeps.generateImage).toHaveBeenCalledTimes(20)
    // imageCount > 12이므로 동시성 한도 4
    expect(maxConcurrent).toBeGreaterThanOrEqual(1)
    expect(maxConcurrent).toBeLessThanOrEqual(4)
    // 1 text + 20 images = 21 settled reservations
    expect(creditGateway20.settle).toHaveBeenCalledTimes(21)
  })

  it('AI 이미지 생성 동시성: imageCount <= 12이면 3장 동시 실행된다', async () => {
    const blueprint12 = [
      { kind: 'paragraph' as const, text: '도입' },
      ...Array.from({ length: 12 }, (_, i) => [
        { kind: 'image_slot' as const, position: i + 1, altText: `사진 ${i + 1}` },
        { kind: 'paragraph' as const, text: `설명 ${i + 1}` },
      ]).flat(),
      { kind: 'cta' as const, text: '문의' },
    ]
    mockDeps.generateDraft = vi.fn(async () => ({
      ...mockDraft,
      editorBlueprint: blueprint12,
      postMode: 'photo_story' as const,
    }))

    let concurrentCount = 0
    let maxConcurrent = 0
    mockDeps.generateImage = vi.fn(async (imgInput: any) => {
      concurrentCount++
      maxConcurrent = Math.max(maxConcurrent, concurrentCount)
      await new Promise((resolve) => setTimeout(resolve, 5))
      concurrentCount--
      return { id: `art-${imgInput.prompt}`, title: imgInput.prompt }
    })

    const creditGateway12 = createFakeCreditGateway(4000)
    mockDeps.credits = creditGateway12

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '12장 포토스토리 블로그 글',
      imageCount: 12,
      postMode: 'photo_story',
      photoSource: 'ai',
      requestKey,
      deps: mockDeps,
    })

    expect(result.imageCount).toBe(12)
    expect(mockDeps.generateImage).toHaveBeenCalledTimes(12)
    // imageCount <= 12이므로 동시성 한도 3
    expect(maxConcurrent).toBeLessThanOrEqual(3)
  })

  it('photoSource="place" cycles photos up to 15 when imageCount is 15 and placePhotos has only 2', async () => {
    const blueprint15 = [
      { kind: 'paragraph' as const, text: '도입' },
      ...Array.from({ length: 15 }, (_, i) => [
        { kind: 'image_slot' as const, position: i + 1, altText: `사진 ${i + 1}` },
        { kind: 'paragraph' as const, text: `설명 ${i + 1}` },
      ]).flat(),
      { kind: 'cta' as const, text: '문의' },
    ]
    mockDeps.generateDraft = vi.fn(async () => ({
      ...mockDraft,
      editorBlueprint: blueprint15,
      postMode: 'photo_story' as const,
    }))
    mockDeps.loadPlacePhotos = vi.fn(async () => ['https://place.naver.com/p1.jpg', 'https://place.naver.com/p2.jpg'])
    const storedUrls: string[] = []
    mockDeps.storePlacePhoto = vi.fn(async ({ imageUrl }: any) => {
      storedUrls.push(imageUrl)
      return { id: `place-${storedUrls.length}`, title: '매장 사진' }
    })

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '플레이스 사진 15장 포토스토리',
      imageCount: 15,
      postMode: 'photo_story',
      photoSource: 'place',
      requestKey,
      deps: mockDeps,
    })

    expect(result.imageCount).toBe(15)
    expect(storedUrls).toHaveLength(15)
    expect(storedUrls[0]).toBe('https://place.naver.com/p1.jpg')
    expect(storedUrls[1]).toBe('https://place.naver.com/p2.jpg')
    expect(storedUrls[2]).toBe('https://place.naver.com/p1.jpg')
    expect(storedUrls[14]).toBe('https://place.naver.com/p1.jpg')
  })

  it('과정 소개형(process) 및 공간 둘러보기(place_tour)도 1~20장 범위를 적용한다', async () => {
    // process: 0 -> reject, 21 -> reject
    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '과정 소개 글',
        imageCount: 0,
        postMode: 'process',
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '과정 소개 글',
        imageCount: 21,
        postMode: 'process',
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    // place_tour: 0 -> reject, 21 -> reject
    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '공간 둘러보기 글',
        imageCount: 0,
        postMode: 'place_tour',
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    await expect(
      generateNaverBlogPost({
        workspaceId,
        userId,
        topic: '공간 둘러보기 글',
        imageCount: 21,
        postMode: 'place_tour',
        requestKey,
        deps: mockDeps,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('passes reaction and imageStyle to generateDraft and prompt generator, and keeps photoSource even if imageStyle has place source', async () => {
    const blueprint = [
      { kind: 'paragraph' as const, text: '도입' },
      ...Array.from({ length: 6 }, (_, i) => [
        { kind: 'image_slot' as const, position: i + 1, altText: `사진 ${i + 1}` },
        { kind: 'paragraph' as const, text: `설명 ${i + 1}` },
      ]).flat(),
      { kind: 'cta' as const, text: '문의' },
    ]
    mockDeps.generateDraft = vi.fn(async () => ({
      ...mockDraft,
      editorBlueprint: blueprint,
      postMode: 'process' as const,
    }))
    let capturedPrompt = ''
    mockDeps.generateImage = vi.fn(async (input: any) => {
      capturedPrompt = input.prompt
      return { id: 'img-test', title: '사진' }
    })

    const creditGatewayTest = createFakeCreditGateway(3000)
    mockDeps.credits = creditGatewayTest

    const result = await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '정성스런 제작 과정',
      imageCount: 6,
      postMode: 'process',
      reaction: 'visit',
      imageStyle: 'process_shot',
      photoSource: 'ai', // AI photo generation requested
      requestKey,
      deps: mockDeps,
    })

    expect(result.versionId).toBe(versionId)
    // 1. reaction과 imageStyle이 generateDraft로 전달되었는지 확인
    expect(mockDeps.generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        postMode: 'process',
        reaction: 'visit',
        imageStyle: 'process_shot',
      }),
    )
    // 2. prompt에 imageStyle promptHint가 포함되었는지 확인
    expect(capturedPrompt).toContain('Hands-on preparation')
    // 3. photoSource가 'ai'이므로 이미지 크레딧이 차감(reserve & settle)되고 generateImage가 호출되었는지 확인
    expect(mockDeps.generateImage).toHaveBeenCalledTimes(6)
    expect(mockDeps.storePlacePhoto).not.toHaveBeenCalled()
  })

  it('does NOT force photoSource to place when imageStyle is store_photo and photoSource is ai', async () => {
    const blueprint = [
      { kind: 'paragraph' as const, text: '도입' },
      ...Array.from({ length: 3 }, (_, i) => [
        { kind: 'image_slot' as const, position: i + 1, altText: `사진 ${i + 1}` },
        { kind: 'paragraph' as const, text: `설명 ${i + 1}` },
      ]).flat(),
      { kind: 'cta' as const, text: '문의' },
    ]
    mockDeps.generateDraft = vi.fn(async () => ({
      ...mockDraft,
      editorBlueprint: blueprint,
    }))
    mockDeps.generateImage = vi.fn(async () => ({ id: 'ai-img', title: '사진' }))

    await generateNaverBlogPost({
      workspaceId,
      userId,
      topic: '매장 사진 스타일 글',
      imageCount: 3,
      postMode: 'information',
      imageStyle: 'store_photo',
      photoSource: 'ai',
      requestKey,
      deps: mockDeps,
    })

    // photoSource가 ai로 유지되어 generateImage가 호출됨
    expect(mockDeps.generateImage).toHaveBeenCalledTimes(3)
    expect(mockDeps.storePlacePhoto).not.toHaveBeenCalled()
  })
})
