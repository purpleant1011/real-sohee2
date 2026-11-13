import { describe, expect, it, vi } from 'vitest'
import { maybeGenerateStudioImage, STUDIO_IMAGE_FALLBACK_NOTICE } from '@/features/channel-studio/image-option'
import { generateChannelDraft } from '@/features/channel-studio/generate'
import { createDurableLearningBilling } from '@/features/channel-learning/durable-billing'
import type { OpenAIImageClient, ImageGenerationCallInput, ImageGenerationCallOutput } from '@/features/creative/openai-image-client'
import type { TextGenerator } from '@/features/vault/transform/ports/text-generator'
import type { ChannelDraftRepository, ClaimChecker } from '@/features/channel-studio/ports'
import type { ChannelDraftRequest, ChannelDraftResult, GroundedBusinessContext } from '@/features/channel-studio/types'
import type { StudioCredits } from '@/features/channel-studio/studio-credits'
import type { CreditGateway } from '@/features/credits/repository'
import type { CreditRateCatalog } from '@/features/credits/types'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const REQUEST_KEY = '33333333-3333-4333-8333-333333333333'
const JOB_ID = '44444444-4444-4444-8444-444444444444'

const testCatalog: CreditRateCatalog = {
  catalogVersion: 1,
  rates: {
    source_analysis: {
      baseCredits: 0,
      perUnit: {
        chatTurns: 0,
        textGenerations: 0,
        imageGenerations: 0,
        sourceAnalyses: 2,
        externalActions: 0,
      },
    },
  },
}

const validContext: GroundedBusinessContext = {
  businessName: '봄빛 베이커리',
  industry: '베이커리 카페',
  location: '서울 마포구',
  facts: [{ kind: 'offering', label: '대표 메뉴', value: '유기농 소금빵' }],
  tone: { presetKey: null, brandVoice: '따뜻하고 정겨운 어조' },
  knowledgeVersion: 1,
  warnings: [],
}

const fourChannelJson = JSON.stringify({
  instagram: { caption: '따뜻한 봄빛 베이커리의 소금빵을 소개합니다.', hashtags: ['#소금빵'], firstLineHook: '갓 구운 소금빵' },
  threads: { text: '매일 아침 유기농 밀가루로 굽는 소금빵 이야기.' },
  naver_blog: { title: '봄빛 베이커리 유기농 소금빵', blocks: [{ type: 'paragraph', text: '매일 정성껏 굽습니다.' }] },
  daangn_business: { text: '동네 이웃분들을 위한 갓 구운 소금빵 소식입니다.', coupon: null },
})

function createFixtureImageClient(): { client: OpenAIImageClient; calls: ImageGenerationCallInput[] } {
  const calls: ImageGenerationCallInput[] = []
  const client: OpenAIImageClient = {
    generateImage: vi.fn(async (input: ImageGenerationCallInput): Promise<ImageGenerationCallOutput> => {
      calls.push(input)
      return {
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
        mimeType: 'image/jpeg',
        sha256Digest: 'fixture-digest-00000000000000000000000000000000',
        providerRequestId: 'req-fixture-test',
        model: 'dall-e-3',
        promptTokensEstimate: 50,
        imageTokensEstimate: 1024,
      }
    }),
  }
  return { client, calls }
}

function createFakeAdminWithStorageThrow(errorToThrow = new Error('S3 connection reset: upload failed')) {
  const storageUpload = vi.fn().mockImplementation(async () => {
    throw errorToThrow
  })
  const storageRemove = vi.fn().mockResolvedValue({ error: null })
  const dbInsert = vi.fn().mockResolvedValue({ data: null, error: null })

  return {
    storageUpload,
    storageRemove,
    dbInsert,
    admin: {
      storage: {
        from: vi.fn().mockReturnValue({
          upload: storageUpload,
          remove: storageRemove,
        }),
      },
      from: vi.fn().mockReturnValue({
        insert: dbInsert,
      }),
    },
  }
}

