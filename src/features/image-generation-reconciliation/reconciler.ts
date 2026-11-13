/**
 * Image Generation Result Reconciler (HF-56 / ANI-1406)
 * Handles provider timeout / RESULT_UNKNOWN isolation, cost-safe retry,
 * idempotency deduplication, lineage preservation, and cross-tenant protection.
 */

import { randomUUID } from 'node:crypto'
import type {
  ImageGenerationJob,
  GenerationProviderClient,
  ReconciliationPolicy,
  StartGenerationParams,
} from './types'

export class ImageReconciliationError extends Error {
  readonly code: string
  constructor(message: string, code = 'IMAGE_RECONCILIATION_ERROR') {
    super(`${code}: ${message}`)
    this.name = 'ImageReconciliationError'
    this.code = code
  }
}

export interface ReconcilerOptions {
  providerClient: GenerationProviderClient
  policy: ReconciliationPolicy
}

export class ImageGenerationReconciler {
  private provider: GenerationProviderClient
  private policy: ReconciliationPolicy
  private jobs = new Map<string, ImageGenerationJob>()
  private idempotencyIndex = new Map<string, string>() // key: `${workspaceId}:${idempotencyKey}` -> jobId

  constructor(options: ReconcilerOptions) {
    this.provider = options.providerClient
    this.policy = { ...options.policy }
  }

  /**
   * 이미지 생성 시작 (멱등성, 비용 한도, 타임아웃 격리)
   */
  async startGeneration(params: StartGenerationParams): Promise<ImageGenerationJob> {
    const { workspaceId, idempotencyKey } = params
    const idxKey = `${workspaceId}:${idempotencyKey}`

    // 멱등성 검증: 동일한 idempotencyKey가 이미 존재하는 경우 기존 작업 반환
    const existingJobId = this.idempotencyIndex.get(idxKey)
    if (existingJobId) {
      const existing = this.jobs.get(existingJobId)
      if (existing) {
        return { ...existing }
      }
    }

    // 비용 안전 검증 (FinOps / Operating Policy 연동)
    if (this.policy.currentDailySpendKrw + this.policy.costPerActionKrw > this.policy.dailySpendLimitKrw) {
      throw new ImageReconciliationError(
        `Current spend (${this.policy.currentDailySpendKrw}) + action cost (${this.policy.costPerActionKrw}) exceeds daily limit (${this.policy.dailySpendLimitKrw})`,
        'COST_LIMIT_EXCEEDED'
      )
    }

    const now = new Date().toISOString()
    const jobId = randomUUID()

    const job: ImageGenerationJob = {
      id: jobId,
      workspaceId,
      status: 'EXECUTING',
      prompt: params.prompt,
      idempotencyKey,
      attempts: 1,
      lineage: {
        testRunId: params.testRunId,
        variantId: params.variantId,
        harnessVersionId: params.harnessVersionId,
        contentVersionId: params.contentVersionId,
        creativeBundleId: params.creativeBundleId,
      },
      createdAt: now,
      updatedAt: now,
    }

    this.jobs.set(jobId, job)
    this.idempotencyIndex.set(idxKey, jobId)

    try {
      const providerRes = await this.provider.requestGeneration({
        workspaceId,
        prompt: params.prompt,
        variantId: params.variantId,
        idempotencyKey,
      })

      job.status = providerRes.status
      job.outputUrl = providerRes.outputUrl
      job.externalJobId = providerRes.externalJobId
      job.errorCode = providerRes.errorCode
      job.errorMessage = providerRes.message
      job.rawProviderPayload = providerRes.rawProviderPayload
      job.updatedAt = new Date().toISOString()

      if (job.status === 'SUCCEEDED' || job.status === 'VERIFIED') {
        this.policy.currentDailySpendKrw += this.policy.costPerActionKrw
      }
    } catch (err: unknown) {
      // 타임아웃, 네트워크 실패 등 불확실성은 즉시 FAILED로 처리하지 않고 RESULT_UNKNOWN으로 격리
      job.status = 'RESULT_UNKNOWN'
      job.errorMessage = (err as Error)?.message || 'Provider request failed or timed out'
      job.updatedAt = new Date().toISOString()
    }

    return { ...job }
  }

