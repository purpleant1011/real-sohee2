/**
 * Creative Generation Domain Types (ANI-1075, ANI-1076, ANI-1097, ANI-1099)
 * Production State Machine, Concurrency Rules, and FinOps Accounting
 */

import type { MediaAsset } from '../media/media-asset-types'
import type { VisualBrief } from './visual-brief-types'

export type GenerationRunState =
  | 'QUEUED'
  | 'GENERATING'
  | 'GENERATED_BYTES'
  | 'STORAGE_COMMIT'
  | 'QC_PENDING'
  | 'READY'
  | 'FAILED'
  | 'CANCELED'
  | 'SUPERSEDED'
  | 'STALE_RESULT'

export interface ImageFinOpsUsage {
  provider: 'openai'
  model: string
  providerRequestId: string | null
  providerCallKey: string
  textInputTokens: number
  cachedTextInputTokens: number
  textOutputTokens: number
  imageInputTokens: number
  imageOutputTokens: number
  providerTotalTokens: number
  usageSource: 'actual' | 'estimated_missing_usage'
  policyVersion: string
  computedCredits: number
  costBasisUsdCents: number
}

export type CreativeStylePreset = 'flare' | 'sunburst'

export interface GenerationRequest {
  idempotencyKey: string
  requestFingerprint: string
  sequenceNumber: number
  workspaceId: string
  contentVersionId: string
  visualBrief: VisualBrief
  requestedCount?: number
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  stylePreset?: CreativeStylePreset
  userId?: string
}

export interface GenerationAttempt {
  attemptNumber: number
  startedAt: string
  endedAt: string
  status: 'SUCCESS' | 'FAILED'
  errorCode?: string
  errorMessage?: string
  durationMs: number
  providerRequestId?: string | null
  promptTokens?: number
  imageTokens?: number
}

export interface GenerationRunRecord {
  id: string
  workspaceId: string
  contentVersionId: string
  idempotencyKey: string
  requestFingerprint: string
  sequenceNumber: number
  status: GenerationRunState
  is_current?: boolean
  superseded_at?: string
  promptDigest: string
  mediaAssetId?: string
  storagePath?: string
  sha256Digest?: string
  byteLength?: number
  errorMessage?: string
  errorCode?: string
  policySnapshot?: Record<string, any>
  usage?: ImageFinOpsUsage
  attempts?: GenerationAttempt[]
  createdAt: string
  updatedAt: string
}

export interface GenerationExecutionResult {
  runId: string
  status: GenerationRunState
  mediaAsset?: MediaAsset
  bytes?: Uint8Array
  sha256?: string
  usage?: ImageFinOpsUsage
  isReplay?: boolean
  error?: {
    code: string
    message: string
  }
}

export class CreativeGenerationError extends Error {
  readonly code: string
  readonly status?: GenerationRunState

  constructor(message: string, code = 'GENERATION_FAILED', status: GenerationRunState = 'FAILED') {
    super(message)
    this.name = 'CreativeGenerationError'
    this.code = code
    this.status = status
  }
}
