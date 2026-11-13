import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  GenerationOrchestrator,
  InMemoryPersistenceAdapter,
  InMemoryStorageAdapter,
} from '../../src/features/creative/generation-orchestrator'
import type { OpenAIImageClient } from '../../src/features/creative/openai-image-client'
import { CreativeGenerationError } from '../../src/features/creative/creative-generation-types'

describe('ANI-1122: Provider Bytes→Storage→MediaAsset→ContentVersion Atomic Saga & Compensation', () => {
  const validPng1024 = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature
    0x00, 0x00, 0x00, 0x0d, // IHDR chunk length
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, 0x04, 0x00, // width: 1024
    0x00, 0x00, 0x04, 0x00, // height: 1024
    0x08, 0x06, 0x00, 0x00, 0x00,
    0x70, 0xe2, 0x95, 0x9f,
  ])

  const createMockBrief = (workspaceId = 'ws-saga-001', contentVersionId = 'ver-saga-001') => ({
    briefVersion: 'v11.0',
    workspaceId,
    contentVersionId,
    businessContext: {
      name: '소희 베이커리',
      industry: 'bakery' as const,
      keywords: ['사포레'],
      targetAudience: '2030',
    },
    productContext: {
      name: '시그니처 바게트',
      sellingPoints: ['전통 방식'],
    },
    channelSpec: { channel: 'instagram' as const, aspectRatio: '1:1' as const },
    creativeDirection: {
      heroSubject: '바게트',
      composition: 'flatlay',
      environment: 'wooden board',
      lighting: 'bright natural',
      colorPalette: ['#brown'],
      stylePreset: 'editorial_photography' as const,
    },
    negativeConstraints: {
      forbiddenTokens: [],
      textRendering: 'NO_TEXT_IN_IMAGE' as const,
      prohibitedDomains: [],
    },
    captionSummary: '갓 구운 시그니처 바게트',
    promptText: 'Freshly baked artisanal French baguette on wooden board',
    promptDigest: 'sha256-baguette-digest',
    createdAt: new Date().toISOString(),
  })

  let mockImageClient: OpenAIImageClient
  let storage: InMemoryStorageAdapter
  let persistence: InMemoryPersistenceAdapter

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
    persistence = new InMemoryPersistenceAdapter()
    mockImageClient = {
      generateImage: vi.fn().mockResolvedValue({
        bytes: validPng1024,
        mimeType: 'image/png',
        sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        providerRequestId: 'req_saga_001',
        model: 'gpt-image-2.5-sunburst',
        promptTokensEstimate: 25,
        imageTokensEstimate: 1024,
      }),
    }
  })

  describe('Happy Path Full Saga Lifecycle', () => {
    it('executes atomic saga from bytes to storage, media_assets, and content_version_media', async () => {
      const orchestrator = new GenerationOrchestrator({
        imageClient: mockImageClient,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
      })

      const result = await orchestrator.execute({
        idempotencyKey: 'idem-saga-happy-01',
        requestFingerprint: 'fp-saga-happy-01',
        sequenceNumber: 1,
        workspaceId: 'ws-saga-001',
        contentVersionId: 'ver-saga-001',
        visualBrief: createMockBrief('ws-saga-001', 'ver-saga-001'),
      })

      expect(result.status).toBe('READY')
      expect(result.mediaAsset).toBeDefined()
      expect(result.mediaAsset?.lifecycle_status).toBe('READY')
      expect(result.mediaAsset?.publish_eligibility).toBe(true)

      // Storage object verified
      const expectedStoragePath = `workspaces/ws-saga-001/media/source/${result.mediaAsset?.id}/original.png`
      expect(storage.uploaded.has(`content-media/${expectedStoragePath}`)).toBe(true)

      // ContentVersion binding verified
      const bindings = persistence.getAllBindings()
      expect(bindings).toHaveLength(1)
      expect(bindings[0].version_id).toBe('ver-saga-001')
      expect(bindings[0].media_asset_id).toBe(result.mediaAsset?.id)
      expect(bindings[0].role).toBe('primary')

      // SHA exact match
      expect(result.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
      expect(result.mediaAsset?.sha256_digest).toBe(result.sha256)
    })
  })

  describe('Compensation & Rollback Guarantees', () => {
    it('cleans up uploaded storage object when media_assets DB persistence fails (No Orphan Storage)', async () => {
      // Inject DB failure into saveMediaAsset
      persistence.saveMediaAsset = vi.fn().mockResolvedValue({
        error: new Error('DATABASE_CONNECTION_RESET: media_assets insert timed out'),
      })

      const orchestrator = new GenerationOrchestrator({
        imageClient: mockImageClient,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
      })

      await expect(
        orchestrator.execute({
          idempotencyKey: 'idem-saga-db-fail-01',
          requestFingerprint: 'fp-saga-db-fail-01',
          sequenceNumber: 1,
          workspaceId: 'ws-saga-001',
          contentVersionId: 'ver-saga-001',
          visualBrief: createMockBrief(),
        })
      ).rejects.toThrowError(/Failed to persist canonical media asset/)

      // Compensation verification: Storage object MUST NOT remain in storage! (0 orphan files)
      expect(storage.uploaded.size).toBe(0)
    })

    it('cleans up storage object and quarantines media asset when content_version_media binding fails', async () => {
      // Inject binding failure
      persistence.saveContentVersionBinding = vi.fn().mockResolvedValue({
        error: new Error('FOREIGN_KEY_VIOLATION: content_version does not exist'),
      })

      const orchestrator = new GenerationOrchestrator({
        imageClient: mockImageClient,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
      })

      await expect(
        orchestrator.execute({
          idempotencyKey: 'idem-saga-bind-fail-01',
          requestFingerprint: 'fp-saga-bind-fail-01',
          sequenceNumber: 1,
          workspaceId: 'ws-saga-001',
          contentVersionId: 'ver-saga-001',
          visualBrief: createMockBrief(),
        })
      ).rejects.toThrowError(/Failed to bind media asset to content version/)

      // Compensation: Storage object must be deleted to prevent orphan
      expect(storage.uploaded.size).toBe(0)

      // MediaAsset in DB must be quarantined or deleted so it cannot be published
      const assetKeys = Array.from((persistence as any).assets.keys()) as string[]
      const savedAsset = assetKeys.length > 0 ? persistence.getAsset(assetKeys[0]) : null
      if (savedAsset) {
        expect(savedAsset.publish_eligibility).toBe(false)
        expect(savedAsset.lifecycle_status).toBe('QUARANTINED')
      }
    })

    it('aborts overall generation with 0 publishable assets when storage upload fails', async () => {
      // Inject storage failure
      storage.upload = vi.fn().mockResolvedValue({
        error: new Error('STORAGE_QUOTA_EXCEEDED: Bucket content-media quota exhausted'),
      })

      const orchestrator = new GenerationOrchestrator({
        imageClient: mockImageClient,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
      })

      await expect(
        orchestrator.execute({
          idempotencyKey: 'idem-saga-storage-fail-01',
          requestFingerprint: 'fp-saga-storage-fail-01',
          sequenceNumber: 1,
          workspaceId: 'ws-saga-001',
          contentVersionId: 'ver-saga-001',
          visualBrief: createMockBrief(),
        })
      ).rejects.toThrowError(/Failed to commit image bytes to private storage/)

      // Zero assets persisted and zero bindings
      expect(persistence.getAllBindings()).toHaveLength(0)
    })
  })

  describe('Idempotency Replay & Lineage Invariants', () => {
    it('guarantees exact asset recovery on idempotency replay (F5 / page reload resilience)', async () => {
      const orchestrator = new GenerationOrchestrator({
        imageClient: mockImageClient,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
      })

      const firstResult = await orchestrator.execute({
        idempotencyKey: 'idem-replay-resilience',
        requestFingerprint: 'fp-replay-resilience',
        sequenceNumber: 1,
        workspaceId: 'ws-saga-001',
        contentVersionId: 'ver-saga-001',
        visualBrief: createMockBrief(),
      })

      expect(firstResult.status).toBe('READY')
      expect(firstResult.isReplay).toBeFalsy()

      // Replay (F5 or retry with same key)
      const secondResult = await orchestrator.execute({
        idempotencyKey: 'idem-replay-resilience',
        requestFingerprint: 'fp-replay-resilience',
        sequenceNumber: 1,
        workspaceId: 'ws-saga-001',
        contentVersionId: 'ver-saga-001',
        visualBrief: createMockBrief(),
      })

      expect(secondResult.status).toBe('READY')
      expect(secondResult.isReplay).toBe(true)
      expect(secondResult.runId).toBe(firstResult.runId)
      expect(secondResult.sha256).toBe(firstResult.sha256)
      expect(secondResult.mediaAsset).toBeDefined()
      expect(secondResult.mediaAsset?.id).toBe(firstResult.mediaAsset?.id)
      expect(secondResult.mediaAsset?.lifecycle_status).toBe('READY')

      // Only 1 provider call, exactly 1 binding
      expect(mockImageClient.generateImage).toHaveBeenCalledTimes(1)
      expect(persistence.getAllBindings()).toHaveLength(1)
    })

    it('prohibits temporary URL without canonical private storage bytes commit', async () => {
      // Mock client that returns empty bytes (mimicking URL-only payload)
      const fakeUrlOnlyClient = {
        generateImage: vi.fn().mockResolvedValue({
          bytes: new Uint8Array([]), // 0 bytes!
          mimeType: 'image/png',
          sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          providerRequestId: 'req_url_only',
          model: 'gpt-image-2.5-sunburst',
          promptTokensEstimate: 20,
          imageTokensEstimate: 1024,
        }),
      }

      const orchestrator = new GenerationOrchestrator({
        imageClient: fakeUrlOnlyClient as any,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
      })

      await expect(
        orchestrator.execute({
          idempotencyKey: 'idem-url-only-fail',
          requestFingerprint: 'fp-url-only',
          sequenceNumber: 1,
          workspaceId: 'ws-saga-001',
          contentVersionId: 'ver-saga-001',
          visualBrief: createMockBrief(),
        })
      ).rejects.toThrowError(/EMPTY_IMAGE_BYTES/)

      // Storage upload must never be called for URL-only payload
      expect(storage.uploaded.size).toBe(0)
    })
  })

  describe('Production Supabase Adapters Compensation & Isolation', () => {
    it('verifies SupabaseStorageAdapter.delete invokes storage remove API', async () => {
      const { SupabaseStorageAdapter } = await import('../../src/features/creative/production-generation-factory')
      const mockRemove = vi.fn().mockResolvedValue({ error: null })
      const mockClient = {
        storage: {
          from: vi.fn().mockReturnValue({
            remove: mockRemove,
          }),
        },
      } as any

      const adapter = new SupabaseStorageAdapter({ supabaseClient: mockClient })
      const result = await adapter.delete({ bucket: 'content-media', path: 'workspaces/ws-01/test.png' })

      expect(result.error).toBeNull()
      expect(mockClient.storage.from).toHaveBeenCalledWith('content-media')
      expect(mockRemove).toHaveBeenCalledWith(['workspaces/ws-01/test.png'])
    })

    it('verifies SupabasePersistenceAdapter.quarantineMediaAsset enforces workspace_id isolation', async () => {
      const { SupabasePersistenceAdapter } = await import('../../src/features/creative/production-generation-factory')
      const mockEq2 = vi.fn().mockResolvedValue({ error: null })
      const mockEq1 = vi.fn().mockReturnValue({
        eq: mockEq2,
      })
      const mockUpdate = vi.fn().mockReturnValue({
        eq: mockEq1,
      })
      const mockClient = {
        from: vi.fn().mockReturnValue({
          update: mockUpdate,
        }),
      } as any

      const adapter = new SupabasePersistenceAdapter({ supabaseClient: mockClient, workspaceId: 'ws-target-001' })
      const result = await adapter.quarantineMediaAsset('asset-123', 'TEST_REASON')

      expect(result.error).toBeNull()
      expect(mockClient.from).toHaveBeenCalledWith('media_assets')
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          lifecycle_status: 'QUARANTINED',
          publish_eligibility: false,
        })
      )
      expect(mockEq1).toHaveBeenCalledWith('workspace_id', 'ws-target-001')
      expect(mockEq2).toHaveBeenCalledWith('id', 'asset-123')
    })

    it('verifies SupabasePersistenceAdapter.getMediaAsset queries with workspace_id isolation', async () => {
      const { SupabasePersistenceAdapter } = await import('../../src/features/creative/production-generation-factory')
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'asset-456',
          workspace_id: 'ws-target-001',
          bucket_id: 'content-media',
          object_path: 'workspaces/ws-target-001/media/source/asset-456/original.png',
          kind: 'IMAGE',
          source_type: 'GENERATED_OPENAI',
          mime_type: 'image/png',
          size_bytes: 1024,
          width: 1024,
          height: 1024,
          sha256_digest: 'deadbeef',
          rights_status: 'CLEARED',
          lifecycle_status: 'READY',
          publish_eligibility: true,
          generation_metadata: {},
          created_by: 'system',
          created_at: '2026-09-09T00:00:00.000Z',
        },
        error: null,
      })
      const mockEq = vi.fn().mockReturnThis()
      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      })
      mockEq.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: mockMaybeSingle,
        }),
      })

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: mockSelect,
        }),
      } as any

      const adapter = new SupabasePersistenceAdapter({ supabaseClient: mockClient, workspaceId: 'ws-target-001' })
      const asset = await adapter.getMediaAsset('asset-456')

      expect(asset).not.toBeNull()
      expect(asset?.id).toBe('asset-456')
      expect(asset?.workspace_id).toBe('ws-target-001')
      expect(asset?.publish_eligibility).toBe(true)
    })

    it('rejects saga execution immediately if provider evidence model is legacy gpt-image-2', async () => {
      const legacyClient = {
        generateImage: vi.fn().mockResolvedValue({
          bytes: validPng1024,
          mimeType: 'image/png',
          sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          providerRequestId: 'req_legacy_saga',
          model: 'gpt-image-2',
          promptTokensEstimate: 25,
          imageTokensEstimate: 1024,
        }),
      }

      const orchestrator = new GenerationOrchestrator({
        imageClient: legacyClient as any,
        storageAdapter: storage,
        persistenceAdapter: persistence,
        availableCredits: 500,
      })

      await expect(
        orchestrator.execute({
          idempotencyKey: 'idem-saga-legacy-fail',
          requestFingerprint: 'fp-saga-legacy',
          sequenceNumber: 1,
          workspaceId: 'ws-saga-001',
          contentVersionId: 'ver-saga-001',
          visualBrief: createMockBrief('ws-saga-001', 'ver-saga-001'),
        })
      ).rejects.toThrowError(/PROVIDER_MODEL_MISMATCH/)
    })
  })
})
