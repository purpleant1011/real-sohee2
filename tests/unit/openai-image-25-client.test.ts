// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { DefaultOpenAIImageClient } from '@/features/creative/openai-image-client'
import {
  validateProviderModelEvidence,
  ImagePolicyError,
  IMAGE_GENERATION_POLICY_SSOT,
  createPolicySnapshot,
  resolveImageGenerationPolicy,
} from '@/features/creative/image-generation-policy'

describe('OpenAI Image 2.5 Real Sunburst Model & Evidence Gate (ANI-1458 Task 11)', () => {
  // Minimal 1x1 valid PNG in base64
  const VALID_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  it('1) stylePreset: flare with explicit model gpt-image-2.5-flare calls OpenAI with exact model and outputs stylePreset flare', async () => {
    const generateSpy = vi.fn().mockResolvedValue({
      data: [{ b64_json: VALID_PNG_BASE64 }],
      _request_id: 'req_flare_123',
    })

    const mockOpenAI = {
      images: { generate: generateSpy } as any,
    }

    const client = new DefaultOpenAIImageClient(mockOpenAI as any, 'gpt-image-2.5-flare')
    const result = await client.generateImage({
      prompt: '따뜻한 카페 카운터',
      stylePreset: 'flare',
    })

    expect(generateSpy).toHaveBeenCalledTimes(1)
    const callParams = generateSpy.mock.calls[0][0]
    expect(callParams.model).toBe('gpt-image-2.5-flare')
    expect(callParams.output_format).toBe('png')
    expect(callParams).not.toHaveProperty('response_format')

    expect(result.model).toBe('gpt-image-2.5-flare')
    expect(result.stylePreset).toBe('flare')
    expect(result.mimeType).toBe('image/png')
    expect(result.providerRequestId).toBe('req_flare_123')
    expect(result.bytes.length).toBeGreaterThan(0)
  })

  it('2) stylePreset: sunburst calls OpenAI with default exact model gpt-image-2.5-sunburst', async () => {
    const generateSpy = vi.fn().mockResolvedValue({
      data: [{ b64_json: VALID_PNG_BASE64 }],
      _request_id: 'req_sunburst_456',
    })

    const mockOpenAI = {
      images: { generate: generateSpy } as any,
    }

    const client = new DefaultOpenAIImageClient(mockOpenAI as any)
    const result = await client.generateImage({
      prompt: '웃고 있는 바리스타',
      stylePreset: 'sunburst',
    })

    expect(generateSpy).toHaveBeenCalledTimes(1)
    const callParams = generateSpy.mock.calls[0][0]
    expect(callParams.model).toBe('gpt-image-2.5-sunburst')
    expect(result.model).toBe('gpt-image-2.5-sunburst')
    expect(result.stylePreset).toBe('sunburst')
  })

  it('3) DefaultOpenAIImageClient default model is gpt-image-2.5-sunburst', async () => {
    const generateSpy = vi.fn().mockResolvedValue({
      data: [{ b64_json: VALID_PNG_BASE64 }],
      _request_id: 'req_default_789',
    })

    const client = new DefaultOpenAIImageClient({ images: { generate: generateSpy } } as any)
    const result = await client.generateImage({
      prompt: '기본 상품 사진',
    })

    const callParams = generateSpy.mock.calls[0][0]
    expect(callParams.model).toBe('gpt-image-2.5-sunburst')
    expect(result.model).toBe('gpt-image-2.5-sunburst')
  })

  it('4) policy SSOT and snapshot model is exact gpt-image-2.5-sunburst', () => {
    expect(IMAGE_GENERATION_POLICY_SSOT.model).toBe('gpt-image-2.5-sunburst')

    const snapshot = createPolicySnapshot()
    expect(snapshot.model).toBe('gpt-image-2.5-sunburst')

    const resolved = resolveImageGenerationPolicy()
    expect(resolved.model).toBe('gpt-image-2.5-sunburst')

    const resolvedFlare = resolveImageGenerationPolicy({ requestedModel: 'gpt-image-2.5-flare' })
    expect(resolvedFlare.model).toBe('gpt-image-2.5-flare')
  })

  it('5) provider evidence validator accepts exact callable models (sunburst/flare) and rejects bare gpt-image-2.5 or legacy models', () => {
    const sunburstEvidence = {
      provider: 'openai' as const,
      model: 'gpt-image-2.5-sunburst',
      providerRequestId: 'req_ok_sunburst',
      latencyMs: 1200,
      promptTokens: 50,
      imageTokens: 1024,
      totalTokens: 1074,
      byteSize: 1024,
      sha256Digest: 'abc',
    }

    const validated = validateProviderModelEvidence(sunburstEvidence)
    expect(validated.isValid).toBe(true)
    expect(validated.model).toBe('gpt-image-2.5-sunburst')

    const flareEvidence = {
      ...sunburstEvidence,
      model: 'gpt-image-2.5-flare',
      providerRequestId: 'req_ok_flare',
    }
    const validatedFlare = validateProviderModelEvidence(flareEvidence)
    expect(validatedFlare.isValid).toBe(true)
    expect(validatedFlare.model).toBe('gpt-image-2.5-flare')

    // Bare uncallable model MUST be rejected
    expect(() =>
      validateProviderModelEvidence({ ...sunburstEvidence, model: 'gpt-image-2.5' })
    ).toThrow(ImagePolicyError)

    // Legacy models MUST be rejected
    expect(() =>
      validateProviderModelEvidence({ ...sunburstEvidence, model: 'gpt-image-2' })
    ).toThrow(ImagePolicyError)

    expect(() =>
      validateProviderModelEvidence({ ...sunburstEvidence, model: 'dall-e-3' })
    ).toThrow(ImagePolicyError)
  })

  it('6) production path preserves exact model without stripping suffix', async () => {
    const generateSpy = vi.fn().mockResolvedValue({
      data: [{ b64_json: VALID_PNG_BASE64 }],
      _request_id: 'req_canonical_999',
    })

    const client = new DefaultOpenAIImageClient({ images: { generate: generateSpy } } as any)
    const result = await client.generateImage({
      prompt: '스타일 지정 사진',
      model: 'gpt-image-2.5-sunburst',
      stylePreset: 'sunburst',
    })

    const callParams = generateSpy.mock.calls[0][0]
    expect(callParams.model).toBe('gpt-image-2.5-sunburst')
    expect(result.model).toBe('gpt-image-2.5-sunburst')
    expect(result.stylePreset).toBe('sunburst')
  })
})
