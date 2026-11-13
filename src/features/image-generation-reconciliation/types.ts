/**
 * Image Generation Result Reconciliation Types (HF-56 / ANI-1406)
 */

export type GenerationStatus =
  | 'REQUESTED'
  | 'EXECUTING'
  | 'PROVIDER_ACCEPTED'
  | 'VERIFYING'
  | 'SUCCEEDED'
  | 'VERIFIED'
  | 'RESULT_UNKNOWN'
  | 'FAILED'

export interface ImageGenerationLineage {
  testRunId?: string
  variantId?: string
  harnessVersionId?: string
  contentVersionId?: string
  creativeBundleId?: string
}

export interface ImageGenerationJob {
  id: string
  workspaceId: string
  status: GenerationStatus
  prompt?: string
  idempotencyKey: string
  outputUrl?: string
  externalJobId?: string
  errorCode?: string
  errorMessage?: string
  attempts: number
  lineage: ImageGenerationLineage
  rawProviderPayload?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ProviderQueryResult {
  status: GenerationStatus
  outputUrl?: string
  externalJobId?: string
  errorCode?: string
  message?: string
  assetWorkspaceId?: string
  rawProviderPayload?: Record<string, unknown>
}

export interface GenerationProviderClient {
  requestGeneration(params: unknown): Promise<ProviderQueryResult>
  queryJobStatus(jobId: string): Promise<ProviderQueryResult>
}

export interface ReconciliationPolicy {
  maxRetries: number
  costPerActionKrw: number
  dailySpendLimitKrw: number
  currentDailySpendKrw: number
}

export interface StartGenerationParams {
  workspaceId: string
  variantId?: string
  testRunId?: string
  harnessVersionId?: string
  contentVersionId?: string
  creativeBundleId?: string
  prompt?: string
  idempotencyKey: string
}