function createTrackingCredits() {
  const reservations: Array<{ scope: string; id: string }> = []
  const settledIds: string[] = []
  const releasedIds: string[] = []

  const credits: StudioCredits = {
    reserve: vi.fn().mockImplementation(async (_ws: string, _key: string, scope: string) => {
      const id = `res-${scope}`
      reservations.push({ scope, id })
      return {
        reservationId: id,
        state: 'reserved' as const,
        requestedCredits: scope === 'text' ? 100 : 150,
        operationKey: `op-${scope}`,
        isReplay: false,
      }
    }),
    settle: vi.fn().mockImplementation(async (_ws: string, hold: any) => {
      settledIds.push(hold.reservationId)
    }),
    release: vi.fn().mockImplementation(async (_ws: string, hold: any) => {
      releasedIds.push(hold.reservationId)
    }),
  }

  return { credits, reservations, settledIds, releasedIds }
}

function createBaseRepo(onSave?: (saved: ChannelDraftResult) => void): ChannelDraftRepository {
  let stored: ChannelDraftResult | null = null
  return {
    findByRequestKey: vi.fn().mockImplementation(async () => stored),
    findEditSnapshot: vi.fn().mockResolvedValue(null),
    updateVariant: vi.fn().mockResolvedValue(null),
    countSince: vi.fn().mockResolvedValue(0),
    reserve: vi.fn().mockResolvedValue({ kind: 'acquired' }),
    release: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockImplementation(async (input) => {
      stored = {
        requestKey: input.requestKey,
        topic: input.topic,
        createdAt: '2026-11-10T12:00:00.000Z',
        basisNotes: input.basisNotes,
        imageNotice: input.imageNotice,
        variants: input.variants.map((v: any) => ({
          ...v,
          contentId: null,
          versionId: null,
          vaultSavable: v.savableReason === null,
          blockedReason: v.savableReason,
          payload: input.imageIds.length
            ? { ...v.payload, media: input.imageIds.map((id: string) => ({ src: `/api/workspaces/${input.workspaceId}/media/${id}` })) }
            : v.payload,
        })),
      }
      onSave?.(stored)
      return stored
    }),
    listRecent: vi.fn().mockResolvedValue([]),
  }
}

