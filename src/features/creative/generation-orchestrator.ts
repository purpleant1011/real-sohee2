import { randomUUID } from 'node:crypto'
import type { MediaAsset, ContentVersionMediaBinding } from '../media/media-asset-types'
import {
  resolveMediaSourcePath,
  computeSha256,
  CONTENT_MEDIA_BUCKET,
} from '../media/media-storage'
import type {
  GenerationRequest,
  GenerationExecutionResult,
  GenerationRunRecord,
  GenerationRunState,
  GenerationAttempt,
} from './creative-generation-types'
import { CreativeGenerationError } from './creative-generation-types'
import type { OpenAIImageClient } from './openai-image-client'
import { DefaultOpenAIImageClient } from './openai-image-client'
import {
  checkCreditAdmission,
  computeImageUsageEvent,
  CREDITS_PER_IMAGE_GENERATION,
} from './finops-image-accounting'
import {
  resolveImageGenerationPolicy,
  createPolicySnapshot,
  validateProviderModelEvidence,
  ImagePolicyError,
} from './image-generation-policy'
import {
  validateImageBinary,
  ImageBinaryValidationError,
} from './image-binary-validator'

export interface StorageAdapter {
  upload(params: {
    bucket: string
    path: string
    bytes: Uint8Array
    mimeType: string
  }): Promise<{ error: Error | null }>
  delete?(params: {
    bucket: string
    path: string
  }): Promise<{ error: Error | null }>
}

export interface PersistenceAdapter {
  saveMediaAsset(asset: MediaAsset): Promise<{ error: Error | null }>
  saveContentVersionBinding(binding: ContentVersionMediaBinding): Promise<{ error: Error | null }>
  getExistingRunByIdempotency(key: string): Promise<GenerationRunRecord | null>
  saveRunRecord(record: GenerationRunRecord): Promise<{ error: Error | null }>
  updateRunRecord(id: string, updates: Partial<GenerationRunRecord>): Promise<{ error: Error | null }>
  quarantineMediaAsset?(assetId: string, reason: string): Promise<{ error: Error | null }>
  getMediaAsset?(assetId: string): Promise<MediaAsset | null>
  recordFinOpsUsage?(usage: any): Promise<{ error: Error | null }>
}

export class InMemoryPersistenceAdapter implements PersistenceAdapter {
  private runs = new Map<string, GenerationRunRecord>()
  private assets = new Map<string, MediaAsset>()
  private bindings: ContentVersionMediaBinding[] = []

  async saveMediaAsset(asset: MediaAsset) {
    this.assets.set(asset.id, asset)
    return { error: null }
  }

  async saveContentVersionBinding(binding: ContentVersionMediaBinding) {
    this.bindings.push(binding)
    return { error: null }
  }

  async getExistingRunByIdempotency(key: string) {
    for (const r of this.runs.values()) {
      if (r.idempotencyKey === key) return r
    }
    return null
  }

  async saveRunRecord(record: GenerationRunRecord) {
    this.runs.set(record.id, record)
    return { error: null }
  }

  async updateRunRecord(id: string, updates: Partial<GenerationRunRecord>) {
    const existing = this.runs.get(id)
    if (existing) {
      this.runs.set(id, { ...existing, ...updates, updatedAt: new Date().toISOString() })
    }
    return { error: null }
  }

  async quarantineMediaAsset(assetId: string, reason: string) {
    const existing = this.assets.get(assetId)
    if (existing) {
      this.assets.set(assetId, {
        ...existing,
        lifecycle_status: 'QUARANTINED',
        publish_eligibility: false,
        generation_metadata: {
          ...existing.generation_metadata,
          quarantineReason: reason,
          quarantinedAt: new Date().toISOString(),
        },
      })
    }
    return { error: null }
  }

  getAsset(id: string) {
    return this.assets.get(id)
  }

  async getMediaAsset(assetId: string): Promise<MediaAsset | null> {
    return this.assets.get(assetId) || null
  }

  readonly recordedUsages: any[] = []

  async recordFinOpsUsage(usage: any) {
    this.recordedUsages.push(usage)
    return { error: null }
  }

  getAllBindings() {
    return [...this.bindings]
  }
}

export class InMemoryStorageAdapter implements StorageAdapter {
  readonly uploaded = new Map<string, Uint8Array>()

  async upload(params: { bucket: string; path: string; bytes: Uint8Array; mimeType: string }) {
    this.uploaded.set(`${params.bucket}/${params.path}`, params.bytes)
    return { error: null }
  }

