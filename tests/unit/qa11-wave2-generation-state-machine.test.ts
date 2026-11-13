import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  GenerationOrchestrator,
  InMemoryPersistenceAdapter,
  InMemoryStorageAdapter,
} from '../../src/features/creative/generation-orchestrator'
import type { OpenAIImageClient } from '../../src/features/creative/openai-image-client'
import { CreativeGenerationError } from '../../src/features/creative/creative-generation-types'

describe('ANI-1123: Generation Retry·Stale·Cancel·FinOps Idempotency Production State Machine', () => {
  const validPng1024 = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x04, 0x00, // 1024
    0x00, 0x00, 0x04, 0x00, // 1024
    0x08, 0x06, 0x00, 0x00, 0x00,
    0x70, 0xe2, 0x95, 0x9f,
  ])

  const createMockBrief = (workspaceId = 'ws-sm-001', contentVersionId = 'ver-sm-001') => ({
    briefVersion: 'v11.0',
    workspaceId,
    contentVersionId,
    businessContext: {
      name: '소희 베이커리',
      industry: 'bakery' as const,
      keywords: ['크루아상'],
      targetAudience: '2030',
    },
    productContext: {
      name: '플레인 크루아상',
      sellingPoints: ['버터 풍미'],
    },
    channelSpec: { channel: 'instagram' as const, aspectRatio: '1:1' as const },
    creativeDirection: {
      heroSubject: '크루아상',
      composition: 'flatlay',
      environment: 'marble table',
      lighting: 'bright natural',
      colorPalette: ['#gold'],
      stylePreset: 'editorial_photography' as const,
    },
    negativeConstraints: {
      forbiddenTokens: [],
      textRendering: 'NO_TEXT_IN_IMAGE' as const,
      prohibitedDomains: [],
    },
    captionSummary: '버터 풍미 가득한 플레인 크루아상',
    promptText: 'Golden flaky French croissant on marble table',
    promptDigest: 'sha256-croissant-digest',
    createdAt: new Date().toISOString(),
  })

  let storage: InMemoryStorageAdapter
  let persistence: InMemoryPersistenceAdapter

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
    persistence = new InMemoryPersistenceAdapter()
  })

  describe('Bounded Exponential Retry with Attempts & Cost Separation', () => {
    it('retries on 429/5xx and records all attempts in actual usage, but charges logical customer settlement only once', async () => {
      let callCount = 0
      const mockImageClient: OpenAIImageClient = {
        generateImage: vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount === 1) {
            const err: any = new Error('Rate limit exceeded')
            err.status = 429
            throw err
          }
          return {
            bytes: validPng1024,
            mimeType: 'image/png',
            sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            providerRequestId: 'req_retry_success',
            model: 'gpt-image-2.5-sunburst',
            promptTokensEstimate: 20,
            imageTokensEstimate: 1024,
          }
        }),
      }

      const recordedUsages: any[] = []
      persistence.recordFinOpsUsage = vi.fn().mockImplementation(async (usage) => {
        recordedUsages.push(usage)
        return { error: null }
      })

      const orchestrator = new GenerationOrchestrator({
        imageClient: mockImageClient,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
        retryPolicy: {
          maxRetries: 2,
          initialDelayMs: 1, // fast test delay
          backoffFactor: 1,
        },
      })

      const result = await orchestrator.execute({
        idempotencyKey: 'idem-retry-429-success',
        requestFingerprint: 'fp-retry-429-success',
        sequenceNumber: 1,
        workspaceId: 'ws-sm-001',
        contentVersionId: 'ver-sm-001',
        visualBrief: createMockBrief(),
      })

      expect(result.status).toBe('READY')
      expect(callCount).toBe(2) // 1 failure + 1 success

      // Verification: Attempts recorded in run record
      const run = await persistence.getExistingRunByIdempotency('idem-retry-429-success')
      expect(run).not.toBeNull()
      expect(run?.attempts).toBeDefined()
      expect(run?.attempts).toHaveLength(2)
      expect(run?.attempts?.[0].status).toBe('FAILED')
      expect(run?.attempts?.[1].status).toBe('SUCCESS')

      // Verification: Logical Customer settlement is charged exactly 150 SC once
      expect(result.usage?.computedCredits).toBe(150)
      expect(recordedUsages).toHaveLength(1)
      expect(recordedUsages[0].computedCredits).toBe(150)
    })

    it('fails closed with 0 credits charged when max retries are exhausted on 503 Service Unavailable', async () => {
      const mockImageClient: OpenAIImageClient = {
        generateImage: vi.fn().mockImplementation(async () => {
          const err: any = new Error('Service Unavailable')
          err.status = 503
          throw err
        }),
      }

      const recordedUsages: any[] = []
      persistence.recordFinOpsUsage = vi.fn().mockImplementation(async (usage) => {
        recordedUsages.push(usage)
        return { error: null }
      })

      const orchestrator = new GenerationOrchestrator({
        imageClient: mockImageClient,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
        retryPolicy: {
          maxRetries: 2,
          initialDelayMs: 1,
          backoffFactor: 1,
        },
      })

      await expect(
        orchestrator.execute({
          idempotencyKey: 'idem-503-exhausted',
          requestFingerprint: 'fp-503-exhausted',
          sequenceNumber: 1,
          workspaceId: 'ws-sm-001',
          contentVersionId: 'ver-sm-001',
          visualBrief: createMockBrief(),
        })
      ).rejects.toThrowError(/IMAGE_PROVIDER_UNAVAILABLE/)

      // All 3 attempts (initial + 2 retries) recorded as failed
      const run = await persistence.getExistingRunByIdempotency('idem-503-exhausted')
      expect(run?.status).toBe('FAILED')
      expect(run?.attempts).toHaveLength(3)

      // Zero credits charged to customer on provider failure
      expect(recordedUsages).toHaveLength(0)
    })

    it('fails immediately without retry on non-retryable 400 content policy violation', async () => {
      let callCount = 0
      const mockImageClient: OpenAIImageClient = {
        generateImage: vi.fn().mockImplementation(async () => {
          callCount++
          const err: any = new Error('Content policy violation')
          err.status = 400
          err.code = 'content_policy_violation'
          throw err
        }),
      }

      const orchestrator = new GenerationOrchestrator({
        imageClient: mockImageClient,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
      })

      await expect(
        orchestrator.execute({
          idempotencyKey: 'idem-policy-fail',
          requestFingerprint: 'fp-policy-fail',
          sequenceNumber: 1,
          workspaceId: 'ws-sm-001',
          contentVersionId: 'ver-sm-001',
          visualBrief: createMockBrief(),
        })
      ).rejects.toThrowError(/IMAGE_POLICY_REJECTED/)

      // Non-retryable error must terminate immediately after attempt 1
      expect(callCount).toBe(1)
      const run = await persistence.getExistingRunByIdempotency('idem-policy-fail')
      expect(run?.status).toBe('FAILED')
      expect(run?.attempts).toHaveLength(1)
    })
  })

  describe('User Regenerate & Supersede Race (Delayed Stale Result Quarantine)', () => {
    it('quarantines delayed old sequence result and prevents it from becoming current_media_asset or primary candidate', async () => {
      let resolveSeq1Provider: (value: any) => void
      const seq1Promise = new Promise((resolve) => {
        resolveSeq1Provider = resolve
      })

      const mockImageClient: OpenAIImageClient = {
        generateImage: vi.fn().mockImplementation(async (input: any) => {
          if (input.prompt.includes('SEQ_1')) {
            return seq1Promise
          }
          return {
            bytes: validPng1024,
            mimeType: 'image/png',
            sha256Digest: 'sha256-seq2-digest',
            providerRequestId: 'req_seq_2',
            model: 'gpt-image-2.5-sunburst',
            promptTokensEstimate: 20,
            imageTokensEstimate: 1024,
          }
        }),
      }

      const orchestrator = new GenerationOrchestrator({
        imageClient: mockImageClient,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 1000,
      })

      // 1. User starts Generation Sequence 1
      const brief1 = createMockBrief('ws-sm-001', 'ver-sm-001')
      brief1.promptText = 'Croissant SEQ_1'
      const seq1Execution = orchestrator.execute({
        idempotencyKey: 'idem-seq-1',
        requestFingerprint: 'fp-seq-1',
        sequenceNumber: 1,
        workspaceId: 'ws-sm-001',
        contentVersionId: 'ver-sm-001',
        visualBrief: brief1,
      })

      // 2. While sequence 1 is still generating, user requests regenerate (Sequence 2)
      const brief2 = createMockBrief('ws-sm-001', 'ver-sm-001')
      brief2.promptText = 'Croissant SEQ_2'
      const seq2Result = await orchestrator.execute({
        idempotencyKey: 'idem-seq-2',
        requestFingerprint: 'fp-seq-2',
        sequenceNumber: 2,
        workspaceId: 'ws-sm-001',
        contentVersionId: 'ver-sm-001',
        visualBrief: brief2,
      })

      expect(seq2Result.status).toBe('READY')
      expect(seq2Result.mediaAsset).toBeDefined()
      const seq2AssetId = seq2Result.mediaAsset?.id

      // Current primary binding must belong to sequence 2
      const bindingsAfterSeq2 = persistence.getAllBindings()
      expect(bindingsAfterSeq2).toHaveLength(1)
      expect(bindingsAfterSeq2[0].media_asset_id).toBe(seq2AssetId)

      // 3. Now sequence 1 provider response finally arrives (delayed arrival)
      resolveSeq1Provider!({
        bytes: validPng1024,
        mimeType: 'image/png',
        sha256Digest: 'sha256-seq1-digest',
        providerRequestId: 'req_seq_1',
        model: 'gpt-image-2.5-sunburst',
        promptTokensEstimate: 20,
        imageTokensEstimate: 1024,
      })

      const seq1Result = await seq1Execution

      // Sequence 1 must be demoted to STALE_RESULT / SUPERSEDED
      expect(seq1Result.status).toBe('STALE_RESULT')

      // Delayed sequence 1 asset must NOT be publishable and NOT be current
      const seq1Run = await persistence.getExistingRunByIdempotency('idem-seq-1')
      expect(seq1Run?.status).toBe('STALE_RESULT')
      expect(seq1Run?.is_current).toBe(false)

      // Sequence 1 asset must not usurp sequence 2's primary binding in content_version_media
      const currentBindings = persistence.getAllBindings()
      const primaryBinding = currentBindings.find((b) => b.role === 'primary')
      expect(primaryBinding?.media_asset_id).toBe(seq2AssetId)

      // Sequence 1 asset (if saved) must be quarantined / not publishable
      if (seq1Result.mediaAsset) {
        expect(seq1Result.mediaAsset.publish_eligibility).toBe(false)
        expect(seq1Result.mediaAsset.lifecycle_status).toBe('QUARANTINED')
      }
    })
  })

  describe('Explicit Run Cancellation & In-flight Cleanup', () => {
    it('aborts persistence and cleans up storage when run is canceled before commit', async () => {
      let resolveProvider: (value: any) => void
      const providerPromise = new Promise((resolve) => {
        resolveProvider = resolve
      })

      const mockImageClient: OpenAIImageClient = {
        generateImage: vi.fn().mockImplementation(() => providerPromise),
      }

      const orchestrator = new GenerationOrchestrator({
        imageClient: mockImageClient,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
      })

      const execution = orchestrator.execute({
        idempotencyKey: 'idem-cancel-run',
        requestFingerprint: 'fp-cancel-run',
        sequenceNumber: 1,
        workspaceId: 'ws-sm-001',
        contentVersionId: 'ver-sm-001',
        visualBrief: createMockBrief(),
      })

      // Cancel the run while provider is running
      await new Promise((res) => setTimeout(res, 10))
      const run = await persistence.getExistingRunByIdempotency('idem-cancel-run')
      expect(run).not.toBeNull()
      await orchestrator.cancelRun(run!.id, 'User clicked cancel')

      // Resolve provider delayed
      resolveProvider!({
        bytes: validPng1024,
        mimeType: 'image/png',
        sha256Digest: 'sha256-cancel-digest',
        providerRequestId: 'req_cancel_01',
        model: 'gpt-image-2.5-sunburst',
        promptTokensEstimate: 20,
        imageTokensEstimate: 1024,
      })

      const result = await execution
      expect(result.status).toBe('CANCELED')

      // Storage must have 0 objects (cleaned up)
      expect(storage.uploaded.size).toBe(0)

      // Zero bindings
      expect(persistence.getAllBindings()).toHaveLength(0)

      // Zero credits charged
      const updatedRun = await persistence.getExistingRunByIdempotency('idem-cancel-run')
      expect(updatedRun?.status).toBe('CANCELED')
    })
  })

  describe('Idempotency Replay Side-Effect Zero Guarantee', () => {
    it('guarantees zero provider calls, zero usage events, and zero credit re-deductions on repeated replay', async () => {
      const mockImageClient: OpenAIImageClient = {
        generateImage: vi.fn().mockResolvedValue({
          bytes: validPng1024,
          mimeType: 'image/png',
          sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          providerRequestId: 'req_replay_01',
          model: 'gpt-image-2.5-sunburst',
          promptTokensEstimate: 20,
          imageTokensEstimate: 1024,
        }),
      }

      const recordedUsages: any[] = []
      persistence.recordFinOpsUsage = vi.fn().mockImplementation(async (usage) => {
        recordedUsages.push(usage)
        return { error: null }
      })

      const orchestrator = new GenerationOrchestrator({
        imageClient: mockImageClient,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
      })

      // First run
      const res1 = await orchestrator.execute({
        idempotencyKey: 'idem-side-effect-zero',
        requestFingerprint: 'fp-side-effect-zero',
        sequenceNumber: 1,
        workspaceId: 'ws-sm-001',
        contentVersionId: 'ver-sm-001',
        visualBrief: createMockBrief(),
      })
      expect(res1.status).toBe('READY')
      expect(mockImageClient.generateImage).toHaveBeenCalledTimes(1)
      expect(recordedUsages).toHaveLength(1)

      // Second replay
      const res2 = await orchestrator.execute({
        idempotencyKey: 'idem-side-effect-zero',
        requestFingerprint: 'fp-side-effect-zero',
        sequenceNumber: 1,
        workspaceId: 'ws-sm-001',
        contentVersionId: 'ver-sm-001',
        visualBrief: createMockBrief(),
      })
      expect(res2.isReplay).toBe(true)
      expect(res2.status).toBe('READY')

      // Third replay
      const res3 = await orchestrator.execute({
        idempotencyKey: 'idem-side-effect-zero',
        requestFingerprint: 'fp-side-effect-zero',
        sequenceNumber: 1,
        workspaceId: 'ws-sm-001',
        contentVersionId: 'ver-sm-001',
        visualBrief: createMockBrief(),
      })
      expect(res3.isReplay).toBe(true)

      // Total provider calls remain 1
      expect(mockImageClient.generateImage).toHaveBeenCalledTimes(1)
      // Total usage events recorded in DB remain 1
      expect(recordedUsages).toHaveLength(1)
      // Bindings remain exactly 1
      expect(persistence.getAllBindings()).toHaveLength(1)
    })

    it('strictly fails closed when provider evidence contains legacy gpt-image-2 model', async () => {
      const legacyMock: OpenAIImageClient = {
        generateImage: vi.fn().mockResolvedValue({
          bytes: validPng1024,
          mimeType: 'image/png',
          sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          providerRequestId: 'req_legacy_state_machine',
          model: 'gpt-image-2',
          promptTokensEstimate: 20,
          imageTokensEstimate: 1024,
        }),
      }

      const orchestrator = new GenerationOrchestrator({
        imageClient: legacyMock,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
      })

      await expect(
        orchestrator.execute({
          idempotencyKey: 'idem-sm-legacy-reject',
          requestFingerprint: 'fp-sm-legacy',
          sequenceNumber: 1,
          workspaceId: 'ws-sm-001',
          contentVersionId: 'ver-sm-001',
          visualBrief: createMockBrief(),
        })
      ).rejects.toThrowError(/PROVIDER_MODEL_MISMATCH/)
    })
  })
})
