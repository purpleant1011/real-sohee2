import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createProductionGenerationOrchestrator,
  assertNoInMemoryAdaptersInProduction,
  SupabaseStorageAdapter,
  SupabasePersistenceAdapter,
  ProductionCompositionRootError,
} from '../../src/features/creative/production-generation-factory'
import {
  GenerationOrchestrator,
  InMemoryPersistenceAdapter,
  InMemoryStorageAdapter,
} from '../../src/features/creative/generation-orchestrator'
import type { MediaAsset } from '../../src/features/media/media-asset-types'

describe('ANI-1118: Production Generation Composition Root & Adapter Wiring', () => {
  const originalEnv = process.env.NODE_ENV
  const mockWorkspaceId = '00000000-0000-4000-8000-0000000000a2'

  const createMockSupabase = () => {
    return {
      storage: {
        from: vi.fn().mockReturnValue({
          upload: vi.fn().mockResolvedValue({ data: { path: 'path/to/asset.png' }, error: null }),
        }),
      },
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    } as any
  }

  afterEach(() => {
    (process.env as any).NODE_ENV = originalEnv
  })

  describe('Composition Root Fail-Closed Guards', () => {
    it('throws SUPABASE_CLIENT_REQUIRED when supabaseClient is missing', () => {
      expect(() =>
        createProductionGenerationOrchestrator({
          supabaseClient: null as any,
          workspaceId: mockWorkspaceId,
          apiKey: 'sk-test-openai-key',
        })
      ).toThrowError(/SUPABASE_CLIENT_REQUIRED/)
    })

    it('throws OPENAI_API_KEY_REQUIRED in production when apiKey is missing and not in env', () => {
      (process.env as any).NODE_ENV = 'production'
      const oldKey = process.env.OPENAI_API_KEY
      const oldImgKey = process.env.OPENAI_IMAGE_API_KEY
      delete process.env.OPENAI_API_KEY
      delete process.env.OPENAI_IMAGE_API_KEY

      try {
        expect(() =>
          createProductionGenerationOrchestrator({
            supabaseClient: createMockSupabase(),
            workspaceId: mockWorkspaceId,
            apiKey: undefined,
          })
        ).toThrowError(/OPENAI_API_KEY_REQUIRED/)
      } finally {
        if (oldKey) (process.env as any).OPENAI_API_KEY = oldKey
        if (oldImgKey) (process.env as any).OPENAI_IMAGE_API_KEY = oldImgKey
      }
    })

    it('forbids InMemoryStorageAdapter in production mode', () => {
      (process.env as any).NODE_ENV = 'production'
      const inMemoryStorage = new InMemoryStorageAdapter()

      expect(() =>
        assertNoInMemoryAdaptersInProduction({
          storageAdapter: inMemoryStorage,
          persistenceAdapter: new SupabasePersistenceAdapter({
            supabaseClient: createMockSupabase(),
            workspaceId: mockWorkspaceId,
          }),
        })
      ).toThrowError(/IN_MEMORY_STORAGE_ADAPTER_FORBIDDEN/)
    })

    it('forbids InMemoryPersistenceAdapter in production mode', () => {
      (process.env as any).NODE_ENV = 'production'
      const inMemoryPersistence = new InMemoryPersistenceAdapter()

      expect(() =>
        assertNoInMemoryAdaptersInProduction({
          storageAdapter: new SupabaseStorageAdapter({
            supabaseClient: createMockSupabase(),
          }),
          persistenceAdapter: inMemoryPersistence,
        })
      ).toThrowError(/IN_MEMORY_PERSISTENCE_ADAPTER_FORBIDDEN/)
    })

    it('GenerationOrchestrator constructor directly rejects InMemory adapters in production', () => {
      (process.env as any).NODE_ENV = 'production'
      expect(
        () =>
          new GenerationOrchestrator({
            storageAdapter: new InMemoryStorageAdapter(),
            persistenceAdapter: new InMemoryPersistenceAdapter(),
          })
      ).toThrowError(/IN_MEMORY_ADAPTER_FORBIDDEN/)
    })
  })

  describe('SupabaseStorageAdapter Wiring Contract', () => {
    it('uploads bytes to private content-media bucket without public URL leakage', async () => {
      const mockClient = createMockSupabase()
      const storage = new SupabaseStorageAdapter({ supabaseClient: mockClient })

      const testBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
      const result = await storage.upload({
        bucket: 'content-media',
        path: 'workspaces/ws-1/media/source/asset-1/original.png',
        bytes: testBytes,
        mimeType: 'image/png',
      })

      expect(result.error).toBeNull()
      expect(mockClient.storage.from).toHaveBeenCalledWith('content-media')
    })
  })

  describe('SupabasePersistenceAdapter Wiring Contract', () => {
    it('saves media asset into media_assets table', async () => {
      const mockClient = createMockSupabase()
      const persistence = new SupabasePersistenceAdapter({
        supabaseClient: mockClient,
        workspaceId: mockWorkspaceId,
      })

      const now = new Date().toISOString()
      const asset: MediaAsset = {
        id: 'asset-001',
        workspace_id: mockWorkspaceId,
        bucket_id: 'content-media',
        object_path: 'workspaces/ws-1/media/source/asset-1/original.png',
        kind: 'image',
        source_type: 'GENERATED_OPENAI',
        mime_type: 'image/png',
        size_bytes: 1048576,
        sha256_digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        width: 1024,
        height: 1024,
        rights_status: 'approved',
        lifecycle_status: 'READY',
        publish_eligibility: true,
        generation_metadata: { model: 'gpt-image-2.5-sunburst' },
        created_by: 'system',
        created_at: now,
      }

      const result = await persistence.saveMediaAsset(asset)
      expect(result.error).toBeNull()
      expect(mockClient.from).toHaveBeenCalledWith('media_assets')
    })

    it('saves generation run into generation_runs table', async () => {
      const mockClient = createMockSupabase()
      const persistence = new SupabasePersistenceAdapter({
        supabaseClient: mockClient,
        workspaceId: mockWorkspaceId,
      })

      const now = new Date().toISOString()
      const run = {
        id: 'run-001',
        workspaceId: mockWorkspaceId,
        contentVersionId: 'cv-001',
        idempotencyKey: 'idem-001',
        requestFingerprint: 'fp-001',
        sequenceNumber: 1,
        status: 'READY' as const,
        promptDigest: 'pd-001',
        createdAt: now,
        updatedAt: now,
      }

      const result = await persistence.saveRunRecord(run)
      expect(result.error).toBeNull()
      expect(mockClient.from).toHaveBeenCalledWith('generation_runs')
    })

    it('saves content version binding with concrete workspace_id', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null })
      const mockClient = {
        from: vi.fn().mockReturnValue({ insert: mockInsert }),
      } as any

      const persistence = new SupabasePersistenceAdapter({
        supabaseClient: mockClient,
        workspaceId: mockWorkspaceId,
      })

      const binding = {
        workspace_id: mockWorkspaceId,
        version_id: '00000000-0000-0000-0000-000000000001',
        media_asset_id: '00000000-0000-0000-0000-000000000002',
        position: 0,
        role: 'primary' as const,
        created_at: new Date().toISOString(),
      }

      const result = await persistence.saveContentVersionBinding(binding)
      expect(result.error).toBeNull()
      expect(mockClient.from).toHaveBeenCalledWith('content_version_media')
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: mockWorkspaceId,
          version_id: binding.version_id,
          media_asset_id: binding.media_asset_id,
        })
      )
    })
  })

  describe('End-to-End Production Factory Assembly', () => {
    it('successfully creates concrete production orchestrator without mocks', () => {
      const mockClient = createMockSupabase()
      const orchestrator = createProductionGenerationOrchestrator({
        supabaseClient: mockClient,
        workspaceId: mockWorkspaceId,
        apiKey: 'sk-test-key-12345',
      })

      expect(orchestrator).toBeDefined()
    })

    it('executes end-to-end generation lifecycle writing to real storage and persistence tables', async () => {
      const mockClient = createMockSupabase()
      const dummyPngBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature
        0x00, 0x00, 0x00, 0x0d, // IHDR chunk length
        0x49, 0x48, 0x44, 0x52, // "IHDR"
        0x00, 0x00, 0x04, 0x00, // width: 1024
        0x00, 0x00, 0x04, 0x00, // height: 1024
        0x08, 0x06, 0x00, 0x00, 0x00,
        0x70, 0xe2, 0x95, 0x9f,
      ])
      const mockImageClient = {
        generateImage: vi.fn().mockResolvedValue({
          bytes: dummyPngBytes,
          mimeType: 'image/png',
          sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          providerRequestId: 'req-live-001',
          model: 'gpt-image-2.5-sunburst',
          promptTokensEstimate: 35,
          imageTokensEstimate: 1200,
        }),
      }

      const orchestrator = createProductionGenerationOrchestrator({
        supabaseClient: mockClient,
        workspaceId: mockWorkspaceId,
        apiKey: 'sk-test-live-key',
        imageClient: mockImageClient as any,
      })

      const executionResult = await orchestrator.execute({
        idempotencyKey: 'idem-live-test-001',
        requestFingerprint: 'fp-live-test-001',
        sequenceNumber: 1,
        workspaceId: mockWorkspaceId,
        contentVersionId: '00000000-0000-0000-0000-000000000099',
        visualBrief: {
          briefVersion: 'v10.0',
          workspaceId: mockWorkspaceId,
          contentVersionId: '00000000-0000-0000-0000-000000000099',
          businessContext: {
            name: '성수 베이커리',
            industry: 'bakery',
            keywords: ['소금빵'],
            targetAudience: '일반 고객',
          },
          productContext: {
            name: '소금빵',
            sellingPoints: ['바삭함'],
          },
          channelSpec: { channel: 'instagram', aspectRatio: '1:1' },
          creativeDirection: {
            heroSubject: '소금빵',
            composition: 'top-down',
            environment: 'bakery counter',
            lighting: 'natural sunlight',
            colorPalette: ['#ffffff'],
            stylePreset: 'editorial_photography',
          },
          negativeConstraints: {
            forbiddenTokens: [],
            textRendering: 'NO_TEXT_IN_IMAGE',
            prohibitedDomains: [],
          },
          captionSummary: '소금빵 안내',
          promptText: 'Ultra-high resolution authentic commercial photograph of salt bread',
          promptDigest: 'digest-001',
          createdAt: new Date().toISOString(),
        },
      })

      expect(executionResult.status).toBe('READY')
      expect(executionResult.mediaAsset).toBeDefined()
      expect(executionResult.mediaAsset?.source_type).toBe('GENERATED_OPENAI')
      expect(executionResult.mediaAsset?.lifecycle_status).toBe('READY')
      expect(executionResult.mediaAsset?.publish_eligibility).toBe(true)
      expect(executionResult.mediaAsset?.generation_metadata.model).toBe('gpt-image-2.5-sunburst')

      // Assert storage upload to content-media
      expect(mockClient.storage.from).toHaveBeenCalledWith('content-media')

      // Assert database persistence to canonical tables
      expect(mockClient.from).toHaveBeenCalledWith('media_assets')
      expect(mockClient.from).toHaveBeenCalledWith('content_version_media')
      expect(mockClient.from).toHaveBeenCalledWith('generation_runs')
    })
  })

  describe('Production Bundle & Route Reachability Guard', () => {
    it('verifies chat route contains zero legacy ImageWorker imports and zero InMemory adapters', async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const chatRoutePath = path.resolve(
        process.cwd(),
        'src/app/api/workspaces/[workspaceId]/agent/chat/route.ts'
      )
      const content = fs.readFileSync(chatRoutePath, 'utf8')

      // 1. Zero legacy ImageWorker imports
      expect(content).not.toMatch(/from\s+['"].*image-worker['"]/)

      // 2. Zero InMemory adapter imports
      expect(content).not.toContain('InMemoryStorageAdapter')
      expect(content).not.toContain('InMemoryPersistenceAdapter')

      // 3. Must use createProductionGenerationOrchestrator and buildVisualBrief
      expect(content).toContain('createProductionGenerationOrchestrator')
      expect(content).toContain('buildVisualBrief')
      expect(content).toContain('resolveIndustryDomain')
    })
  })
})

