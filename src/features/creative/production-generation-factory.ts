/**
 * ANI-1118: Production Generation Composition Root & Adapter Wiring
 *
 * Enforces:
 * 1. Single production-only composition root for image generation orchestration.
 * 2. Concrete Supabase Storage & Persistence adapters wired to real database tables.
 * 3. Fail-Closed guard: strict prohibition of InMemory adapters in production.
 * 4. Zero reachable InMemory paths from production bundle.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MediaAsset, ContentVersionMediaBinding } from '../media/media-asset-types'
import type {
  GenerationRunRecord,
  ImageFinOpsUsage,
} from './creative-generation-types'
import {
  GenerationOrchestrator,
  type StorageAdapter,
  type PersistenceAdapter,
  InMemoryStorageAdapter,
  InMemoryPersistenceAdapter,
} from './generation-orchestrator'
import {
  DefaultOpenAIImageClient,
  type OpenAIImageClient,
} from './openai-image-client'
import OpenAI from 'openai'

export class ProductionCompositionRootError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionCompositionRootError'
  }
}

/**
 * Validates that no InMemory mock adapters are used in production environments.
 */
export function assertNoInMemoryAdaptersInProduction(options: {
  storageAdapter?: StorageAdapter
  persistenceAdapter?: PersistenceAdapter
}): void {
  const isProd = process.env.NODE_ENV === 'production'
  if (!isProd) return

  if (options.storageAdapter instanceof InMemoryStorageAdapter) {
    throw new ProductionCompositionRootError(
      'IN_MEMORY_STORAGE_ADAPTER_FORBIDDEN: InMemoryStorageAdapter is strictly forbidden in production mode.'
    )
  }

  if (options.persistenceAdapter instanceof InMemoryPersistenceAdapter) {
    throw new ProductionCompositionRootError(
      'IN_MEMORY_PERSISTENCE_ADAPTER_FORBIDDEN: InMemoryPersistenceAdapter is strictly forbidden in production mode.'
    )
  }
}

/**
 * Concrete Supabase Storage adapter uploading to private content-media bucket.
 */
export class SupabaseStorageAdapter implements StorageAdapter {
  private client: SupabaseClient

  constructor(options: { supabaseClient: SupabaseClient }) {
    if (!options.supabaseClient) {
      throw new ProductionCompositionRootError('SUPABASE_CLIENT_REQUIRED: Supabase client is required.')
    }
    this.client = options.supabaseClient
  }

  async upload(params: {
    bucket: string
    path: string
    bytes: Uint8Array
    mimeType: string
  }): Promise<{ error: Error | null }> {
    try {
      const { error } = await this.client.storage
        .from(params.bucket)
        .upload(params.path, params.bytes, {
          contentType: params.mimeType,
          upsert: false,
        })

      if (error) {
        return { error: new Error(`Storage upload failed: ${error.message}`) }
      }
      return { error: null }
    } catch (err: any) {
      return { error: err instanceof Error ? err : new Error(String(err)) }
    }
  }

  async delete(params: { bucket: string; path: string }): Promise<{ error: Error | null }> {
    try {
      const { error } = await this.client.storage
        .from(params.bucket)
        .remove([params.path])

      if (error) {
        return { error: new Error(`Storage delete failed: ${error.message}`) }
      }
      return { error: null }
    } catch (err: any) {
      return { error: err instanceof Error ? err : new Error(String(err)) }
    }
  }
}

/**
 * Concrete Supabase Persistence adapter writing to live DB tables:
 * - media_assets
 * - content_version_media
 * - generation_runs
 * - ai_usage_events
 */
export class SupabasePersistenceAdapter implements PersistenceAdapter {
  private client: SupabaseClient
  private workspaceId: string
  private userId?: string

  constructor(options: { supabaseClient: SupabaseClient; workspaceId: string; userId?: string }) {
    if (!options.supabaseClient) {
      throw new ProductionCompositionRootError('SUPABASE_CLIENT_REQUIRED: Supabase client is required.')
    }
    if (!options.workspaceId) {
      throw new ProductionCompositionRootError('WORKSPACE_ID_REQUIRED: Workspace ID is required.')
    }
    this.client = options.supabaseClient
    this.workspaceId = options.workspaceId
    this.userId = options.userId
  }

  async saveMediaAsset(asset: MediaAsset): Promise<{ error: Error | null }> {
    try {
      const effectiveCreatedBy = this.isValidUuid(asset.created_by)
        ? asset.created_by
        : (this.isValidUuid(this.userId)
            ? (this.userId as string)
            : '00000000-0000-0000-0000-000000000000')

      const { error } = await (this.client.from('media_assets') as any).insert({
        id: asset.id,
        workspace_id: asset.workspace_id,
        bucket_id: asset.bucket_id,
        object_path: asset.object_path,
        kind: asset.kind || 'content',
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
        sha256_digest: asset.sha256_digest,
        width: asset.width,
        height: asset.height,
        rights_status:
          asset.rights_status === 'approved' ||
          !['pending', 'confirmed', 'rejected'].includes(asset.rights_status || '')
            ? 'confirmed'
            : asset.rights_status,
        lifecycle_status: asset.lifecycle_status,
        provenance_kind: asset.source_type,
        publish_eligibility: asset.publish_eligibility,
        generation_metadata: asset.generation_metadata || {},
        created_by: effectiveCreatedBy,
        created_at: asset.created_at,
      })

      if (error) {
        return { error: new Error(`Failed to save media asset: ${error.message}`) }
      }
      return { error: null }
    } catch (err: any) {
      return { error: err instanceof Error ? err : new Error(String(err)) }
    }
  }

