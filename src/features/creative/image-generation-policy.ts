/**
 * ANI-1120: ImageGenerationPolicy Single SSOT & Provider Evidence Contract
 *
 * Enforces:
 * 1. Server-owned single SSOT ImageGenerationPolicy (gpt-image-2, v11.0).
 * 2. Immutable policy snapshot generation for durable generation run tracking.
 * 3. Strict provider response evidence validation (model === 'gpt-image-2', real providerRequestId).
 * 4. Distinct accounting between provider raw attempts and customer logical credit settlements.
 */

export class ImagePolicyError extends Error {
  readonly code: string
  constructor(message: string, code = 'IMAGE_POLICY_ERROR') {
    super(message)
    this.name = 'ImagePolicyError'
    this.code = code
  }
}

export type SupportedImageSize = '1024x1024' | '1024x1536' | '1536x1024'
export type SupportedImageQuality = 'standard' | 'hd'
export type SupportedImageFormat = 'png' | 'webp' | 'jpeg'

export type CanonicalImageModel = 'gpt-image-2.5-sunburst' | 'gpt-image-2.5-flare'

export interface ImageGenerationPolicy {
  policyVersion: string
  model: CanonicalImageModel
  supportedSizes: SupportedImageSize[]
  defaultSize: SupportedImageSize
  defaultQuality: SupportedImageQuality
  outputFormat: SupportedImageFormat
  creditsPerImage: number
  costBasisUsdCents: number
  timeoutMs: number
  maxRetries: number
}

export const IMAGE_GENERATION_POLICY_SSOT: ImageGenerationPolicy = {
  policyVersion: 'v12.1-gpt-image-2.5-sunburst',
  model: 'gpt-image-2.5-sunburst',
  supportedSizes: ['1024x1024', '1024x1536', '1536x1024'],
  defaultSize: '1024x1024',
  defaultQuality: 'standard',
  outputFormat: 'png',
  creditsPerImage: 150,
  costBasisUsdCents: 4,
  timeoutMs: 45000,
  maxRetries: 2,
}

export interface ResolvePolicyOptions {
  requestedModel?: string
}

export function resolveImageGenerationPolicy(options?: ResolvePolicyOptions): ImageGenerationPolicy {
  const allowed: string[] = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']
  if (options?.requestedModel) {
    if (!allowed.includes(options.requestedModel)) {
      throw new ImagePolicyError(
        `LEGACY_MODEL_FORBIDDEN: Requested model "${options.requestedModel}" is strictly forbidden. Only exact callable GPT Image 2.5 variants (${allowed.join(', ')}) are canonical.`,
        'LEGACY_MODEL_FORBIDDEN'
      )
    }
    return { ...IMAGE_GENERATION_POLICY_SSOT, model: options.requestedModel as CanonicalImageModel }
  }
  return { ...IMAGE_GENERATION_POLICY_SSOT }
}

export interface PolicySnapshot {
  policyVersion: string
  model: string
  size: SupportedImageSize
  quality: SupportedImageQuality
  outputFormat: SupportedImageFormat
  creditsPerUnit: number
  costBasisUsdCents: number
  createdAt: string
}

export interface CreatePolicySnapshotOptions {
  size?: SupportedImageSize
  quality?: SupportedImageQuality
  outputFormat?: SupportedImageFormat
}

export function createPolicySnapshot(options?: CreatePolicySnapshotOptions): PolicySnapshot {
  const policy = IMAGE_GENERATION_POLICY_SSOT
  if (options?.size && !policy.supportedSizes.includes(options.size)) {
    throw new ImagePolicyError(
      `UNSUPPORTED_SIZE: Size "${options.size}" is not supported. Supported sizes are: ${policy.supportedSizes.join(', ')}`,
      'UNSUPPORTED_SIZE'
    )
  }
  return {
    policyVersion: policy.policyVersion,
    model: policy.model,
    size: options?.size || policy.defaultSize,
    quality: options?.quality || policy.defaultQuality,
    outputFormat: options?.outputFormat || policy.outputFormat,
    creditsPerUnit: policy.creditsPerImage,
    costBasisUsdCents: policy.costBasisUsdCents,
    createdAt: new Date().toISOString(),
  }
}

export interface ProviderCallEvidence {
  provider: 'openai'
  model: string
  providerRequestId: string
  latencyMs: number
  promptTokens: number
  imageTokens: number
  totalTokens: number
  byteSize: number
  sha256Digest: string
}

export interface ValidatedProviderEvidence {
  isValid: true
  model: CanonicalImageModel
  providerRequestId: string
  latencyMs: number
}

export function validateProviderModelEvidence(
  evidence: ProviderCallEvidence
): ValidatedProviderEvidence {
  if (!evidence.providerRequestId || evidence.providerRequestId.trim().length === 0) {
    throw new ImagePolicyError(
      'PROVIDER_REQUEST_ID_REQUIRED: Missing or empty providerRequestId in provider call evidence.',
      'PROVIDER_REQUEST_ID_REQUIRED'
    )
  }

  const allowedModels: string[] = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']
  if (!allowedModels.includes(evidence.model)) {
    throw new ImagePolicyError(
      `PROVIDER_MODEL_MISMATCH: Expected provider model in [${allowedModels.join(', ')}], but received "${evidence.model}". Fake or legacy model evidence rejected.`,
      'PROVIDER_MODEL_MISMATCH'
    )
  }

  return {
    isValid: true,
    model: evidence.model as CanonicalImageModel,
    providerRequestId: evidence.providerRequestId,
    latencyMs: evidence.latencyMs,
  }
}

export interface GenerationAttemptUsage {
  attemptNumber: number
  providerRequestId: string | null
  model: string
  latencyMs: number
  isSuccess: boolean
  promptTokens: number
  imageTokens: number
  errorCode?: string
}

export interface SettlementResult {
  workspaceId: string
  isTestAccount: boolean
  totalAttempts: number
  successfulAttemptNumber: number | null
  totalProviderTokensConsumed: number
  logicalCreditDeduction: number
  costBasisUsdCents: number
}

export function computeSettlementFromAttempts(params: {
  workspaceId: string
  isTestAccount: boolean
  attempts: GenerationAttemptUsage[]
}): SettlementResult {
  const { workspaceId, isTestAccount, attempts } = params

  const totalProviderTokensConsumed = attempts.reduce(
    (sum, a) => sum + (a.promptTokens || 0) + (a.imageTokens || 0),
    0
  )

  const successfulAttempt = attempts.find((a) => a.isSuccess)
  const isSuccess = !!successfulAttempt

  return {
    workspaceId,
    isTestAccount,
    totalAttempts: attempts.length,
    successfulAttemptNumber: successfulAttempt ? successfulAttempt.attemptNumber : null,
    totalProviderTokensConsumed,
    logicalCreditDeduction: isTestAccount
      ? 0
      : isSuccess
      ? IMAGE_GENERATION_POLICY_SSOT.creditsPerImage
      : 0,
    costBasisUsdCents: isTestAccount
      ? 0
      : isSuccess
      ? IMAGE_GENERATION_POLICY_SSOT.costBasisUsdCents
      : 0,
  }
}
