import { describe, it, expect } from 'vitest'
import { MODEL_PROFILES, getModelProfile } from '@/lib/ai/model-profiles'
import { resolveImageGenerationPolicy } from '@/features/creative/image-generation-policy'
import manifest from '@/../canonical-governance-manifest.json'

describe('Canonical Model Routing SSOT & Boundary Enforcement (ANI-1458)', () => {
  it('enforces Gemini 3.5 Flash Lite for conversation and copywriting', () => {
    const convProfile = getModelProfile('conversation')
    expect(convProfile.modelId).toBe('gemini-3.5-flash-lite')
    expect(convProfile.provider).toBe('gemini')
    expect(manifest.modelRouting.conversation).toBe('gemini-3.5-flash-lite')
  })

  it('enforces Gemini 3.8 Flash for agent action and tool execution', () => {
    const actionProfile = getModelProfile('action')
    expect(actionProfile.modelId).toBe('gemini-3.8-flash')
    expect(actionProfile.provider).toBe('gemini')
    expect(manifest.modelRouting.action).toBe('gemini-3.8-flash')
  })

  it('enforces GPT Image 2.5 family with flare default and sunburst precision preset', () => {
    const imageProfile = getModelProfile('image')
    expect(imageProfile.modelId).toBe('gpt-image-2.5-sunburst')
    expect(imageProfile.provider).toBe('openai')

    const defaultPolicy = resolveImageGenerationPolicy()
    expect(defaultPolicy.model).toBe('gpt-image-2.5-sunburst')

    // Manifest presets map to canonical exact models
    expect(manifest.modelRouting.image).toBe('gpt-image-2.5-sunburst')
    expect(manifest.modelRouting.imagePresets.flare).toBe('gpt-image-2.5-flare')
    expect(manifest.modelRouting.imagePresets.sunburst).toBe('gpt-image-2.5-sunburst')

    // Rejects bare non-callable family or legacy models
    expect(() => resolveImageGenerationPolicy({ requestedModel: 'gpt-image-2.5' as any })).toThrow(/LEGACY_MODEL_FORBIDDEN/)
    expect(() => resolveImageGenerationPolicy({ requestedModel: 'gpt-image-2' as any })).toThrow(/LEGACY_MODEL_FORBIDDEN/)
    expect(() => resolveImageGenerationPolicy({ requestedModel: 'dall-e-3' as any })).toThrow(/LEGACY_MODEL_FORBIDDEN/)
  })
})