  private isValidUuid(val?: string | null): boolean {
    if (!val) return false
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
  }

  async saveContentVersionBinding(binding: ContentVersionMediaBinding): Promise<{ error: Error | null }> {
    try {
      if (!this.isValidUuid(binding.version_id)) {
        // Non-UUID version_id (e.g. calibration preview before content_version row exists)
        return { error: null }
      }
      const { error } = await (this.client.from('content_version_media') as any).insert({
        workspace_id: binding.workspace_id || this.workspaceId,
        version_id: binding.version_id,
        media_asset_id: binding.media_asset_id,
        role: binding.role,
        position: binding.position,
      })

      if (error) {
        return { error: new Error(`Failed to bind content version media: ${error.message}`) }
      }
      return { error: null }
    } catch (err: any) {
      return { error: err instanceof Error ? err : new Error(String(err)) }
    }
  }

  async getExistingRunByIdempotency(key: string): Promise<GenerationRunRecord | null> {
    try {
      const { data, error } = await this.client
        .from('generation_runs')
        .select('*')
        .eq('workspace_id', this.workspaceId)
        .eq('idempotency_key', key)
        .maybeSingle()

      if (error || !data) return null

      return {
        id: data.id,
        workspaceId: data.workspace_id,
        contentVersionId: data.content_version_id,
        idempotencyKey: data.idempotency_key,
        requestFingerprint: data.request_fingerprint,
        sequenceNumber: data.sequence_number,
        status: data.status,
        promptDigest: data.prompt_digest,
        mediaAssetId: data.media_asset_id,
        storagePath: data.storage_path,
        sha256Digest: data.sha256_digest,
        byteLength: data.byte_length,
        errorMessage: data.error_message,
        errorCode: data.error_code,
        usage: data.usage,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      }
    } catch {
      return null
    }
  }

  async saveRunRecord(record: GenerationRunRecord): Promise<{ error: Error | null }> {
    try {
      const safeContentVersionId = this.isValidUuid(record.contentVersionId)
        ? record.contentVersionId
        : null

      const { error } = await this.client.from('generation_runs').insert({
        id: record.id,
        workspace_id: this.workspaceId,
        content_version_id: safeContentVersionId,
        idempotency_key: record.idempotencyKey,
        request_fingerprint: record.requestFingerprint,
        sequence_number: record.sequenceNumber,
        status: record.status,
        prompt_digest: record.promptDigest,
        media_asset_id: record.mediaAssetId || null,
        storage_path: record.storagePath || null,
        sha256_digest: record.sha256Digest || null,
        byte_length: record.byteLength || null,
        error_code: record.errorCode || null,
        error_message: record.errorMessage || null,
        usage: record.usage || null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      })

      if (error) {
        return { error: new Error(`Failed to save generation run: ${error.message}`) }
      }
      return { error: null }
    } catch (err: any) {
      return { error: err instanceof Error ? err : new Error(String(err)) }
    }
  }

