import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  GenerationOrchestrator,
  InMemoryPersistenceAdapter,
  InMemoryStorageAdapter,
} from '@/features/creative/generation-orchestrator'
import type { OpenAIImageClient, ImageGenerationCallOutput } from '@/features/creative/openai-image-client'
import { verifyImageBinaryMagic } from '@/features/creative/openai-image-client'
import { buildVisualBrief } from '@/features/creative/visual-brief-builder'
import { CreativeGenerationError } from '@/features/creative/creative-generation-types'

describe('Wave 2: Real GPT-Image-2 Generation Orchestrator & FinOps (ANI-1075, ANI-1076, ANI-1097, ANI-1099)', () => {
  const validPngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x00, // 1024x1024
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  ])

  const brief = buildVisualBrief({
    workspaceId: '00000000-0000-4000-8000-0000000000a2',
    contentVersionId: 'cv-test-100',
    businessContext: {
      name: '소희네 베이커리',
      industry: 'bakery',
      keywords: ['타르트', '디저트'],
      targetAudience: '2030 디저트 애호가',
    },
    productContext: {
      name: '단호박 타르트',
      sellingPoints: ['은은한 단맛'],
    },
    channel: 'instagram',
    caption: '달콤하고 부드러운 소희네 단호박 타르트가 완성되었습니다!',
  })

  let mockClient: OpenAIImageClient
  let persistence: InMemoryPersistenceAdapter
  let storage: InMemoryStorageAdapter

  beforeEach(() => {
    persistence = new InMemoryPersistenceAdapter()
    storage = new InMemoryStorageAdapter()
    mockClient = {
      generateImage: vi.fn().mockResolvedValue({
        bytes: validPngBytes,
        mimeType: 'image/png',
        sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        providerRequestId: 'req_openai_test_123',
        model: 'gpt-image-2.5-sunburst',
        promptTokensEstimate: 150,
        imageTokensEstimate: 1024,
      } as ImageGenerationCallOutput),
    }
  })

  it('successfully generates, validates bytes, persists to storage and binds to ContentVersion (ANI-1075)', async () => {
    const orchestrator = new GenerationOrchestrator({
      imageClient: mockClient,
      storageAdapter: storage,
      persistenceAdapter: persistence,
      availableCredits: 500,
    })

    const result = await orchestrator.execute({
      idempotencyKey: 'idem-key-001',
      requestFingerprint: 'fp-001',
      sequenceNumber: 1,
      workspaceId: brief.workspaceId,
      contentVersionId: brief.contentVersionId,
      visualBrief: brief,
    })

    expect(result.status).toBe('READY')
    expect(result.mediaAsset).toBeDefined()
    expect(result.mediaAsset?.source_type).toBe('GENERATED_OPENAI')
    expect(result.mediaAsset?.bucket_id).toBe('content-media')
    expect(result.mediaAsset?.width).toBe(1024)
    expect(result.mediaAsset?.height).toBe(1024)
    expect(result.mediaAsset?.lifecycle_status).toBe('READY')
    expect(result.usage?.computedCredits).toBe(150)

    // Verify storage received bytes
    const expectedStoragePath = `workspaces/${brief.workspaceId}/media/source/${result.mediaAsset?.id}/original.png`
    expect(storage.uploaded.has(`content-media/${expectedStoragePath}`)).toBe(true)

    // Verify ContentVersion binding was created
    const bindings = persistence.getAllBindings()
    expect(bindings).toHaveLength(1)
    expect(bindings[0].version_id).toBe(brief.contentVersionId)
    expect(bindings[0].media_asset_id).toBe(result.mediaAsset?.id)
    expect(bindings[0].role).toBe('primary')
    expect(bindings[0].position).toBe(0)
  })

  it('guarantees 0 provider side-effects on idempotency replay (ANI-1076)', async () => {
    const orchestrator = new GenerationOrchestrator({
      imageClient: mockClient,
      storageAdapter: storage,
      persistenceAdapter: persistence,
      availableCredits: 500,
    })

    const firstResult = await orchestrator.execute({
      idempotencyKey: 'idem-replay-001',
      requestFingerprint: 'fp-replay',
      sequenceNumber: 1,
      workspaceId: brief.workspaceId,
      contentVersionId: brief.contentVersionId,
      visualBrief: brief,
    })
    expect(firstResult.status).toBe('READY')
    expect(firstResult.isReplay).toBeFalsy()

    // Second call with same idempotency key
    const replayResult = await orchestrator.execute({
      idempotencyKey: 'idem-replay-001',
      requestFingerprint: 'fp-replay',
      sequenceNumber: 1,
      workspaceId: brief.workspaceId,
      contentVersionId: brief.contentVersionId,
      visualBrief: brief,
    })

    expect(replayResult.status).toBe('READY')
    expect(replayResult.isReplay).toBe(true)
    // Verify imageClient was only called once!
    expect(mockClient.generateImage).toHaveBeenCalledTimes(1)
  })

  it('blocks stale result from being promoted when a newer sequence has started (ANI-1097)', async () => {
    const orchestrator = new GenerationOrchestrator({
      imageClient: mockClient,
      storageAdapter: storage,
      persistenceAdapter: persistence,
      availableCredits: 500,
    })

    // User triggers regeneration: Sequence 2 starts and completes first
    await orchestrator.execute({
      idempotencyKey: 'idem-seq-2',
      requestFingerprint: 'fp-seq-2',
      sequenceNumber: 2,
      workspaceId: brief.workspaceId,
      contentVersionId: brief.contentVersionId,
      visualBrief: brief,
    })

    // Delayed result from Sequence 1 arrives afterwards
    const staleResult = await orchestrator.execute({
      idempotencyKey: 'idem-seq-1',
      requestFingerprint: 'fp-seq-1',
      sequenceNumber: 1, // Stale sequence!
      workspaceId: brief.workspaceId,
      contentVersionId: brief.contentVersionId,
      visualBrief: brief,
    })

    expect(['SUPERSEDED', 'STALE_RESULT']).toContain(staleResult.status)
    expect(staleResult.error?.code).toBe('GENERATION_SUPERSEDED')
    expect(staleResult.mediaAsset).toBeUndefined()

    // Ensure only sequence 2's asset remains in bindings
    const bindings = persistence.getAllBindings()
    expect(bindings).toHaveLength(1)
  })

  it('fails closed when credit balance is insufficient (ANI-1099)', async () => {
    const brokeOrchestrator = new GenerationOrchestrator({
      imageClient: mockClient,
      storageAdapter: storage,
      persistenceAdapter: persistence,
      availableCredits: 50, // Requires 150 credits
    })

    await expect(
      brokeOrchestrator.execute({
        idempotencyKey: 'idem-broke-01',
        requestFingerprint: 'fp-broke',
        sequenceNumber: 1,
        workspaceId: brief.workspaceId,
        contentVersionId: brief.contentVersionId,
        visualBrief: brief,
      })
    ).rejects.toThrowError(CreativeGenerationError)

    expect(mockClient.generateImage).not.toHaveBeenCalled()
  })

  it('rejects corrupted image binary with invalid headers without silent fallback', () => {
    const corruptBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])
    expect(() => verifyImageBinaryMagic(corruptBytes)).toThrowError(
      /Generated binary does not match valid image signature/
    )
  })

  it('strictly rejects legacy gpt-image-2 provider evidence with PROVIDER_MODEL_MISMATCH (ANI-1460/ANI-1466)', async () => {
    const legacyClient: OpenAIImageClient = {
      generateImage: vi.fn().mockResolvedValue({
        bytes: validPngBytes,
        mimeType: 'image/png',
        sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        providerRequestId: 'req_legacy_001',
        model: 'gpt-image-2',
        promptTokensEstimate: 150,
        imageTokensEstimate: 1024,
      } as ImageGenerationCallOutput),
    }

    const orchestrator = new GenerationOrchestrator({
      imageClient: legacyClient,
      storageAdapter: storage,
      persistenceAdapter: persistence,
      availableCredits: 500,
    })

    await expect(
      orchestrator.execute({
        idempotencyKey: 'idem-legacy-fail-001',
        requestFingerprint: 'fp-legacy',
        sequenceNumber: 1,
        workspaceId: brief.workspaceId,
        contentVersionId: brief.contentVersionId,
        visualBrief: brief,
      })
    ).rejects.toThrowError(/PROVIDER_MODEL_MISMATCH/)
  })
})