  /**
   * 결과 조정 및 사후 상태 조회 (Reconciliation)
   */
  async reconcileJob(workspaceId: string, jobId: string): Promise<ImageGenerationJob> {
    const job = this.jobs.get(jobId)
    if (!job) {
      throw new ImageReconciliationError(`Job ${jobId} not found`, 'JOB_NOT_FOUND')
    }

    // 테넌트 격리 검증
    if (job.workspaceId !== workspaceId) {
      throw new ImageReconciliationError(
        `Job ${jobId} does not belong to workspace ${workspaceId}`,
        'CROSS_TENANT_ACCESS_DENIED'
      )
    }

    const providerRes = await this.provider.queryJobStatus(job.externalJobId || jobId)

    // 크로스 테넌트 에셋 어태치 방어
    if (providerRes.assetWorkspaceId && providerRes.assetWorkspaceId !== workspaceId) {
      throw new ImageReconciliationError(
        `Provider asset belongs to workspace ${providerRes.assetWorkspaceId}, cannot attach to ${workspaceId}`,
        'CROSS_TENANT_ASSET_ATTACH_DENIED'
      )
    }

    if (providerRes.status === 'SUCCEEDED' || providerRes.status === 'VERIFIED') {
      job.status = providerRes.status
      job.outputUrl = providerRes.outputUrl
      job.externalJobId = providerRes.externalJobId || job.externalJobId
      job.errorCode = undefined
      job.errorMessage = undefined
      this.policy.currentDailySpendKrw += this.policy.costPerActionKrw
    } else if (providerRes.status === 'FAILED') {
      job.status = 'FAILED'
      job.errorCode = providerRes.errorCode || 'PROVIDER_DEFINITIVE_FAILURE'
      job.errorMessage = providerRes.message
    } else {
      job.status = 'RESULT_UNKNOWN'
      job.errorMessage = providerRes.message || 'Still awaiting definitive provider result'
    }

    job.updatedAt = new Date().toISOString()
    return { ...job }
  }

  /**
   * Job 조회 (테넌트 격리)
   */
  getJob(workspaceId: string, jobId: string): ImageGenerationJob {
    const job = this.jobs.get(jobId)
    if (!job) {
      throw new ImageReconciliationError(`Job ${jobId} not found`, 'JOB_NOT_FOUND')
    }
    if (job.workspaceId !== workspaceId) {
      throw new ImageReconciliationError(
        `Job ${jobId} does not belong to workspace ${workspaceId}`,
        'CROSS_TENANT_ACCESS_DENIED'
      )
    }
    return { ...job }
  }

  /**
   * 감사 로그 조회 (민감 토큰/시크릿 마스킹)
   */
  getSanitizedAuditLog(workspaceId: string, jobId: string): Record<string, unknown> {
    const job = this.getJob(workspaceId, jobId)

    const sanitizeObject = (obj: unknown): unknown => {
      if (!obj || typeof obj !== 'object') return obj
      if (Array.isArray(obj)) return obj.map(sanitizeObject)

      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase()
        if (
          lowerKey.includes('secret') ||
          lowerKey.includes('token') ||
          lowerKey.includes('key') ||
          lowerKey.includes('auth') ||
          lowerKey.includes('bearer')
        ) {
          result[key] = '[REDACTED]'
        } else if (typeof value === 'string' && (value.startsWith('sk-') || value.startsWith('Bearer '))) {
          result[key] = '[REDACTED]'
        } else if (typeof value === 'object' && value !== null) {
          result[key] = sanitizeObject(value)
        } else {
          result[key] = value
        }
      }
      return result
    }

    return sanitizeObject(job) as Record<string, unknown>
  }
}