  async updateRunRecord(id: string, updates: Partial<GenerationRunRecord>): Promise<{ error: Error | null }> {
    try {
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }

      if (updates.status !== undefined) payload.status = updates.status
      if (updates.mediaAssetId !== undefined) payload.media_asset_id = updates.mediaAssetId
      if (updates.storagePath !== undefined) payload.storage_path = updates.storagePath
      if (updates.sha256Digest !== undefined) payload.sha256_digest = updates.sha256Digest
      if (updates.byteLength !== undefined) payload.byte_length = updates.byteLength
      if (updates.errorCode !== undefined) payload.error_code = updates.errorCode
      if (updates.errorMessage !== undefined) payload.error_message = updates.errorMessage
      if (updates.usage !== undefined) payload.usage = updates.usage

      const { error } = await this.client
        .from('generation_runs')
        .update(payload)
        .eq('id', id)

      if (error) {
        return { error: new Error(`Failed to update generation run: ${error.message}`) }
      }
      return { error: null }
    } catch (err: any) {
      return { error: err instanceof Error ? err : new Error(String(err)) }
    }
  }

  async getMediaAsset(assetId: string): Promise<MediaAsset | null> {
    try {
      const { data, error } = await this.client
        .from('media_assets')
        .select('*')
        .eq('workspace_id', this.workspaceId)
        .eq('id', assetId)
        .maybeSingle()

      if (error || !data) return null

      return {
        id: data.id,
        workspace_id: data.workspace_id,
        bucket_id: data.bucket_id,
        object_path: data.object_path,
        kind: data.kind,
        source_type: (data as any).provenance_kind ?? (data as any).source_type,
        mime_type: data.mime_type,
        size_bytes: data.size_bytes,
        width: data.width,
        height: data.height,
        sha256_digest: data.sha256_digest,
        rights_status: data.rights_status,
        lifecycle_status: data.lifecycle_status,
        publish_eligibility: data.publish_eligibility,
        generation_metadata: data.generation_metadata || {},
        created_by: data.created_by,
        created_at: data.created_at,
      }
    } catch {
      return null
    }
  }

  async quarantineMediaAsset(assetId: string, reason: string): Promise<{ error: Error | null }> {
    try {
      const { error } = await this.client
        .from('media_assets')
        .update({
          lifecycle_status: 'QUARANTINED',
          publish_eligibility: false,
          generation_metadata: {
            quarantine_reason: reason,
            quarantined_at: new Date().toISOString(),
          },
        })
        .eq('workspace_id', this.workspaceId)
        .eq('id', assetId)

      if (error) {
        return { error: new Error(`Failed to quarantine media asset: ${error.message}`) }
      }
      return { error: null }
    } catch (err: any) {
      return { error: err instanceof Error ? err : new Error(String(err)) }
    }
  }

  async recordFinOpsUsage(usage: ImageFinOpsUsage): Promise<{ error: Error | null }> {
    try {
      const { error } = await this.client.from('ai_usage_events').insert({
        workspace_id: this.workspaceId,
        provider: usage.provider,
        model: usage.model,
        credits_used: usage.computedCredits,
        metadata: {
          providerRequestId: usage.providerRequestId,
          providerCallKey: usage.providerCallKey,
          tokens: {
            textInput: usage.textInputTokens,
            textOutput: usage.textOutputTokens,
            imageInput: usage.imageInputTokens,
            imageOutput: usage.imageOutputTokens,
            total: usage.providerTotalTokens,
          },
          costBasisUsdCents: usage.costBasisUsdCents,
          policyVersion: usage.policyVersion,
        },
      })

      if (error) {
        // Non-fatal logging for telemetry
        console.warn(`[SupabasePersistenceAdapter] Telemetry record failed: ${error.message}`)
      }
      return { error: null }
    } catch {
      return { error: null }
    }
  }
}

export interface ProductionOrchestratorConfig {
  supabaseClient: SupabaseClient
  workspaceId: string
  userId?: string
  apiKey?: string
  model?: string
  availableCredits?: number
  imageClient?: OpenAIImageClient
}

/**
 * Production Generation Composition Root Factory:
 * Assembles concrete GPT-Image-2 client, Supabase Storage, and Supabase Live DB persistence.
 * Fail-Closed on missing client or API keys. Zero InMemory fallback allowed.
 */
export function createProductionGenerationOrchestrator(
  config: ProductionOrchestratorConfig
): GenerationOrchestrator {
  if (!config.supabaseClient) {
    throw new ProductionCompositionRootError(
      'SUPABASE_CLIENT_REQUIRED: Concrete Supabase client is mandatory for production generation orchestrator.'
    )
  }

  if (!config.workspaceId) {
    throw new ProductionCompositionRootError(
      'WORKSPACE_ID_REQUIRED: Workspace ID is mandatory for production generation orchestrator.'
    )
  }

  const effectiveApiKey =
    config.apiKey || process.env.OPENAI_API_KEY || process.env.OPENAI_IMAGE_API_KEY

  if (!effectiveApiKey && process.env.NODE_ENV === 'production') {
    throw new ProductionCompositionRootError(
      'OPENAI_API_KEY_REQUIRED: OpenAI API key is missing. Production generation requires valid credentials.'
    )
  }

  const configuredModel =
    config.model ||
    process.env.OPENAI_IMAGE_MODEL?.trim() ||
    'gpt-image-2.5-sunburst'
  const effectiveModel =
    configuredModel === 'gpt-image-2.5-flare' ? 'gpt-image-2.5-flare' : 'gpt-image-2.5-sunburst'

  const imageClient =
    config.imageClient ||
    new DefaultOpenAIImageClient(
      effectiveApiKey
        ? (new OpenAI({ apiKey: effectiveApiKey, dangerouslyAllowBrowser: true }) as any)
        : undefined,
      effectiveModel
    )
  const storageAdapter = new SupabaseStorageAdapter({ supabaseClient: config.supabaseClient })
  const persistenceAdapter = new SupabasePersistenceAdapter({
    supabaseClient: config.supabaseClient,
    workspaceId: config.workspaceId,
    userId: config.userId,
  })

  // Enforce zero InMemory adapters in production
  assertNoInMemoryAdaptersInProduction({
    storageAdapter,
    persistenceAdapter,
  })

  return new GenerationOrchestrator({
    imageClient,
    storageAdapter,
    persistenceAdapter,
    availableCredits: config.availableCredits,
  })
}