  async delete(params: { bucket: string; path: string }) {
    this.uploaded.delete(`${params.bucket}/${params.path}`)
    return { error: null }
  }
}

export interface RetryPolicy {
  maxRetries?: number
  initialDelayMs?: number
  backoffFactor?: number
  maxBudgetMs?: number
}

export interface OrchestratorOptions {
  imageClient?: OpenAIImageClient
  storageAdapter?: StorageAdapter
  persistenceAdapter?: PersistenceAdapter
  availableCredits?: number
  retryPolicy?: RetryPolicy
}

export class GenerationOrchestrator {
  private imageClient: OpenAIImageClient
  private storage: StorageAdapter
  private persistence: PersistenceAdapter
  private availableCredits: number
  private retryPolicy: RetryPolicy

  // Sequence tracking per contentVersionId for concurrency & stale-result protection
  private activeSequences = new Map<string, number>()
  private canceledRuns = new Set<string>()

  constructor(options: OrchestratorOptions = {}) {
    const isProd = process.env.NODE_ENV === 'production'
    if (isProd && (!options.storageAdapter || !options.persistenceAdapter)) {
      throw new Error(
        'PRODUCTION_COMPOSITION_ROOT_ERROR: Direct GenerationOrchestrator instantiation without concrete storage and persistence adapters is forbidden in production. Use createProductionGenerationOrchestrator.'
      )
    }

    if (
      isProd &&
      (options.storageAdapter instanceof InMemoryStorageAdapter ||
        options.persistenceAdapter instanceof InMemoryPersistenceAdapter)
    ) {
      throw new Error(
        'IN_MEMORY_ADAPTER_FORBIDDEN: InMemoryStorageAdapter or InMemoryPersistenceAdapter is strictly forbidden in production mode.'
      )
    }

    this.imageClient = options.imageClient || new DefaultOpenAIImageClient()
    this.storage = options.storageAdapter || new InMemoryStorageAdapter()
    this.persistence = options.persistenceAdapter || new InMemoryPersistenceAdapter()
    this.availableCredits = options.availableCredits ?? 1000
    this.retryPolicy = {
      maxRetries: options.retryPolicy?.maxRetries ?? 2,
      initialDelayMs: options.retryPolicy?.initialDelayMs ?? 1000,
      backoffFactor: options.retryPolicy?.backoffFactor ?? 2,
      maxBudgetMs: options.retryPolicy?.maxBudgetMs ?? 30000,
    }
  }

  /**
   * Explicitly cancel an in-flight generation run (ANI-1123)
   */
  async cancelRun(runId: string, reason = 'User canceled generation'): Promise<{ error: Error | null }> {
    this.canceledRuns.add(runId)
    await this.persistence.updateRunRecord(runId, {
      status: 'CANCELED',
      errorMessage: reason,
    })
    return { error: null }
  }

