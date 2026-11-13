import { describe, expect, it, vi } from 'vitest'
import {
  validateLearningResult,
  filterApprovedContextForChannelLearning,
  verifyDependenciesCurrent,
  createSupabaseConsumerGate,
} from './consumer-gate'
import {
  buildLearningContext,
  type ApprovedCandidateWithSource,
  type ContextDeps,
} from './context'
import { buildVisualBrief } from '@/features/creative/visual-brief-builder'
import { loadGroundedBusinessContext } from '@/features/channel-studio/knowledge-context'
import { generateChannelDraft } from '@/features/channel-studio/generate'
import { maybeGenerateStudioImage, STUDIO_IMAGE_FALLBACK_NOTICE } from '@/features/channel-studio/image-option'
import type { SourceRef } from './contracts'

describe('Task 6: Consumer Integration Tests (End-to-end Lifecycle & Security Gates)', () => {
  const workspaceId = '11111111-1111-1111-1111-111111111111'
  const sourceRef: SourceRef = {
    workspaceId,
    sourceId: '22222222-2222-2222-2222-222222222222',
    revision: 1,
  }
  const mockNow = new Date('2026-11-10T12:00:00.000Z')

  describe('1. Conversation & Content Consumer Integration', () => {
    it('injects approved channel knowledge alongside manual facts and binds source dependencies & epoch', async () => {
      const candidates: ApprovedCandidateWithSource[] = [
        {
          id: 'c-channel-1',
          source: sourceRef,
          version: 1,
          category: 'offering',
          content: '인스타그램 인기 메뉴: 바닐라 크림 라떼',
          evidence: { documentId: 'doc-1', excerpt: '바닐라 크림 라떼', visionReceiptId: null },
          evidenceState: 'observed',
          status: 'approved',
          conflictsWithFactId: null,
          sourcePlatform: 'instagram',
          sourceRevision: 1,
          sourceStatus: 'verified',
          leaseExpiresAt: '2026-11-11T12:00:00.000Z',
          isRevoked: false,
        },
      ]

      const deps: ContextDeps = {
        getApprovedCandidates: async () => candidates,
        getWorkspaceEpoch: async () => 5,
        getManualFacts: async () => [
          { id: 'm-1', category: 'identity', content: '상호: 소희의 달콤한 카페' },
        ],
        now: () => mockNow,
      }

      const result = await buildLearningContext(
        {
          workspaceId,
          purpose: 'conversation',
          query: '라떼',
          channel: 'instagram',
          maxCharacters: 1000,
        },
        deps,
      )

      expect(result.text).toContain('상호: 소희의 달콤한 카페')
      expect(result.text).toContain('인스타그램 인기 메뉴: 바닐라 크림 라떼')
      expect(result.epoch).toBe(5)
      expect(result.dependencies).toHaveLength(1)
      expect(result.dependencies[0]).toEqual(sourceRef)
    })
  })

  describe('2. Image Generation Consumer Integration (Receipt-backed visual style & user priority)', () => {
    it('injects approved visionReceipt-backed style into visual brief with learningProvenance', () => {
      const visualContext = {
        imageStyle: '따뜻한 우드 톤 테이블과 부드러운 자연광',
        dependencies: [sourceRef],
        epoch: 3,
      }

      const brief = buildVisualBrief({
        workspaceId,
        contentVersionId: 'cv-img-001',
        businessContext: {
          name: '소희 카페',
          industry: 'cafe',
        },
        productContext: {
          name: '크림 라떼',
        },
        channel: 'instagram',
        caption: '신메뉴 크림 라떼를 소개합니다.',
        learnedVisualContext: visualContext,
      })

      expect(brief.promptText).toContain('Learned visual style guidance from approved channel observation')
      expect(brief.promptText).toContain('따뜻한 우드 톤 테이블과 부드러운 자연광')
      expect(brief.promptText).not.toContain('harness restoration')
      expect(brief.learningProvenance?.epoch).toBe(3)
      expect(brief.learningProvenance?.dependencies).toEqual([sourceRef])
    })

    it('prioritizes explicit user customDirection over learned visual style without overwriting', () => {
      const visualContext = {
        imageStyle: '채널에서 학습된 기본 스타일',
        dependencies: [sourceRef],
        epoch: 3,
      }

      const brief = buildVisualBrief({
        workspaceId,
        contentVersionId: 'cv-img-002',
        businessContext: {
          name: '소희 카페',
          industry: 'cafe',
        },
        productContext: {
          name: '크림 라떼',
        },
        channel: 'instagram',
        caption: '신메뉴 크림 라떼를 소개합니다.',
        customDirection: {
          heroSubject: '사장님이 지정한 단독 클로즈업 뷰',
          stylePreset: 'commercial_product',
        },
        learnedVisualContext: visualContext,
      })

      expect(brief.creativeDirection.heroSubject).toBe('사장님이 지정한 단독 클로즈업 뷰')
      expect(brief.creativeDirection.stylePreset).toBe('commercial_product')
    })
  })

  describe('3. Security Gates & Mid-generation Source Revocation / Stale Revision Guard', () => {
    it('blocks result promotion when SQL authority RPC rejects dependencies (source revoked mid-flight)', async () => {
      const mockClient = {
        rpc: vi.fn().mockImplementation((name: string) => {
          if (name === 'validate_learning_result') {
            return Promise.resolve({ data: false, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        }),
      }

      const consumerGate = createSupabaseConsumerGate(mockClient)
      const isValid = await validateLearningResult(
        {
          workspaceId,
          epoch: 2,
          dependencies: [sourceRef],
        },
        consumerGate,
      )

      expect(isValid).toBe(false)
      expect(mockClient.rpc).toHaveBeenCalledWith('validate_learning_result', {
        p_workspace_id: workspaceId,
        p_expected_epoch: 2,
        p_dependencies: [sourceRef],
        p_purpose: 'content',
      })
    })

    it('blocks result promotion when source revision went stale during generation', async () => {
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
      }

      const consumerGate = createSupabaseConsumerGate(mockClient)
      const isValid = await validateLearningResult(
        {
          workspaceId,
          epoch: 2,
          dependencies: [sourceRef],
        },
        consumerGate,
      )

      expect(isValid).toBe(false)
    })

    it('blocks result promotion when RPC execution fails or rejects', async () => {
      const mockClient = {
        rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC_FAILED' } }),
      }

      const isCurrent = await verifyDependenciesCurrent(
        mockClient as any,
        workspaceId,
        1,
        [sourceRef],
      )
      expect(isCurrent).toBe(false)
    })
  })

  describe('4. Feature Flag & Manual Knowledge Preservation', () => {
    it('blocks channel source facts when SOHEE_CHANNEL_LEARNING_ENABLED != 1 while strictly preserving manual/file knowledge', async () => {
      const originalEnv = process.env.SOHEE_CHANNEL_LEARNING_ENABLED
      try {
        delete process.env.SOHEE_CHANNEL_LEARNING_ENABLED

        const mixedItems = [
          { id: '1', source_type: 'manual', content: '수동' },
          { id: '2', source_type: 'channel', content: '인스타' },
        ]
        expect(filterApprovedContextForChannelLearning(mixedItems, false)).toHaveLength(1)

        const mockGateway = {
          profile: async () => ({ data: { business_name: '소희 매장', industry: '카페' }, error: null }),
          knowledge: async () => ({ data: null, error: null }),
          textRule: async () => ({ data: null, error: null }),
          facts: async () => ({
            data: [
              { id: 'f-manual-1', source_type: 'manual', category: 'MENU', content: '수동 메뉴: 아메리카노 4500원' },
              { id: 'f-channel-1', source_type: 'channel', category: 'MENU', content: '인스타 피드 학습 메뉴 5500원' },
            ],
            error: null,
          }),
        }

        const ctx = await loadGroundedBusinessContext(workspaceId, mockGateway as any)
        expect(ctx.facts.some((f) => f.value.includes('수동 메뉴: 아메리카노 4500원'))).toBe(true)
        expect(ctx.facts.some((f) => f.value.includes('인스타 피드 학습 메뉴 5500원'))).toBe(false)
      } finally {
        if (originalEnv !== undefined) {
          process.env.SOHEE_CHANNEL_LEARNING_ENABLED = originalEnv
        } else {
          delete process.env.SOHEE_CHANNEL_LEARNING_ENABLED
        }
      }
    })
  })

  describe('5. Real Producer Call-site Observable Effects & Financial Guard (Draft & Image Generation)', () => {
    it('blocks generateChannelDraft vault save and aborts draft promotion when source is revoked mid-flight (provider called 1, saved 0, refund 0)', async () => {
      const mockSave = vi.fn()
      const mockCreditRelease = vi.fn()
      const mockCreditSettle = vi.fn()
      const mockTextGenerate = vi.fn().mockResolvedValue(
        JSON.stringify({
          instagram: { caption: '라떼 맛집' },
          threads: { text: '라떼 드시러 오세요' },
          naver_blog: { title: '라떼 안내', blocks: [{ text: '라떼 설명' }] },
          daangn_business: { text: '동네 이웃 라떼 할인' },
        }),
      )

      const mockDeps: any = {
        loadContext: vi.fn().mockResolvedValue({
          businessName: '소희 카페',
          industry: '카페',
          location: '서울',
          facts: [{ kind: 'offering', label: '메뉴', value: '시그니처 라떼 5000원' }],
          knowledgeVersion: 1,
          warnings: [],
          epoch: 2,
          dependencies: [sourceRef],
          tone: { presetKey: 'friendly', brandVoice: '친절하고 다정한 말투' },
        }),
        buildBaseDraft: vi.fn().mockReturnValue({ topic: '라떼', draftText: '맛있는 라떼' }),
        checkClaims: vi.fn().mockReturnValue({ status: 'READY', issues: [] }),
        text: {
          generateText: mockTextGenerate,
        },
        image: vi.fn().mockResolvedValue({ imageIds: [], notice: null, media: [] }),
        repo: {
          findByRequestKey: vi.fn().mockResolvedValue(null),
          reserve: vi.fn().mockResolvedValue({ kind: 'reserved' }),
          release: vi.fn().mockResolvedValue(undefined),
          save: mockSave,
        },
        credits: {
          reserve: vi.fn().mockResolvedValue({ id: 'text-hold-1', cost: 1 }),
          settle: mockCreditSettle,
          release: mockCreditRelease,
        },
        // Mid-generation revocation simulated: validateLearning returns false!
        validateLearning: vi.fn().mockResolvedValue(false),
      }

      await expect(
        generateChannelDraft(
          {
            workspaceId,
            userId: 'user-1111',
            requestKey: '33333333-3333-4333-8333-333333333333',
            topic: '신메뉴 안내',
          },
          mockDeps,
        ),
      ).rejects.toMatchObject({
        code: 'KNOWLEDGE_UNAVAILABLE',
        status: 503,
      })

      // 1. Observable proof: provider was executed 1 time
      expect(mockTextGenerate).toHaveBeenCalledTimes(1)

      // 2. Observable proof: vault repo.save must NOT have been called (draft not stored)
      expect(mockSave).not.toHaveBeenCalled()

      // 3. Financial proof: once provider attempted, no auto-refund (hold preserved for reconciliation)
      expect(mockCreditRelease).not.toHaveBeenCalled()
      expect(mockCreditSettle).not.toHaveBeenCalled()

      // 4. Concurrency slot release
      expect(mockDeps.repo.release).toHaveBeenCalled()
    })

    it('maybeGenerateStudioImage drops generated image and returns fallback notice when source is revoked mid-generation', async () => {
      const originalFlag = process.env.SOHEE_CHANNEL_LEARNING_ENABLED
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'

      try {
        const mockAdmin = {
          rpc: vi.fn().mockImplementation((name: string) => {
            if (name === 'get_approved_learning_context') {
              return Promise.resolve({
                data: {
                  epoch: 3,
                  items: [
                    {
                      category: 'visual',
                      content: '우드 톤 매트 질감 사진 스타일',
                      source_id: sourceRef.sourceId,
                      source_revision: 1,
                      epoch: 3,
                    },
                  ],
                },
                error: null,
              })
            }
            if (name === 'validate_learning_result') {
              // Source was revoked mid-image generation!
              return Promise.resolve({ data: false, error: null })
            }
            return Promise.resolve({ data: null, error: null })
          }),
          from: vi.fn().mockImplementation((table: string) => {
            if (table === 'media_assets') {
              return {
                insert: vi.fn().mockResolvedValue({ error: null }),
              }
            }
            return {}
          }),
          storage: {
            from: vi.fn().mockReturnValue({
              upload: vi.fn().mockResolvedValue({ data: { path: 'path/1' }, error: null }),
            }),
          },
        }

        const mockImageClient = {
          generateImage: vi.fn().mockResolvedValue({
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: 'image/jpeg',
            sizeBytes: 3,
            sha256Digest: 'sha-fake-1',
            model: 'gpt-image-2',
          }),
        }

        const validWorkspaceId = '11111111-1111-4111-8111-111111111111'
        const validUserId = '22222222-2222-4222-8222-222222222222'

        const result = await maybeGenerateStudioImage({
          includeImage: true,
          admin: mockAdmin,
          workspaceId: validWorkspaceId,
          userId: validUserId,
          topic: '따뜻한 라떼',
          context: {
            businessName: '소희 카페',
            industry: '카페',
          },
          imageClient: mockImageClient as any,
        })

        // Image must be dropped and degraded gracefully to fallback notice without leaking unverified image
        expect(result.imageIds).toEqual([])
        expect(result.notice).toBe(STUDIO_IMAGE_FALLBACK_NOTICE)
        expect(result.providerAttempted).toBe(true)
        expect(result.needsReconciliation).toBe(true)
      } finally {
        if (originalFlag !== undefined) {
          process.env.SOHEE_CHANNEL_LEARNING_ENABLED = originalFlag
        } else {
          delete process.env.SOHEE_CHANNEL_LEARNING_ENABLED
        }
      }
    })

    it('maybeGenerateStudioImage ignores channel visual knowledge and skips gate when SOHEE_CHANNEL_LEARNING_ENABLED is off', async () => {
      const originalFlag = process.env.SOHEE_CHANNEL_LEARNING_ENABLED
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '0'

      try {
        const rpcValidate = vi.fn().mockResolvedValue({ data: false, error: null })
        const mockAdmin = {
          rpc: vi.fn().mockImplementation((name: string) => {
            if (name === 'get_approved_learning_context') {
              return Promise.resolve({
                data: {
                  epoch: 3,
                  items: [
                    {
                      category: 'visual',
                      content: '우드 톤 매트 질감 사진 스타일',
                      source_type: 'channel',
                      source_id: sourceRef.sourceId,
                      source_revision: 1,
                      epoch: 3,
                    },
                  ],
                },
                error: null,
              })
            }
            if (name === 'validate_learning_result') {
              return rpcValidate()
            }
            return Promise.resolve({ data: null, error: null })
          }),
          from: vi.fn().mockImplementation((table: string) => {
            if (table === 'media_assets') {
              return {
                insert: vi.fn().mockResolvedValue({ error: null }),
              }
            }
            return {}
          }),
          storage: {
            from: vi.fn().mockReturnValue({
              upload: vi.fn().mockResolvedValue({ data: { path: 'path/1' }, error: null }),
            }),
          },
        }

        const mockImageClient = {
          generateImage: vi.fn().mockResolvedValue({
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: 'image/jpeg',
            sizeBytes: 3,
            sha256Digest: 'sha-fake-1',
            model: 'gpt-image-2',
          }),
        }

        const validWorkspaceId = '11111111-1111-4111-8111-111111111111'
        const validUserId = '22222222-2222-4222-8222-222222222222'

        const result = await maybeGenerateStudioImage({
          includeImage: true,
          admin: mockAdmin,
          workspaceId: validWorkspaceId,
          userId: validUserId,
          topic: '따뜻한 라떼',
          context: {
            businessName: '소희 카페',
            industry: '카페',
          },
          imageClient: mockImageClient as any,
        })

        // Flag is off: channel visual knowledge ignored, image generation succeeds without calling gate
        expect(result.imageIds.length).toBe(1)
        expect(result.notice).toBeNull()
        expect(rpcValidate).not.toHaveBeenCalled()
      } finally {
        if (originalFlag !== undefined) {
          process.env.SOHEE_CHANNEL_LEARNING_ENABLED = originalFlag
        } else {
          delete process.env.SOHEE_CHANNEL_LEARNING_ENABLED
        }
      }
    })

    it('generateChannelDraft retains imageHold for reconciliation instead of auto-refunding when image was generated but stale dropped', async () => {
      const mockCreditRelease = vi.fn()
      const mockCreditSettle = vi.fn()
      const mockSave = vi.fn().mockImplementation((input: any) => Promise.resolve({
        requestKey: input.requestKey,
        topic: input.topic,
        createdAt: '2026-11-10T12:00:00.000Z',
        basisNotes: input.basisNotes,
        variants: input.variants.map((v: any) => ({
          channel: v.channel,
          payload: v.payload,
          status: v.status,
          statusLabel: v.statusLabel,
          issues: v.issues,
          contentId: 'c-1',
          versionId: 'v-1',
          vaultSavable: true,
          blockedReason: null,
        })),
        imageNotice: input.imageNotice,
      }))

      const mockDeps: any = {
        loadContext: vi.fn().mockResolvedValue({
          businessName: '소희 카페',
          industry: '카페',
          location: '서울',
          facts: [{ kind: 'offering', label: '메뉴', value: '시그니처 라떼 5000원' }],
          knowledgeVersion: 1,
          warnings: [],
          epoch: 1,
          dependencies: [], // Text itself has no channel dependencies
          tone: { presetKey: 'friendly', brandVoice: '친절한 말투' },
        }),
        buildBaseDraft: vi.fn().mockReturnValue({ topic: '라떼', draftText: '맛있는 라떼' }),
        checkClaims: vi.fn().mockReturnValue({ status: 'READY', issues: [] }),
        text: {
          generateText: vi.fn().mockResolvedValue(
            JSON.stringify({
              instagram: { caption: '라떼 맛집' },
              threads: { text: '라떼 드시러 오세요' },
              naver_blog: { title: '라떼 안내', blocks: [{ text: '라떼 설명' }] },
              daangn_business: { text: '동네 이웃 라떼 할인' },
            }),
          ),
        },
        // Image provider executed, but post-generation gate dropped image!
        image: vi.fn().mockResolvedValue({
          imageIds: [],
          notice: STUDIO_IMAGE_FALLBACK_NOTICE,
          media: [],
          providerAttempted: true,
          needsReconciliation: true,
        }),
        repo: {
          findByRequestKey: vi.fn().mockResolvedValue(null),
          reserve: vi.fn().mockResolvedValue({ kind: 'reserved' }),
          release: vi.fn().mockResolvedValue(undefined),
          save: mockSave,
        },
        credits: {
          reserve: vi.fn().mockImplementation((_ws, _req, kind) => Promise.resolve({ id: `${kind}-hold`, cost: 1 })),
          settle: mockCreditSettle,
          release: mockCreditRelease,
        },
      }

      const result = await generateChannelDraft(
        {
          workspaceId,
          userId: 'user-1111',
          requestKey: '33333333-3333-4333-8333-444444444444',
          topic: '라떼 안내',
          includeImage: true,
        },
        mockDeps,
      )

      expect(result.imageNotice).toBe(STUDIO_IMAGE_FALLBACK_NOTICE)
      // Crucial financial verification:
      // text provider executed and succeeded -> text-hold settled
      expect(mockCreditSettle).toHaveBeenCalledWith(workspaceId, expect.objectContaining({ id: 'text-hold' }))
      // image provider executed (paid call made) but dropped -> auto-refund release must NOT be called,
      // hold is preserved for reconciliation!
      expect(mockCreditRelease).not.toHaveBeenCalledWith(workspaceId, expect.objectContaining({ id: 'image-hold' }))
      expect(mockCreditSettle).not.toHaveBeenCalledWith(workspaceId, expect.objectContaining({ id: 'image-hold' }))
    })
  })
})
