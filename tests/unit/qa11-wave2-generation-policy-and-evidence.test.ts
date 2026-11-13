import { describe, it, expect } from 'vitest'
import {
  IMAGE_GENERATION_POLICY_SSOT,
  resolveImageGenerationPolicy,
  createPolicySnapshot,
  validateProviderModelEvidence,
  computeSettlementFromAttempts,
  type ProviderCallEvidence,
  type GenerationAttemptUsage,
} from '../../src/features/creative/image-generation-policy'

describe('ANI-1120: ImageGenerationPolicy Single SSOT & Provider Evidence', () => {
  describe('Single SSOT Policy Invariants', () => {
    it('enforces gpt-image-2.5-sunburst as the canonical single model with policy version v12.1-gpt-image-2.5-sunburst', () => {
      const policy = resolveImageGenerationPolicy()

      expect(policy.model).toBe('gpt-image-2.5-sunburst')
      expect(policy.policyVersion).toBe('v12.1-gpt-image-2.5-sunburst')
      expect(policy.supportedSizes).toContain('1024x1024')
      expect(policy.defaultSize).toBe('1024x1024')
      expect(policy.outputFormat).toBe('png')
      expect(policy.creditsPerImage).toBe(150)
      expect(policy.costBasisUsdCents).toBe(4)
      expect(policy.timeoutMs).toBe(45000)
    })

    it('rejects forbidden legacy models (dall-e-3) with Fail-Closed error', () => {
      expect(() =>
        resolveImageGenerationPolicy({ requestedModel: 'dall-e-3' as any })
      ).toThrowError(/LEGACY_MODEL_FORBIDDEN/)
    })

    it('creates immutable policy snapshot for durable generation runs', () => {
      const snapshot = createPolicySnapshot({
        size: '1024x1024',
        quality: 'standard',
        outputFormat: 'png',
      })

      expect(snapshot).toEqual({
        policyVersion: 'v12.1-gpt-image-2.5-sunburst',
        model: 'gpt-image-2.5-sunburst',
        size: '1024x1024',
        quality: 'standard',
        outputFormat: 'png',
        creditsPerUnit: 150,
        costBasisUsdCents: 4,
        createdAt: expect.any(String),
      })
    })

    it('rejects unsupported image size with UNSUPPORTED_SIZE error', () => {
      expect(() =>
        createPolicySnapshot({ size: '512x512' as any })
      ).toThrowError(/UNSUPPORTED_SIZE/)
    })
  })

  describe('Provider Evidence & Model Ground Truth Validation', () => {
    it('validates provider evidence strictly requiring real providerRequestId and gpt-image-2.5-sunburst model', () => {
      const validEvidence: ProviderCallEvidence = {
        provider: 'openai',
        model: 'gpt-image-2.5-sunburst',
        providerRequestId: 'req_openai_abc123',
        latencyMs: 3420,
        promptTokens: 85,
        imageTokens: 1024,
        totalTokens: 1109,
        byteSize: 1048576,
        sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      }

      const verified = validateProviderModelEvidence(validEvidence)
      expect(verified.isValid).toBe(true)
      expect(verified.model).toBe('gpt-image-2.5-sunburst')
      expect(verified.providerRequestId).toBe('req_openai_abc123')
    })

    it('fails closed if provider reports unexpected model (e.g. dall-e-3 or dall-e-2)', () => {
      const fakeEvidence: ProviderCallEvidence = {
        provider: 'openai',
        model: 'dall-e-3',
        providerRequestId: 'req_legacy_001',
        latencyMs: 2500,
        promptTokens: 50,
        imageTokens: 1000,
        totalTokens: 1050,
        byteSize: 500000,
        sha256Digest: 'a'.repeat(64),
      }

      expect(() => validateProviderModelEvidence(fakeEvidence)).toThrowError(
        /PROVIDER_MODEL_MISMATCH/
      )
    })

    it('fails closed if providerRequestId is missing or empty', () => {
      const missingReqId: ProviderCallEvidence = {
        provider: 'openai',
        model: 'gpt-image-2',
        providerRequestId: '',
        latencyMs: 1200,
        promptTokens: 30,
        imageTokens: 1024,
        totalTokens: 1054,
        byteSize: 800000,
        sha256Digest: 'b'.repeat(64),
      }

      expect(() => validateProviderModelEvidence(missingReqId)).toThrowError(
        /PROVIDER_REQUEST_ID_REQUIRED/
      )
    })
  })

  describe('Logical Request vs Provider Attempt Accounting Separation', () => {
    it('computes single logical credit settlement regardless of multiple provider retry attempts', () => {
      const attempts: GenerationAttemptUsage[] = [
        {
          attemptNumber: 1,
          providerRequestId: 'req_fail_001',
          model: 'gpt-image-2',
          latencyMs: 45000,
          isSuccess: false,
          promptTokens: 90,
          imageTokens: 0,
          errorCode: 'TIMEOUT',
        },
        {
          attemptNumber: 2,
          providerRequestId: 'req_success_002',
          model: 'gpt-image-2',
          latencyMs: 3200,
          isSuccess: true,
          promptTokens: 90,
          imageTokens: 1024,
        },
      ]

      const settlement = computeSettlementFromAttempts({
        workspaceId: 'ws-test-01',
        isTestAccount: false,
        attempts,
      })

      // Total raw tokens consumed across all attempts
      expect(settlement.totalProviderTokensConsumed).toBe(1204) // (90 + 0) + (90 + 1024)
      expect(settlement.totalAttempts).toBe(2)
      expect(settlement.successfulAttemptNumber).toBe(2)

      // Logical customer credit deduction is exact 150 SC (single generation fee)
      expect(settlement.logicalCreditDeduction).toBe(150)
      expect(settlement.costBasisUsdCents).toBe(4)
    })

    it('deducts 0 credits for test accounts while tracking raw provider tokens', () => {
      const attempts: GenerationAttemptUsage[] = [
        {
          attemptNumber: 1,
          providerRequestId: 'req_test_001',
          model: 'gpt-image-2',
          latencyMs: 2800,
          isSuccess: true,
          promptTokens: 80,
          imageTokens: 1024,
        },
      ]

      const settlement = computeSettlementFromAttempts({
        workspaceId: 'ws-test-01',
        isTestAccount: true,
        attempts,
      })

      expect(settlement.logicalCreditDeduction).toBe(0)
      expect(settlement.totalProviderTokensConsumed).toBe(1104)
    })
  })

  describe('GenerationOrchestrator Policy & Evidence Integration', () => {
    it('persists policySnapshot and policyVersion into media asset metadata on successful run', async () => {
      const { GenerationOrchestrator, InMemoryStorageAdapter, InMemoryPersistenceAdapter } =
        await import('../../src/features/creative/generation-orchestrator')

      const validPng1024 = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature
        0x00, 0x00, 0x00, 0x0d, // IHDR chunk length
        0x49, 0x48, 0x44, 0x52, // "IHDR"
        0x00, 0x00, 0x04, 0x00, // width: 1024
        0x00, 0x00, 0x04, 0x00, // height: 1024
        0x08, 0x06, 0x00, 0x00, 0x00,
        0x70, 0xe2, 0x95, 0x9f,
      ])

      const fakeClient = {
        generateImage: async () => ({
          bytes: validPng1024,
          mimeType: 'image/png',
          sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          providerRequestId: 'req_test_valid_001',
          model: 'gpt-image-2.5-sunburst',
          promptTokensEstimate: 20,
          imageTokensEstimate: 1024,
        }),
      }

      const storage = new InMemoryStorageAdapter()
      const persistence = new InMemoryPersistenceAdapter()
      const orchestrator = new GenerationOrchestrator({
        imageClient: fakeClient as any,
        storageAdapter: storage,
        persistenceAdapter: persistence,
      })

      const createMockVisualBrief = (ws: string, ver: string) => ({
        briefVersion: 'v11.0',
        workspaceId: ws,
        contentVersionId: ver,
        businessContext: {
          name: '소희 베이커리',
          industry: 'bakery' as const,
          keywords: ['베이글'],
          targetAudience: '트렌디 2030',
        },
        productContext: {
          name: '수제 베이글',
          sellingPoints: ['당일 생산'],
        },
        channelSpec: { channel: 'instagram' as const, aspectRatio: '1:1' as const },
        creativeDirection: {
          heroSubject: '베이글',
          composition: 'top-down',
          environment: 'cafe table',
          lighting: 'soft natural light',
          colorPalette: ['#warm'],
          stylePreset: 'editorial_photography' as const,
        },
        negativeConstraints: {
          forbiddenTokens: [],
          textRendering: 'NO_TEXT_IN_IMAGE' as const,
          prohibitedDomains: [],
        },
        captionSummary: '신선한 수제 베이글',
        promptText: 'A modern aesthetic brand image',
        promptDigest: 'sha256-prompt-digest',
        createdAt: new Date().toISOString(),
      })

      const result = await orchestrator.execute({
        idempotencyKey: 'idem-policy-01',
        requestFingerprint: 'fp-policy-01',
        sequenceNumber: 1,
        workspaceId: 'ws-test-policy',
        contentVersionId: 'ver-test-policy',
        visualBrief: createMockVisualBrief('ws-test-policy', 'ver-test-policy'),
      })

      expect(result.status).toBe('READY')
      expect(result.usage?.computedCredits).toBe(150)
      expect(result.usage?.policyVersion).toBe('v12.1-gpt-image-2.5-sunburst')
      expect(result.usage?.costBasisUsdCents).toBe(4)
      expect(result.mediaAsset?.generation_metadata.policyVersion).toBe('v12.1-gpt-image-2.5-sunburst')
      expect(result.mediaAsset?.generation_metadata.policySnapshot).toMatchObject({
        model: 'gpt-image-2.5-sunburst',
        outputFormat: 'png',
        creditsPerUnit: 150,
        costBasisUsdCents: 4,
      })
    })

    it('fails closed when provider returns legacy/fake model or empty providerRequestId', async () => {
      const { GenerationOrchestrator, InMemoryStorageAdapter, InMemoryPersistenceAdapter } =
        await import('../../src/features/creative/generation-orchestrator')

      const fakeLegacyClient = {
        generateImage: async () => ({
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
          mimeType: 'image/png',
          sha256Digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          providerRequestId: 'req_test_fake',
          model: 'dall-e-3', // FORBIDDEN!
          promptTokensEstimate: 20,
          imageTokensEstimate: 1024,
        }),
      }

      const storage = new InMemoryStorageAdapter()
      const persistence = new InMemoryPersistenceAdapter()
      const orchestrator = new GenerationOrchestrator({
        imageClient: fakeLegacyClient as any,
        storageAdapter: storage,
        persistenceAdapter: persistence,
      })

      const createMockVisualBrief = (ws: string, ver: string) => ({
        briefVersion: 'v11.0',
        workspaceId: ws,
        contentVersionId: ver,
        businessContext: {
          name: '소희 베이커리',
          industry: 'bakery' as const,
          keywords: ['베이글'],
          targetAudience: '트렌디 2030',
        },
        productContext: {
          name: '수제 베이글',
          sellingPoints: ['당일 생산'],
        },
        channelSpec: { channel: 'instagram' as const, aspectRatio: '1:1' as const },
        creativeDirection: {
          heroSubject: '베이글',
          composition: 'top-down',
          environment: 'cafe table',
          lighting: 'soft natural light',
          colorPalette: ['#warm'],
          stylePreset: 'editorial_photography' as const,
        },
        negativeConstraints: {
          forbiddenTokens: [],
          textRendering: 'NO_TEXT_IN_IMAGE' as const,
          prohibitedDomains: [],
        },
        captionSummary: '신선한 수제 베이글',
        promptText: 'A modern aesthetic brand image',
        promptDigest: 'sha256-prompt-digest',
        createdAt: new Date().toISOString(),
      })

      await expect(
        orchestrator.execute({
          idempotencyKey: 'idem-policy-fake',
          requestFingerprint: 'fp-policy-fake',
          sequenceNumber: 1,
          workspaceId: 'ws-test-policy',
          contentVersionId: 'ver-test-policy',
          visualBrief: createMockVisualBrief('ws-test-policy', 'ver-test-policy'),
        })
      ).rejects.toThrowError(/PROVIDER_MODEL_MISMATCH/)
    })
  })
})
