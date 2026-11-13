import type { ImageFinOpsUsage } from './creative-generation-types'
import { CreativeGenerationError } from './creative-generation-types'
import { IMAGE_GENERATION_POLICY_SSOT } from './image-generation-policy'

export const GPT_IMAGE_PRICING_POLICY_VERSION = IMAGE_GENERATION_POLICY_SSOT.policyVersion
export const CREDITS_PER_IMAGE_GENERATION = IMAGE_GENERATION_POLICY_SSOT.creditsPerImage
export const COST_BASIS_USD_CENTS_PER_IMAGE = IMAGE_GENERATION_POLICY_SSOT.costBasisUsdCents

export interface CreditAdmissionContext {
  workspaceId: string
  availableCredits: number
  requiredCredits?: number
}

export function checkCreditAdmission(ctx: CreditAdmissionContext): void {
  const required = ctx.requiredCredits ?? CREDITS_PER_IMAGE_GENERATION
  if (ctx.availableCredits < required) {
    throw new CreativeGenerationError(
      `Insufficient credits: Required ${required} credits, but available balance is ${ctx.availableCredits}.`,
      'INSUFFICIENT_CREDITS'
    )
  }
}

export function computeImageUsageEvent(params: {
  workspaceId: string
  model: string
  providerRequestId: string | null
  providerCallKey: string
  promptTokens?: number
  imageTokens?: number
  isSuccess: boolean
}): ImageFinOpsUsage {
  const {
    model,
    providerRequestId,
    providerCallKey,
    promptTokens = 120,
    imageTokens = 1024,
    isSuccess,
  } = params

  return {
    provider: 'openai',
    model,
    providerRequestId,
    providerCallKey,
    textInputTokens: promptTokens,
    cachedTextInputTokens: 0,
    textOutputTokens: 0,
    imageInputTokens: 0,
    imageOutputTokens: isSuccess ? imageTokens : 0,
    providerTotalTokens: promptTokens + (isSuccess ? imageTokens : 0),
    usageSource: 'actual',
    policyVersion: GPT_IMAGE_PRICING_POLICY_VERSION,
    computedCredits: isSuccess ? CREDITS_PER_IMAGE_GENERATION : 0,
    costBasisUsdCents: isSuccess ? COST_BASIS_USD_CENTS_PER_IMAGE : 0,
  }
}
