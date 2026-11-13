/**
 * @deprecated PURGED FOR PRODUCTION (ANI-1119).
 * Use createProductionGenerationOrchestrator from '@/features/creative/production-generation-factory' instead.
 * Retained strictly for backwards-compatible ImageAsset type definitions and historical unit fixtures.
 */

import { getImageApiKey, getModelProfile } from './model-profiles'

export interface ImageAsset {
  assetId: string
  url: string
  prompt: string
  style?: string
  dimensions: string
  modelId: string
  costSC: number
  provenanceId: string
  createdAt: string
  status: 'VERIFIED_READY' | 'GENERATION_FAILED'
}

export interface ImageGenerationInput {
  prompt: string
  style?: string
  workspaceId: string
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:5'
  sourceReferenceId?: string
}

export class ImageWorker {
  public static async generateImage(
    input: ImageGenerationInput
  ): Promise<ImageAsset> {
    const profile = getModelProfile('image')
    const apiKey = getImageApiKey()

    const effectiveStyle = input.style || '자연광 감성 고화질 실사'
    const enrichedPrompt = `${input.prompt}, 스타일: ${effectiveStyle}, ultra-high resolution, photorealistic, professional photography`

    const assetId = `img-asset-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const provenanceId = `prov-${Date.now()}-${input.workspaceId}`

    if (!apiKey) {
      throw new Error('IMAGE_AUTH_REQUIRED: OPENAI_IMAGE_API_KEY is not configured.')
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), profile.timeoutMs)

    try {
      // 1. Primary Engine: OpenAI Image API (GPT-Image-2)
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-2',
          prompt: enrichedPrompt,
          n: 1,
          size: '1024x1024',
          quality: 'standard'
        }),
        signal: controller.signal
      })

      clearTimeout(timeout)

      if (!res.ok) {
        const errText = await res.text()
        console.error(`[ImageWorker] Generation failed with status ${res.status}: ${errText}`)
        throw new Error(`GPT-Image-2 generation failed (${res.status}): ${errText}`)
      }

      const data = await res.json()
      const firstImage = data.data?.[0]

      if (!firstImage?.url) {
        throw new Error('GPT-Image-2 returned empty image url payload')
      }

      return {
        assetId,
        url: firstImage.url,
        prompt: input.prompt,
        style: effectiveStyle,
        dimensions: '1024x1024',
        modelId: profile.modelId, // 'gpt-image-2'
        costSC: profile.creditCostSC, // 150 SC
        provenanceId,
        createdAt: new Date().toISOString(),
        status: 'VERIFIED_READY'
      }
    } catch (err: unknown) {
      clearTimeout(timeout)
      console.error('[ImageWorker] Fatal image generation error:', err)
      throw err // False success 차단: 절대 가짜 URL 반환 금지
    }
  }
}