  /**
   * Main entry point for creative image generation
   * Enforces:
   *  1. Idempotency Key check (0 side-effects on replay)
   *  2. Credit admission check
   *  3. Sequence tracking & Stale result / superseded race protection
   *  4. Byte extraction & SHA-256 verification
   *  5. Private Storage upload
   *  6. Canonical MediaAsset & ContentVersionMedia binding creation
   *  7. FinOps settlement
   */
  async execute(request: GenerationRequest): Promise<GenerationExecutionResult> {
    const {
      idempotencyKey,
      requestFingerprint,
      sequenceNumber,
      workspaceId,
      contentVersionId,
      visualBrief,
      size = '1024x1024',
    } = request

    // 1. Check Idempotency
    const existingRun = await this.persistence.getExistingRunByIdempotency(idempotencyKey)
    if (existingRun) {
      if (existingRun.status === 'READY' && existingRun.mediaAssetId) {
        const mediaAsset = this.persistence.getMediaAsset
          ? await this.persistence.getMediaAsset(existingRun.mediaAssetId)
          : (this.persistence as any).getAsset?.(existingRun.mediaAssetId) || undefined

        return {
          runId: existingRun.id,
          status: 'READY',
          mediaAsset: mediaAsset || undefined,
          sha256: existingRun.sha256Digest,
          usage: existingRun.usage,
          isReplay: true,
        }
      }
      if (existingRun.status === 'FAILED') {
        return {
          runId: existingRun.id,
          status: 'FAILED',
          isReplay: true,
          error: {
            code: existingRun.errorCode || 'PREVIOUS_RUN_FAILED',
            message: existingRun.errorMessage || 'Previous run with same idempotency key failed.',
          },
        }
      }
    }

    // 2. Policy Resolution & Credit Admission
    const policy = resolveImageGenerationPolicy()
    const policySnapshot = createPolicySnapshot({
      size,
      quality: 'standard',
      outputFormat: 'png',
    })

    checkCreditAdmission({
      workspaceId,
      availableCredits: this.availableCredits,
      requiredCredits: policy.creditsPerImage,
    })

    // 3. Concurrency Registration & Policy Snapshot
    const currentActiveSeq = this.activeSequences.get(contentVersionId) || 0
    if (sequenceNumber > currentActiveSeq) {
      this.activeSequences.set(contentVersionId, sequenceNumber)
    }

    const runId = randomUUID()
    const now = new Date().toISOString()
    const initialRun: GenerationRunRecord = {
      id: runId,
      workspaceId,
      contentVersionId,
      idempotencyKey,
      requestFingerprint,
      sequenceNumber,
      status: 'QUEUED',
      is_current: true,
      promptDigest: visualBrief.promptDigest,
      policySnapshot,
      attempts: [],
      createdAt: now,
      updatedAt: now,
    }
    await this.persistence.saveRunRecord(initialRun)

    // 4. Invoke Provider with Bounded Exponential Retry (ANI-1123)
    await this.persistence.updateRunRecord(runId, { status: 'GENERATING' })
    const startTime = Date.now()
    const maxRetries = this.retryPolicy.maxRetries ?? 2
    const initialDelay = this.retryPolicy.initialDelayMs ?? 1000
    const backoffFactor = this.retryPolicy.backoffFactor ?? 2
    const attempts: GenerationAttempt[] = []

    let callOutput: any = null
    let lastError: any = null
    let attemptIndex = 0

    while (attemptIndex <= maxRetries) {
      if (this.canceledRuns.has(runId)) {
        await this.persistence.updateRunRecord(runId, { status: 'CANCELED', attempts })
        return { runId, status: 'CANCELED' }
      }

      const attemptStart = Date.now()
      const attemptNumber = attemptIndex + 1

      try {
        callOutput = await this.imageClient.generateImage({
          prompt: visualBrief.promptText,
          size,
          outputFormat: 'png',
          stylePreset: request.stylePreset,
        })

        const attemptEnd = Date.now()
        attempts.push({
          attemptNumber,
          startedAt: new Date(attemptStart).toISOString(),
          endedAt: new Date(attemptEnd).toISOString(),
          status: 'SUCCESS',
          durationMs: Math.max(1, attemptEnd - attemptStart),
          providerRequestId: callOutput.providerRequestId,
          promptTokens: callOutput.promptTokensEstimate,
          imageTokens: callOutput.imageTokensEstimate,
        })
        break
      } catch (err: any) {
        const attemptEnd = Date.now()
        lastError = err
        const status = err?.status || err?.statusCode
        const code = err?.code || 'IMAGE_GENERATION_FAILED'

        attempts.push({
          attemptNumber,
          startedAt: new Date(attemptStart).toISOString(),
          endedAt: new Date(attemptEnd).toISOString(),
          status: 'FAILED',
          errorCode: code,
          errorMessage: err?.message,
          durationMs: Math.max(1, attemptEnd - attemptStart),
        })

        // Non-retryable: 400 (bad request, policy violation) or auth
        const isRetryable = status === 429 || (status >= 500 && status < 600)
        const maxBudgetMs = this.retryPolicy.maxBudgetMs ?? 30000
        const isBudgetExhausted = Date.now() - startTime >= maxBudgetMs

        if (isRetryable && attemptIndex < maxRetries && !isBudgetExhausted) {
          attemptIndex++
          const baseDelay = initialDelay * Math.pow(backoffFactor, attemptIndex - 1)
          const jitter = Math.floor(Math.random() * (baseDelay * 0.2))
          const delay = baseDelay + jitter
          await new Promise((res) => setTimeout(res, delay))
          continue
        }

        break
      }
    }

    if (!callOutput) {
      const finalStatus = lastError?.status || lastError?.statusCode
      let errorCode = lastError?.code || 'IMAGE_GENERATION_FAILED'
      let errorMessage = lastError?.message || 'Provider generation failed'

      if (finalStatus === 429) {
        errorCode = 'IMAGE_RATE_LIMITED'
      } else if (finalStatus >= 500 && finalStatus < 600) {
        errorCode = 'IMAGE_PROVIDER_UNAVAILABLE'
      } else if (finalStatus === 400 || errorCode === 'content_policy_violation') {
        errorCode = 'IMAGE_POLICY_REJECTED'
      }

      await this.persistence.updateRunRecord(runId, {
        status: 'FAILED',
        errorCode,
        errorMessage,
        attempts,
      })

      throw new CreativeGenerationError(`[${errorCode}] ${errorMessage}`, errorCode, 'FAILED')
    }

    // Cancellation check after provider call
    if (this.canceledRuns.has(runId)) {
      await this.persistence.updateRunRecord(runId, { status: 'CANCELED', attempts })
      return { runId, status: 'CANCELED' }
    }

    const latencyMs = Math.max(1, Date.now() - startTime)

    const { bytes, mimeType, sha256Digest, providerRequestId, model, promptTokensEstimate, imageTokensEstimate } = callOutput

    // 4.1 Strict Provider Evidence Validation (ANI-1120 SSOT)
    try {
      validateProviderModelEvidence({
        provider: 'openai',
        model,
        providerRequestId: providerRequestId || '',
        latencyMs,
        promptTokens: promptTokensEstimate,
        imageTokens: imageTokensEstimate,
        totalTokens: promptTokensEstimate + imageTokensEstimate,
        byteSize: bytes.byteLength,
        sha256Digest,
      })
    } catch (policyErr: any) {
      const errorCode = policyErr?.code || 'INVALID_PROVIDER_EVIDENCE'
      const errorMessage = policyErr?.message || 'Provider evidence validation failed'
      await this.persistence.updateRunRecord(runId, {
        status: 'FAILED',
        errorCode,
        errorMessage,
      })
      throw new CreativeGenerationError(errorMessage, errorCode, 'FAILED')
    }

    // 4.2 Binary Header & Dimension Validation (ANI-1121)
    let validatedImage
    try {
      validatedImage = validateImageBinary(bytes)
    } catch (binErr: any) {
      const errorCode = binErr?.code || 'INVALID_IMAGE_BINARY'
      const errorMessage = binErr?.message || 'Generated binary verification failed'
      await this.persistence.updateRunRecord(runId, {
        status: 'FAILED',
        errorCode,
        errorMessage,
      })
      throw new CreativeGenerationError(errorMessage, errorCode, 'FAILED')
    }

    // 5. Verify Concurrency / Stale Result Race (ANI-1123)
    const latestActiveSeq = this.activeSequences.get(contentVersionId) || 0
    if (sequenceNumber < latestActiveSeq) {
      // Another newer generation has already been scheduled or completed for this content version!
      // This run must be isolated as STALE_RESULT and MUST NOT be promoted to primary asset!
      await this.persistence.updateRunRecord(runId, {
        status: 'STALE_RESULT',
        is_current: false,
        superseded_at: new Date().toISOString(),
        sha256Digest,
        byteLength: bytes.byteLength,
        attempts,
      })

      return {
        runId,
        status: 'STALE_RESULT',
        sha256: sha256Digest,
        error: {
          code: 'GENERATION_SUPERSEDED',
          message: `Generation sequence ${sequenceNumber} is superseded by newer sequence ${latestActiveSeq}.`,
        },
      }
    }

    // 6. Pre-allocate Canonical MediaAsset ID & Storage Path
    const assetId = randomUUID()
    const storagePath = resolveMediaSourcePath(workspaceId, assetId, validatedImage.format)

    // 7. Storage Commit (State: STORAGE_COMMIT)
    await this.persistence.updateRunRecord(runId, { status: 'STORAGE_COMMIT' })
    const uploadResult = await this.storage.upload({
      bucket: CONTENT_MEDIA_BUCKET,
      path: storagePath,
      bytes,
      mimeType: validatedImage.mimeType,
    })

    if (uploadResult.error) {
      await this.persistence.updateRunRecord(runId, {
        status: 'FAILED',
        errorCode: 'STORAGE_UPLOAD_FAILED',
        errorMessage: uploadResult.error.message,
      })
      throw new CreativeGenerationError(
        `Failed to commit image bytes to private storage: ${uploadResult.error.message}`,
        'STORAGE_UPLOAD_FAILED'
      )
    }

    // 8. Create Canonical MediaAsset
    const isValidUuid = (val?: string | null): boolean =>
      Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val))
    const effectiveCreatedBy = isValidUuid(request.userId)
      ? (request.userId as string)
      : '00000000-0000-0000-0000-000000000000'

    const mediaAsset: MediaAsset = {
      id: assetId,
      workspace_id: workspaceId,
      bucket_id: CONTENT_MEDIA_BUCKET,
      object_path: storagePath,
      kind: 'content',
      source_type: 'GENERATED_OPENAI',
      mime_type: validatedImage.mimeType,
      size_bytes: validatedImage.byteLength,
      width: validatedImage.width,
      height: validatedImage.height,
      sha256_digest: sha256Digest,
      rights_status: 'confirmed',
      lifecycle_status: 'READY',
      publish_eligibility: true,
      generation_metadata: {
        model,
        provider: 'openai',
        promptDigest: visualBrief.promptDigest,
        briefVersion: visualBrief.briefVersion,
        providerRequestId,
        policyVersion: policySnapshot.policyVersion,
        policySnapshot,
        width: validatedImage.width,
        height: validatedImage.height,
        format: validatedImage.format,
        verifiedAt: new Date().toISOString(),
      },
      created_by: effectiveCreatedBy,
      created_at: new Date().toISOString(),
    }
    const saveAssetResult = await this.persistence.saveMediaAsset(mediaAsset)
    if (saveAssetResult.error) {
      // Saga Compensation: clean up uploaded storage object to prevent orphan leak
      try {
        const delRes = await this.storage.delete?.({ bucket: CONTENT_MEDIA_BUCKET, path: storagePath })
        if (delRes?.error) {
          console.error(`[GenerationOrchestrator] Compensation storage delete failed: ${delRes.error.message}`)
        }
      } catch (compErr) {
        console.error('[GenerationOrchestrator] Compensation storage delete exception:', compErr)
      }

      await this.persistence.updateRunRecord(runId, {
        status: 'FAILED',
        errorCode: 'PERSISTENCE_SAVE_MEDIA_ASSET_FAILED',
        errorMessage: saveAssetResult.error.message,
      })
      throw new CreativeGenerationError(
        `Failed to persist canonical media asset: ${saveAssetResult.error.message}`,
        'PERSISTENCE_FAILED'
      )
    }

    // 9. Bind to ContentVersion (role: 'primary', position: 0)
    const binding: ContentVersionMediaBinding = {
      workspace_id: workspaceId,
      version_id: contentVersionId,
      media_asset_id: assetId,
      position: 0,
      role: 'primary',
      created_at: new Date().toISOString(),
    }
    const bindResult = await this.persistence.saveContentVersionBinding(binding)
    if (bindResult.error) {
      // Saga Compensation: clean up storage object and quarantine unbonded media asset
      try {
        const delRes = await this.storage.delete?.({ bucket: CONTENT_MEDIA_BUCKET, path: storagePath })
        if (delRes?.error) {
          console.error(`[GenerationOrchestrator] Compensation storage delete failed: ${delRes.error.message}`)
        }
      } catch (compErr) {
        console.error('[GenerationOrchestrator] Compensation storage delete exception:', compErr)
      }

      try {
        const quarRes = await this.persistence.quarantineMediaAsset?.(assetId, 'CONTENT_VERSION_BINDING_FAILED')
        if (quarRes?.error) {
          console.error(`[GenerationOrchestrator] Compensation quarantine asset failed: ${quarRes.error.message}`)
        }
      } catch (compErr) {
        console.error('[GenerationOrchestrator] Compensation quarantine asset exception:', compErr)
      }

      await this.persistence.updateRunRecord(runId, {
        status: 'FAILED',
        errorCode: 'PERSISTENCE_BIND_MEDIA_FAILED',
        errorMessage: bindResult.error.message,
      })
      throw new CreativeGenerationError(
        `Failed to bind media asset to content version: ${bindResult.error.message}`,
        'PERSISTENCE_FAILED'
      )
    }

    // 10. FinOps Settlement
    const usage = computeImageUsageEvent({
      workspaceId,
      model,
      providerRequestId,
      providerCallKey: idempotencyKey,
      promptTokens: promptTokensEstimate,
      imageTokens: imageTokensEstimate,
      isSuccess: true,
    })
    this.availableCredits = Math.max(0, this.availableCredits - usage.computedCredits)

    await this.persistence.recordFinOpsUsage?.(usage)

    await this.persistence.updateRunRecord(runId, {
      status: 'READY',
      is_current: true,
      mediaAssetId: assetId,
      storagePath,
      sha256Digest,
      byteLength: bytes.byteLength,
      usage,
      attempts,
    })

    return {
      runId,
      status: 'READY',
      mediaAsset,
      bytes,
      sha256: sha256Digest,
      usage,
    }
  }
}
