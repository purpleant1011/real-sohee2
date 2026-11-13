/**
 * Supabase CreativeBundle Store (ANI-1129)
 * Provides durable database persistence and retrieval for CreativeBundle & ordered media assets.
 * Enforces strict workspace tenant isolation on all bound media assets.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CreativeBundle,
  CreativeBundleInput,
  BundleOrderedMediaItem,
  TargetChannel,
} from './creative-bundle-types'
import {
  createCreativeBundle,
  validateCreativeBundleInput,
} from './creative-bundle-engine'

export class CrossTenantMediaAssetError extends Error {
  readonly code = 'CROSS_TENANT_MEDIA_ASSET_DENIED'
  constructor(message: string) {
    super(message)
    this.name = 'CrossTenantMediaAssetError'
  }
}

export class CreativeBundleStoreError extends Error {
  readonly code: string
  constructor(message: string, code = 'CREATIVE_BUNDLE_STORE_ERROR') {
    super(message)
    this.name = 'CreativeBundleStoreError'
    this.code = code
  }
}

export class SupabaseCreativeBundleStore {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Persists a newly constructed CreativeBundle and its ordered media items.
   * Fails closed if any bound media asset belongs to another workspace.
   */
  async persistBundle(input: CreativeBundleInput): Promise<CreativeBundle> {
    validateCreativeBundleInput(input)

    // 1. Tenant Isolation Verification: Check all media assets belong to the workspace
    const mediaIds = [...new Set(input.orderedMedia.map((m) => m.mediaAssetId))]
    const { data: mediaRows, error: mediaQueryError } = await this.supabase
      .from('media_assets')
      .select('id, workspace_id')
      .in('id', mediaIds)

    if (mediaQueryError) {
      throw new CreativeBundleStoreError(
        `Failed to verify media asset tenancy: ${mediaQueryError.message}`,
        'MEDIA_TENANCY_QUERY_FAILED'
      )
    }

    const foundMedia = mediaRows || []
    if (foundMedia.length !== mediaIds.length) {
      const foundIds = new Set(foundMedia.map((m: any) => m.id))
      const missing = mediaIds.filter((id) => !foundIds.has(id))
      throw new CreativeBundleStoreError(
        `Media assets not found in database: ${missing.join(', ')}`,
        'MEDIA_ASSET_NOT_FOUND'
      )
    }

    for (const media of foundMedia) {
      if (media.workspace_id !== input.workspaceId) {
        throw new CrossTenantMediaAssetError(
          `Security violation: Media asset ${media.id} belongs to workspace ${media.workspace_id}, cannot bind to workspace ${input.workspaceId}`
        )
      }
    }

    // 2. Build canonical CreativeBundle domain entity
    const bundle = createCreativeBundle(input)

    // 3. Mark previous pending bundles for the same (workspace, content, version, channel) as SUPERSEDED
    const { error: supersedeError } = await this.supabase
      .from('creative_bundles')
      .update({
        approval_status: 'SUPERSEDED',
        updated_at: new Date().toISOString(),
      })
      .match({
        workspace_id: input.workspaceId,
        content_id: input.contentId,
        version_id: input.versionId,
        channel: input.channel,
        approval_status: 'PENDING',
      })

    if (supersedeError) {
      console.warn('[SupabaseCreativeBundleStore] Warning: Failed to mark prior pending bundles as superseded:', supersedeError.message)
    }

    // 4. Insert creative_bundles row
    const bundleRow = {
      id: bundle.bundleId,
      workspace_id: bundle.workspaceId,
      content_id: bundle.contentId,
      version_id: bundle.versionId,
      channel: bundle.channel,
      caption: bundle.caption,
      hashtags: bundle.hashtags,
      creative_brief_version: bundle.creativeBriefVersion,
      bundle_fingerprint: bundle.bundleFingerprint,
      approval_status: bundle.approvalStatus,
      created_at: bundle.createdAt,
      updated_at: bundle.updatedAt,
    }

    const { data: insertedBundle, error: bundleInsertError } = await this.supabase
      .from('creative_bundles')
      .insert(bundleRow)
      .select()
      .single()

    if (bundleInsertError || !insertedBundle) {
      throw new CreativeBundleStoreError(
        `Failed to persist creative bundle: ${bundleInsertError?.message || 'Unknown error'}`,
        'BUNDLE_INSERT_FAILED'
      )
    }

    // 5. Insert ordered creative_bundle_media rows
    const mediaRowsToInsert = bundle.orderedMedia.map((item) => ({
      bundle_id: bundle.bundleId,
      media_asset_id: item.mediaAssetId,
      position: item.position,
      role: item.role,
      sha256_digest: item.sha256Digest,
      crop_data: item.cropData || null,
      created_at: bundle.createdAt,
    }))

    const { error: mediaInsertError } = await this.supabase
      .from('creative_bundle_media')
      .insert(mediaRowsToInsert)

    if (mediaInsertError) {
      // Compensating Action: Roll back newly created bundle to prevent orphan rows
      try {
        await this.supabase.from('creative_bundles').delete().eq('id', bundle.bundleId)
      } catch (cleanupErr) {
        console.error('[SupabaseCreativeBundleStore] Failed compensating rollback for bundle:', bundle.bundleId, cleanupErr)
      }

      throw new CreativeBundleStoreError(
        `Failed to persist creative bundle media: ${mediaInsertError.message}`,
        'BUNDLE_MEDIA_INSERT_FAILED'
      )
    }

    return bundle
  }

  /**
   * Retrieves a bundle by its unique ID, joining ordered media in deterministic position order.
   */
  async getBundleById(
    workspaceId: string,
    bundleId: string
  ): Promise<CreativeBundle | null> {
    const { data: bundleRow, error: bundleError } = await this.supabase
      .from('creative_bundles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', bundleId)
      .single()

    if (bundleError || !bundleRow) {
      return null
    }

    const { data: mediaRows, error: mediaError } = await this.supabase
      .from('creative_bundle_media')
      .select('*')
      .eq('bundle_id', bundleId)
      .order('position', { ascending: true })

    if (mediaError) {
      throw new CreativeBundleStoreError(
        `Failed to fetch bundle media items: ${mediaError.message}`,
        'BUNDLE_MEDIA_FETCH_FAILED'
      )
    }

    const orderedMedia: BundleOrderedMediaItem[] = (mediaRows || []).map((row: any) => ({
      mediaAssetId: row.media_asset_id,
      sha256Digest: row.sha256_digest,
      position: row.position,
      role: row.role,
      cropData: row.crop_data || undefined,
    }))

    return {
      bundleId: bundleRow.id,
      workspaceId: bundleRow.workspace_id,
      contentId: bundleRow.content_id,
      versionId: bundleRow.version_id,
      channel: bundleRow.channel as TargetChannel,
      caption: bundleRow.caption,
      hashtags: bundleRow.hashtags || [],
      orderedMedia,
      creativeBriefVersion: bundleRow.creative_brief_version,
      bundleFingerprint: bundleRow.bundle_fingerprint,
      approvalStatus: bundleRow.approval_status,
      approvedFingerprint: bundleRow.approved_fingerprint || undefined,
      approvedAt: bundleRow.approved_at || undefined,
      approvedBy: bundleRow.approved_by || undefined,
      createdAt: bundleRow.created_at,
      updatedAt: bundleRow.updated_at,
    }
  }

  /**
   * Retrieves the latest bundle for a given content version and optional channel.
   */
  async getLatestBundleForVersion(
    workspaceId: string,
    versionId: string,
    channel?: TargetChannel
  ): Promise<CreativeBundle | null> {
    let query = this.supabase
      .from('creative_bundles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('version_id', versionId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (channel) {
      query = query.eq('channel', channel)
    }

    const { data: bundleRows, error } = await query
    if (error || !bundleRows || bundleRows.length === 0) {
      return null
    }

    return this.getBundleById(workspaceId, bundleRows[0].id)
  }
}
