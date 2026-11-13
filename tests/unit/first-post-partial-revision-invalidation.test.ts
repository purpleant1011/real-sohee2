// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  calculateApprovalFingerprint,
  type FirstPostMissionDraft,
  reviseFirstPostMissionDraft,
} from '@/features/missions/conversational-first-post'

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

vi.mock('@/features/creative/production-generation-factory', () => ({
  createProductionGenerationOrchestrator: vi.fn(),
}))

vi.mock('@/features/creative/visual-brief-builder', () => ({
  buildVisualBrief: vi.fn().mockImplementation((params) => ({
    ...params,
    _briefMock: true,
  })),
}))

import { POST as revisePOST } from '@/app/api/missions/first-post/revise/route'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createProductionGenerationOrchestrator } from '@/features/creative/production-generation-factory'

describe('First Post Partial Revision & Approval Invalidation Invariants (ANI-1458)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    // The real composer checks for a key before reaching the mocked fetch.
    vi.stubEnv('GEMINI_API_KEY', 'test-revision-key')

    // Safety guard: strictly forbid any unmocked live network calls to prevent test hangs
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      return Promise.reject(
        new Error(`[TEST_UNHANDLED_FETCH] Unmocked live network call prevented: ${String(url)}`)
      )
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('Pure helper invariants', () => {
    it('invalidates prior approval fingerprint and requires re-approval on any modification', () => {
      const originalDraft: FirstPostMissionDraft = {
        missionId: 'm-1',
        workspaceId: 'ws-1',
        status: 'APPROVED_FOR_PUBLISH',
        topic: '오픈 안내',
        goal: '첫인사',
        copies: {
          instagram: { caption: '원본 인스타' },
          threads: { content: '원본 스레드' },
        },
        selectedImageIds: ['img-1'],
        boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 },
        rights: { rightsStatus: 'USER_CONFIRMED', consentStatus: 'NOT_APPLICABLE' },
        channels: [{ provider: 'instagram', handle: '@test' }],
        approvalFingerprint: 'initial_fp',
        createdAt: new Date().toISOString(),
      }

      const revisedCopies = {
        ...originalDraft.copies,
        instagram: { caption: '수정된 인스타' },
      }
      const newFingerprint = calculateApprovalFingerprint({
        workspaceId: originalDraft.workspaceId,
        missionId: originalDraft.missionId,
        channels: originalDraft.channels,
        copies: revisedCopies,
        imageIds: originalDraft.selectedImageIds,
        boundVersions: originalDraft.boundVersions,
        rights: originalDraft.rights,
      })

      expect(newFingerprint).not.toBe(originalDraft.approvalFingerprint)
    })

    it('TEXT_ONLY revision keeps image IDs identical while revising copies and invalidating approval', () => {
      const originalDraft: FirstPostMissionDraft = {
        missionId: 'm-1',
        workspaceId: 'ws-1',
        status: 'APPROVED_FOR_PUBLISH',
        topic: '오픈 안내',
        goal: '첫인사',
        copies: {
          instagram: { caption: '인스타그램 원본' },
          threads: { content: '스레드 원본' },
        },
        selectedImageIds: ['asset-img-001', 'asset-img-002'],
        boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 },
        rights: { rightsStatus: 'USER_CONFIRMED', consentStatus: 'NOT_APPLICABLE' },
        channels: [{ provider: 'instagram', handle: '@test' }],
        approvalFingerprint: 'fp-111',
        createdAt: new Date().toISOString(),
      }

      const { revisedDraft } = reviseFirstPostMissionDraft({
        draft: originalDraft,
        revisionType: 'TEXT_ONLY',
        feedbackUtterance: '더 담백하게 바꿔줘',
      })

      expect(revisedDraft.status).toBe('AWAITING_EXACT_APPROVAL')
      expect(revisedDraft.selectedImageIds).toEqual(originalDraft.selectedImageIds)
      expect(revisedDraft.approvalFingerprint).not.toBe(originalDraft.approvalFingerprint)
    })

    it('IMAGE_ONLY revision retains text byte-for-byte and updates images when new images are provided', () => {
      const originalDraft: FirstPostMissionDraft = {
        missionId: 'm-1',
        workspaceId: 'ws-1',
        status: 'APPROVED_FOR_PUBLISH',
        topic: '오픈 안내',
        goal: '첫인사',
        copies: {
          instagram: { caption: '인스타그램 원본 그대로' },
          threads: { content: '스레드 원본 그대로' },
        },
        selectedImageIds: ['asset-img-001'],
        boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 },
        rights: { rightsStatus: 'USER_CONFIRMED', consentStatus: 'NOT_APPLICABLE' },
        channels: [{ provider: 'instagram', handle: '@test' }],
        approvalFingerprint: 'fp-111',
        createdAt: new Date().toISOString(),
      }

      const { revisedDraft } = reviseFirstPostMissionDraft({
        draft: originalDraft,
        revisionType: 'IMAGE_ONLY',
        feedbackUtterance: '조금 더 화사한 톤으로 바꿔줘',
        newImageIds: ['persisted-asset-uuid-999'],
        mediaPreviews: [{ id: 'persisted-asset-uuid-999', url: '/api/workspaces/ws-1/media/persisted-asset-uuid-999' }],
      })

      expect(revisedDraft.status).toBe('AWAITING_EXACT_APPROVAL')
      expect(revisedDraft.copies).toEqual(originalDraft.copies)
      expect(revisedDraft.selectedImageIds).toEqual(['persisted-asset-uuid-999'])
      expect(revisedDraft.selectedImageIds[0]).not.toContain('_revised')
      expect(revisedDraft.mediaPreviews).toEqual([
        { id: 'persisted-asset-uuid-999', url: '/api/workspaces/ws-1/media/persisted-asset-uuid-999' },
      ])
      expect(revisedDraft.approvalFingerprint).not.toBe(originalDraft.approvalFingerprint)
    })
  })

  describe('Route POST /api/missions/first-post/revise', () => {
    const mockWorkspaceId = 'ws-test-123'
    const mockMissionId = 'mission-test-789'

    const createInitialDraft = (): FirstPostMissionDraft => ({
      missionId: mockMissionId,
      workspaceId: mockWorkspaceId,
      status: 'APPROVED_FOR_PUBLISH',
      topic: '오픈 안내 및 첫인사',
      goal: '첫 게시물 발행 미션',
      copies: {
        instagram: {
          caption: '안녕하세요, 온기 카페입니다. 첫 발걸음을 함께해 주세요 ☕',
          hashtags: ['#온기카페', '#오픈'],
        },
        threads: {
          content: '온기 카페 첫 인사 올립니다 ☕',
        },
      },
      selectedImageIds: ['orig-asset-111'],
      mediaPreviews: [{ id: 'orig-asset-111', url: `/api/workspaces/${mockWorkspaceId}/media/orig-asset-111` }],
      boundVersions: {
        knowledgeVersion: 1,
        textHarnessVersion: 1,
        imageHarnessVersion: 1,
        operatingPolicyVersion: 1,
      },
      rights: { rightsStatus: 'USER_CONFIRMED', consentStatus: 'NOT_APPLICABLE' },
      channels: [{ provider: 'instagram', handle: '@onki_cafe' }],
      approvalFingerprint: 'orig-fingerprint-abc',
      knowledgeSnapshot: {
        businessName: '온기 카페',
        signatureServices: ['핸드드립 커피'],
      },
      createdAt: new Date().toISOString(),
    })

    function setupSupabaseMocks(draft: FirstPostMissionDraft, options?: { failCas?: boolean }) {
      const createChainableUpdate = () => {
        const query: any = {}
        query.eq = vi.fn().mockImplementation(() => query)
        query.select = vi.fn().mockImplementation(() => {
          if (options?.failCas) {
            return Promise.resolve({ data: [], error: null })
          }
          return Promise.resolve({
            data: [{ id: draft.missionId, status: 'AWAITING_APPROVAL' }],
            error: null,
          })
        })
        query.then = (resolve: any, reject: any) =>
          Promise.resolve({
            data: options?.failCas ? [] : [{ id: draft.missionId, status: 'AWAITING_APPROVAL' }],
            error: null,
          }).then(resolve, reject)
        return query
      }

      const updateSpy = vi.fn().mockImplementation(() => createChainableUpdate())

      const mockAdminClient = {
        from: vi.fn((table: string) => {
          if (table === 'marketing_missions') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: draft.missionId,
                        workspace_id: draft.workspaceId,
                        status: 'APPROVED_FOR_PUBLISH',
                        metadata: { draft, payload: draft },
                        updated_at: '2026-09-15T12:00:00.000Z',
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
              update: updateSpy,
            }
          }
          if (table === 'channel_connections') {
            // ANI-1775: 수정본 CTA 근거는 연결 상태를 다시 읽어 판정한다.
            const chain: any = {
              select: () => chain,
              eq: () => chain,
              in: () => Promise.resolve({ data: [{ channel: 'instagram', status: 'connected' }], error: null }),
            }
            return chain
          }
          return {}
        }),
      }

      const mockServerClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123' } },
            error: null,
          }),
        },
        from: vi.fn((table: string) => {
          if (table === 'workspace_members') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ workspace_id: mockWorkspaceId }],
                    error: null,
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      vi.mocked(createServerSupabaseClient).mockResolvedValue(mockServerClient as any)
      vi.mocked(createAdminSupabaseClient).mockReturnValue(mockAdminClient as any)

      return { updateSpy }
    }

    it('TEXT_ONLY: calls Gemini 3.5 Lite, keeps original image IDs & mediaPreviews unchanged, and invalidates approval', async () => {
      const draft = createInitialDraft()
      const { updateSpy } = setupSupabaseMocks(draft)

      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    instagram: {
                      caption: '더 담백해진 온기 카페의 첫인사입니다.',
                      hashtags: ['#온기카페'],
                    },
                    threads: {
                      content: '담백한 스레드 첫인사입니다.',
                    },
                  }),
                },
              ],
            },
          },
        ],
      }

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(geminiResponse),
      } as any)

      const executeSpy = vi.fn()
      vi.mocked(createProductionGenerationOrchestrator).mockReturnValue({
        execute: executeSpy,
      } as any)

      const req = new Request('http://localhost/api/missions/first-post/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: mockMissionId,
          revisionType: 'TEXT_ONLY',
          feedbackUtterance: '더 담백한 어조로 바꿔줘',
        }),
      })

      const res = await revisePOST(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      // Image orchestrator MUST NOT be called in TEXT_ONLY mode
      expect(executeSpy).not.toHaveBeenCalled()

      const revised = json.draft as FirstPostMissionDraft
      expect(revised.copies.instagram.caption).toBe('더 담백해진 온기 카페의 첫인사입니다.')
      // ANI-1775: 연결된 채널 + 확정 서비스 근거로 CTA 가 붙는다(수정본도 같은 규칙).
      expect(revised.copies.instagram.cta).toBe('매장에서 핸드드립 커피 만나보세요.')
      expect('cta' in revised.copies.threads).toBe(false)
      // Images must be byte-for-byte and ID unchanged
      expect(revised.selectedImageIds).toEqual(draft.selectedImageIds)
      expect(revised.mediaPreviews).toEqual(draft.mediaPreviews)
      expect(revised.status).toBe('AWAITING_EXACT_APPROVAL')
      expect(revised.approvalFingerprint).not.toBe(draft.approvalFingerprint)

      // DB update verification
      expect(updateSpy).toHaveBeenCalled()
      const updatePayload = updateSpy.mock.calls[0][0]
      expect(updatePayload.status).toBe('AWAITING_APPROVAL')
      expect(updatePayload.metadata.priorApprovalInvalidated).toBe(true)
    })

    it('IMAGE_ONLY: calls GPT Image 2.5 precision orchestrator, keeps text copies byte-for-byte identical, persists new asset and canonical media preview', async () => {
      const draft = createInitialDraft()
      const { updateSpy } = setupSupabaseMocks(draft)

      const executeSpy = vi.fn().mockResolvedValue({
        status: 'READY',
        mediaAsset: {
          id: 'asset-gpt25-new-uuid-777',
          storage_path: `${mockWorkspaceId}/onboarding/calib/asset-gpt25-new-uuid-777.png`,
          byte_size: 2048,
        },
        providerCallEvidence: {
          model: 'gpt-image-2.5-sunburst',
          providerRequestId: 'req_sunburst_001',
        },
      })

      vi.mocked(createProductionGenerationOrchestrator).mockReturnValue({
        execute: executeSpy,
      } as any)

      const req = new Request('http://localhost/api/missions/first-post/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: mockMissionId,
          revisionType: 'IMAGE_ONLY',
          feedbackUtterance: '햇살이 비치는 따뜻한 느낌으로 바꿔줘',
        }),
      })

      const res = await revisePOST(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      // When consentStatus is NOT_APPLICABLE, flare is chosen to strictly avoid unconsented humans
      expect(executeSpy).toHaveBeenCalledTimes(1)
      const executeCall = executeSpy.mock.calls[0][0]
      expect(executeCall.stylePreset).toBe('flare')

      const revised = json.draft as FirstPostMissionDraft
      // Text copies MUST remain 100% byte-for-byte identical
      expect(revised.copies).toEqual(draft.copies)
      // New image asset ID and canonical private URL
      expect(revised.selectedImageIds).toEqual(['asset-gpt25-new-uuid-777'])
      expect(revised.selectedImageIds[0]).not.toContain('_revised')
      expect(revised.mediaPreviews).toEqual([
        { id: 'asset-gpt25-new-uuid-777', url: `/api/workspaces/${mockWorkspaceId}/media/asset-gpt25-new-uuid-777` },
      ])
      expect(revised.status).toBe('AWAITING_EXACT_APPROVAL')
      expect(revised.approvalFingerprint).not.toBe(draft.approvalFingerprint)
    })

    it('IMAGE_ONLY: derives stable operation idempotency key and requestFingerprint across HTTP retries', async () => {
      const draft = createInitialDraft()
      setupSupabaseMocks(draft)

      const executeSpy = vi.fn().mockResolvedValue({
        status: 'READY',
        mediaAsset: { id: 'asset-retry-111', storage_path: 'p', byte_size: 1024 },
      })
      vi.mocked(createProductionGenerationOrchestrator).mockReturnValue({ execute: executeSpy } as any)

      const makeRequest = () =>
        new Request('http://localhost/api/missions/first-post/revise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            missionId: mockMissionId,
            revisionType: 'IMAGE_ONLY',
            feedbackUtterance: '깔끔한 무드로 다시',
          }),
        })

      // First attempt
      const res1 = await revisePOST(makeRequest())
      expect(res1.status).toBe(200)

      // Replay / retry attempt (e.g. timeout retry with same payload)
      const res2 = await revisePOST(makeRequest())
      expect(res2.status).toBe(200)

      expect(executeSpy).toHaveBeenCalledTimes(2)
      const call1 = executeSpy.mock.calls[0][0]
      const call2 = executeSpy.mock.calls[1][0]

      // Idempotency key and request fingerprint must be IDENTICAL across retries
      expect(call1.idempotencyKey).toBe(call2.idempotencyKey)
      expect(call1.requestFingerprint).toBe(call2.requestFingerprint)
      expect(call1.idempotencyKey).not.toContain('undefined')
    })

    it('BOTH: calls both Gemini and GPT Image 2.5 orchestrator and invalidates prior approval', async () => {
      const draft = createInitialDraft()
      const { updateSpy } = setupSupabaseMocks(draft)

      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    instagram: {
                      caption: '새롭게 다시 태어난 온기 카페의 이야기 ✨',
                      hashtags: ['#온기카페', '#새로운시작'],
                    },
                    threads: {
                      content: '새로운 이야기로 다시 인사드려요 🌿',
                    },
                  }),
                },
              ],
            },
          },
        ],
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(geminiResponse),
      } as any)

      const executeSpy = vi.fn().mockResolvedValue({
        status: 'READY',
        mediaAsset: {
          id: 'asset-both-new-uuid-999',
          storage_path: `${mockWorkspaceId}/onboarding/calib/asset-both-new-uuid-999.png`,
          byte_size: 2048,
        },
        providerCallEvidence: {
          model: 'gpt-image-2.5-sunburst',
          providerRequestId: 'req_sunburst_002',
        },
      })

      vi.mocked(createProductionGenerationOrchestrator).mockReturnValue({
        execute: executeSpy,
      } as any)

      const req = new Request('http://localhost/api/missions/first-post/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: mockMissionId,
          revisionType: 'BOTH',
          feedbackUtterance: '문장과 사진 모두 화사하게 바꿔줘',
        }),
      })

      const res = await revisePOST(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(executeSpy).toHaveBeenCalledTimes(1)

      const revised = json.draft as FirstPostMissionDraft
      expect(revised.copies.instagram.caption).toContain('새롭게 다시 태어난 온기 카페')
      expect(revised.selectedImageIds).toEqual(['asset-both-new-uuid-999'])
      expect(revised.mediaPreviews).toEqual([
        { id: 'asset-both-new-uuid-999', url: `/api/workspaces/${mockWorkspaceId}/media/asset-both-new-uuid-999` },
      ])
      expect(revised.status).toBe('AWAITING_EXACT_APPROVAL')
      expect(revised.approvalFingerprint).not.toBe(draft.approvalFingerprint)
    })

    it('Fail-closed: returns 500 when Gemini provider throws error', async () => {
      const draft = createInitialDraft()
      setupSupabaseMocks(draft)

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: vi.fn().mockResolvedValue('Upstream Gemini overloaded'),
      } as any)

      const req = new Request('http://localhost/api/missions/first-post/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: mockMissionId,
          revisionType: 'TEXT_ONLY',
          feedbackUtterance: '수정 요청',
        }),
      })

      const res = await revisePOST(req)
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error).toBeDefined()
    })

    it('Fail-closed: returns 500 when GPT Image 2.5 orchestrator fails to generate image', async () => {
      const draft = createInitialDraft()
      setupSupabaseMocks(draft)

      const executeSpy = vi.fn().mockResolvedValue({
        status: 'FAILED',
        error: { message: 'Content safety policy violation' },
      })

      vi.mocked(createProductionGenerationOrchestrator).mockReturnValue({
        execute: executeSpy,
      } as any)

      const req = new Request('http://localhost/api/missions/first-post/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: mockMissionId,
          revisionType: 'IMAGE_ONLY',
          feedbackUtterance: '수정 요청',
        }),
      })

      const res = await revisePOST(req)
      const json = await res.json()

      expect(res.status).toBe(500)
      expect(json.error).toContain('Content safety policy violation')
    })

    it('IMAGE_ONLY: derives only confirmed facts and strictly omits fabricated facts (no fake 대표 시그니처, 고객, 매장, general, 시각적 스타일 재구성)', async () => {
      const draftWithoutServices: FirstPostMissionDraft = {
        ...createInitialDraft(),
        knowledgeSnapshot: {
          businessName: '바이름 뷰티 살롱 본점',
          signatureServices: [],
          operatingHours: undefined,
        },
      }
      setupSupabaseMocks(draftWithoutServices)

      const executeSpy = vi.fn().mockResolvedValue({
        status: 'READY',
        mediaAsset: { id: 'asset-nobogus-001', storage_path: 'p', byte_size: 1024 },
      })
      vi.mocked(createProductionGenerationOrchestrator).mockReturnValue({ execute: executeSpy } as any)

      const req = new Request('http://localhost/api/missions/first-post/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: mockMissionId,
          revisionType: 'IMAGE_ONLY',
          feedbackUtterance: '깔끔한 무드로 다시',
        }),
      })

      const res = await revisePOST(req)
      expect(res.status).toBe(200)

      const { buildVisualBrief } = await import('@/features/creative/visual-brief-builder')
      expect(buildVisualBrief).toHaveBeenCalled()
      const briefInput = vi.mocked(buildVisualBrief).mock.calls[0][0]

      // Multi-word business name must be strictly preserved
      expect(briefInput.businessContext.name).toBe('바이름 뷰티 살롱 본점')

      // Strictly NO fabricated business facts
      const stringifiedInput = JSON.stringify(briefInput)
      expect(stringifiedInput).not.toContain('대표 시그니처')
      expect(stringifiedInput).not.toContain('시각적 스타일 재구성')
      expect(stringifiedInput).not.toContain('"targetAudience":"고객"')
      expect(stringifiedInput).not.toContain('"location":"매장"')
      expect(stringifiedInput).not.toContain('"industry":"general"')
    })

    it('rejects revision when persisted draft lacks knowledgeSnapshot or businessName (fails closed)', async () => {
      const draftWithoutSnapshot: FirstPostMissionDraft = {
        ...createInitialDraft(),
        knowledgeSnapshot: undefined as any,
      }
      setupSupabaseMocks(draftWithoutSnapshot)

      const req = new Request('http://localhost/api/missions/first-post/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: mockMissionId,
          revisionType: 'TEXT_ONLY',
          feedbackUtterance: '다시 작성해줘',
        }),
      })

      const res = await revisePOST(req)
      expect(res.status).toBe(422)
      const json = await res.json()
      expect(json.code).toBe('PERSISTED_KNOWLEDGE_SNAPSHOT_REQUIRED')
      expect(json.error).toContain('지식 정보')
    })

    it('rejects revision with 409 CONCURRENT_REVISION_CONFLICT when mission state/updated_at changed concurrently', async () => {
      const draft = createInitialDraft()
      // Simulate CAS failure: concurrent update occurred between read and write
      setupSupabaseMocks(draft, { failCas: true })

      const executeSpy = vi.fn().mockResolvedValue({
        status: 'READY',
        mediaAsset: { id: 'asset-cas-test', storage_path: 'p', byte_size: 1024 },
      })
      vi.mocked(createProductionGenerationOrchestrator).mockReturnValue({ execute: executeSpy } as any)

      const req = new Request('http://localhost/api/missions/first-post/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId: mockMissionId,
          revisionType: 'IMAGE_ONLY',
          feedbackUtterance: '어조를 부드럽게',
        }),
      })

      const res = await revisePOST(req)
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.code).toBe('CONCURRENT_REVISION_CONFLICT')
      expect(json.error).toContain('동시성 충돌')
    })
  })
})