describe('Final Financial Boundary: F1 / F2 / F4 독립 검증', () => {
  describe('F1: Provider Attempt Flag await 뒤 설정 방지 및 Storage Fail 환급 차단', () => {
    it('provider 성공 후 Storage upload throw 시: output 0, providerAttempted=true, needsReconciliation=true 반환', async () => {
      const { client, calls } = createFixtureImageClient()
      const { admin, storageUpload } = createFakeAdminWithStorageThrow()

      const result = await maybeGenerateStudioImage({
        includeImage: true,
        admin,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        topic: '유기농 소금빵 출시',
        context: {
          businessName: validContext.businessName,
          industry: validContext.industry,
          location: validContext.location,
          summary: '매일 아침 굽는 빵',
          brandVoice: validContext.tone.brandVoice,
        },
        imageClient: client,
      })

      // 1. Paid provider was definitely attempted (1 fixture call)
      expect(calls.length).toBe(1)
      expect(storageUpload).toHaveBeenCalledTimes(1)

      // 2. Output is strictly 0 (no media, no asset ids)
      expect(result.imageIds).toEqual([])
      expect(result.media).toEqual([])
      expect(result.notice).toBe(STUDIO_IMAGE_FALLBACK_NOTICE)

      // 3. Financial flags guarantee hold preservation for reconciliation
      expect(result.providerAttempted).toBe(true)
      expect(result.needsReconciliation).toBe(true)
    })

    it('실제 consumer(generateChannelDraft): provider attempt 1 / storage throw 시 output 0 및 hold release 0 관측', async () => {
      const { client, calls } = createFixtureImageClient()
      const { admin } = createFakeAdminWithStorageThrow()
      const { credits, settledIds, releasedIds } = createTrackingCredits()
      const repo = createBaseRepo()

      const text: TextGenerator = {
        generateText: vi.fn().mockResolvedValue(fourChannelJson),
      }

      const request: ChannelDraftRequest = {
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        requestKey: REQUEST_KEY,
        topic: '유기농 소금빵',
        includeImage: true,
      }

      // Connecting real maybeGenerateStudioImage boundary with storage throw
      const result = await generateChannelDraft(request, {
        loadContext: vi.fn().mockResolvedValue(validContext),
        buildBaseDraft: vi.fn().mockReturnValue('확인된 정보: 유기농 소금빵'),
        checkClaims: vi.fn().mockReturnValue({ status: 'OK', issues: [] }),
        text,
        image: (params) =>
          maybeGenerateStudioImage({
            ...params,
            admin,
            imageClient: client,
          }),
        repo,
        credits,
      })

      // Verification:
      // 1. Text succeeded and was settled
      expect(settledIds).toContain('res-text')
      expect(result.variants).toHaveLength(4)

      // 2. Image was attempted once at provider level
      expect(calls.length).toBe(1)

      // 3. Image output is 0: imageIds empty, fallback notice present
      expect(result.imageNotice).toBe(STUDIO_IMAGE_FALLBACK_NOTICE)
      for (const variant of result.variants) {
        const media = (variant.payload as any).media
        expect(!media || media.length === 0).toBe(true)
      }

      // 4. CRITICAL: Image hold was NOT released (release count = 0, retained for reconciliation)
      expect(releasedIds).not.toContain('res-image')
      expect(settledIds).not.toContain('res-image')
    })

    it('미실행 확정일 때(includeImage=false 또는 사전 거절): release 허용 관측', async () => {
      const { credits, releasedIds } = createTrackingCredits()
      const repo = createBaseRepo()
      const { client } = createFixtureImageClient()

      const text: TextGenerator = {
        generateText: vi.fn().mockResolvedValue(fourChannelJson),
      }

      // Image generator returning definitive non-attempted result
      const safeNonAttemptImage = vi.fn().mockResolvedValue({
        imageIds: [],
        notice: null,
        media: [],
        providerAttempted: false,
        needsReconciliation: false,
      })

      const request: ChannelDraftRequest = {
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        requestKey: REQUEST_KEY,
        topic: '유기농 소금빵',
        includeImage: true,
      }

      await generateChannelDraft(request, {
        loadContext: vi.fn().mockResolvedValue(validContext),
        buildBaseDraft: vi.fn().mockReturnValue('확인된 정보: 유기농 소금빵'),
        checkClaims: vi.fn().mockReturnValue({ status: 'OK', issues: [] }),
        text,
        image: safeNonAttemptImage,
        repo,
        credits,
      })

      // Image hold is cleanly released because provider was definitively not attempted
      expect(releasedIds).toContain('res-image')
    })
  })

  describe('F2: Text 실행 0 / Image 실행 1 병렬 교차 오류 격리 검증', () => {
    it('text 실행 0 (buildBaseDraft 실패) / image 실행 1 (provider 호출 성공): text hold는 release되고 image hold는 보존된다', async () => {
      const { client, calls } = createFixtureImageClient()
      const { admin } = createFakeAdminWithStorageThrow()
      const { credits, releasedIds, settledIds } = createTrackingCredits()
      const repo = createBaseRepo()

      const text: TextGenerator = {
        generateText: vi.fn().mockResolvedValue(fourChannelJson),
      }

      const request: ChannelDraftRequest = {
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        requestKey: REQUEST_KEY,
        topic: '유기농 소금빵',
        includeImage: true,
      }

      // buildBaseDraft throws before text provider can be called
      const buildBaseDraftThrowing = vi.fn().mockImplementation(() => {
        throw new Error('Base draft builder crashed before text model call')
      })

      await expect(
        generateChannelDraft(request, {
          loadContext: vi.fn().mockResolvedValue(validContext),
          buildBaseDraft: buildBaseDraftThrowing,
          checkClaims: vi.fn().mockReturnValue({ status: 'OK', issues: [] }),
          text,
          image: (params) =>
            maybeGenerateStudioImage({
              ...params,
              admin,
              imageClient: client,
            }),
          repo,
          credits,
        }),
      ).rejects.toMatchObject({ code: 'MODEL_FAILED' })

      // Text provider was never invoked
      expect(text.generateText).not.toHaveBeenCalled()
      // Image provider was invoked in parallel
      expect(calls.length).toBe(1)

      // Cross-error boundary verification:
      // 1. Text hold MUST be released (refunded) because text provider never ran
      expect(releasedIds).toContain('res-text')
      // 2. Image hold MUST NOT be released (hold preserved for reconciliation)
      expect(releasedIds).not.toContain('res-image')
      expect(settledIds).toHaveLength(0)
    })

    it('역방향: text 실행 1 (모델 실패) / image 실행 0 (미실행 확정): image hold는 release되고 text hold는 보존된다', async () => {
      const { credits, releasedIds, settledIds } = createTrackingCredits()
      const repo = createBaseRepo()

      const text: TextGenerator = {
        generateText: vi.fn().mockRejectedValue(new Error('OpenAI text model rate limit 429')),
      }

      const safeNonAttemptImage = vi.fn().mockResolvedValue({
        imageIds: [],
        notice: '사전 조건 불충족으로 미실행',
        media: [],
        providerAttempted: false,
        needsReconciliation: false,
      })

      const request: ChannelDraftRequest = {
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        requestKey: REQUEST_KEY,
        topic: '유기농 소금빵',
        includeImage: true,
      }

      await expect(
        generateChannelDraft(request, {
          loadContext: vi.fn().mockResolvedValue(validContext),
          buildBaseDraft: vi.fn().mockReturnValue('확인된 정보: 소금빵'),
          checkClaims: vi.fn().mockReturnValue({ status: 'OK', issues: [] }),
          text,
          image: safeNonAttemptImage,
          repo,
          credits,
        }),
      ).rejects.toMatchObject({ code: 'MODEL_FAILED' })

      // Text provider was attempted
      expect(text.generateText).toHaveBeenCalledTimes(1)

      // Cross-error boundary verification:
      // 1. Text hold MUST NOT be released (preserved for reconciliation after attempt)
      expect(releasedIds).not.toContain('res-text')
      // 2. Image hold MUST be released (clean refund because provider was never attempted)
      expect(releasedIds).toContain('res-image')
      expect(settledIds).toHaveLength(0)
    })
  })

  describe('F4: Durable Billing Journal: 명확 거절 vs 모호 상태', () => {
    it('명확 거절(CREDIT_INSUFFICIENT): journal에 rejected 기록 및 BILLING_RESERVATION_REJECTED로 즉시 차단', async () => {
      let recordedState: any = null
      const explicitRejectGateway: CreditGateway = {
        async rpc(name) {
          if (name === 'reserve_workspace_credits') {
            return { data: null, error: { message: 'CREDIT_INSUFFICIENT' } }
          }
          throw new Error('unexpected ledger action')
        },
      }

      const billing = createDurableLearningBilling({
        workspaceId: WORKSPACE_ID,
        jobId: JOB_ID,
        gateway: explicitRejectGateway,
        catalog: testCatalog,
        async recordState(val) {
          recordedState = val
        },
      })

      const quote = await billing.quote('extract_knowledge', 2)
      expect(quote.allowed).toBe(true)

      // Reserve attempt fails with explicit rejection
      await expect(billing.reserve(quote.quoteId!)).rejects.toMatchObject({
        code: 'BILLING_INSUFFICIENT_CREDITS',
      })

      // State is recorded as rejected with explicit code
      expect(recordedState).toEqual(
        expect.objectContaining({
          state: 'rejected',
          failureCode: 'CREDIT_INSUFFICIENT',
        }),
      )

      // Subsequent quote with this rejected state returns definite BILLING_RESERVATION_REJECTED
      const resumingBilling = createDurableLearningBilling({
        workspaceId: WORKSPACE_ID,
        jobId: JOB_ID,
        gateway: explicitRejectGateway,
        catalog: testCatalog,
        initialState: recordedState,
        async recordState() {},
      })
      const resumeQuote = await resumingBilling.quote('extract_knowledge', 2)
      expect(resumeQuote.allowed).toBe(false)
      expect(resumeQuote.reason).toBe('BILLING_RESERVATION_REJECTED')
    })

    it('모호 상태(CREDIT_RPC_FAILED): journal이 rejected로 덮이지 않고 reconciliation_required 유지', async () => {
      const stateHistory: any[] = []
      const ambiguousGateway: CreditGateway = {
        async rpc(name) {
          if (name === 'reserve_workspace_credits') {
            return { data: null, error: { message: 'CREDIT_RPC_FAILED: connection reset by peer' } }
          }
          throw new Error('unexpected ledger action')
        },
      }

      const billing = createDurableLearningBilling({
        workspaceId: WORKSPACE_ID,
        jobId: JOB_ID,
        gateway: ambiguousGateway,
        catalog: testCatalog,
        async recordState(val) {
          stateHistory.push(val)
        },
      })

      const quote = await billing.quote('extract_knowledge', 2)
      await expect(billing.reserve(quote.quoteId!)).rejects.toMatchObject({
        code: 'BILLING_RESERVATION_BLOCKED',
      })

      // Pre-reserve recorded reconciliation_required, and was NOT overwritten by rejected
      expect(stateHistory).toHaveLength(1)
      expect(stateHistory[0]).toEqual(
        expect.objectContaining({
          state: 'reconciliation_required',
          reconciliationReason: 'unknown_reserve_outcome',
        }),
      )

      // Resuming billing with this ambiguous state blocks re-execution under reconciliation
      const resumingBilling = createDurableLearningBilling({
        workspaceId: WORKSPACE_ID,
        jobId: JOB_ID,
        gateway: ambiguousGateway,
        catalog: testCatalog,
        initialState: stateHistory[0],
        async recordState() {},
      })
      const resumeQuote = await resumingBilling.quote('extract_knowledge', 2)
      expect(resumeQuote.allowed).toBe(false)
      expect(resumeQuote.reason).toBe('BILLING_RECONCILIATION_REQUIRED')
    })

    it('사후 release 호출 시: auto-refund 차단 및 provider_attempted reconciliation 상태 전환', async () => {
      let recordedState: any = null
      const successfulGateway: CreditGateway = {
        async rpc(name, input) {
          if (name === 'reserve_workspace_credits') {
            return { data: { reservationId: input.p_reservation_id, state: 'reserved' }, error: null }
          }
          throw new Error('unexpected ledger action')
        },
      }

      const billing = createDurableLearningBilling({
        workspaceId: WORKSPACE_ID,
        jobId: JOB_ID,
        gateway: successfulGateway,
        catalog: testCatalog,
        async recordState(val) {
          recordedState = val
        },
      })

      const quote = await billing.quote('extract_knowledge', 1)
      const reservation = await billing.reserve(quote.quoteId!)
      expect(recordedState.state).toBe('reserved')

      // Attempting to release after reserve must throw and record provider_attempted
      await expect(billing.release(reservation.reservationId)).rejects.toMatchObject({
        code: 'BILLING_RECONCILIATION_REQUIRED',
      })

      expect(recordedState).toEqual(
        expect.objectContaining({
          state: 'reconciliation_required',
          reconciliationReason: 'provider_attempted',
        }),
      )
    })
  })
})
