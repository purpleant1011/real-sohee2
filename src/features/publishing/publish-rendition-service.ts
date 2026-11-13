/**
 * Publish Rendition Service (ANI-1132)
 * Manages channel-specific immutable PublishRenditions derived from approved source MediaAssets.
 * Enforces lineage tracking (source_media_asset_id -> rendition_sha256) and strict tenant isolation.
 */

import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublishRendition, MediaAsset } from '../media/media-asset-types'

export class PublishRenditionError extends Error {
  readonly code: string
  constructor(message: string, code = 'PUBLISH_RENDITION_ERROR') {
    super(message)
    this.name = 'PublishRenditionError'
    this.code = code
  }
}

export interface ChannelTransformSpec {
  format: 'jpeg' | 'png' | 'webp'
  quality: number
  width: number
  height: number
  aspectRatio: string
  transformPolicyVersion: string
}

export const CHANNEL_TRANSFORM_POLICIES: Record<string, ChannelTransformSpec> = {
  INSTAGRAM: {
    format: 'jpeg',
    quality: 90,
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    transformPolicyVersion: 'v1.0',
  },
  THREADS: {
    format: 'jpeg',
    quality: 90,
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    transformPolicyVersion: 'v1.0',
  },
  NAVER: {
    format: 'jpeg',
    quality: 90,
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    transformPolicyVersion: 'v1.0',
  },
  NAVER_BLOG: {
    format: 'jpeg',
    quality: 90,
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    transformPolicyVersion: 'v1.0',
  },
  DAANGN: {
    format: 'jpeg',
    quality: 85,
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    transformPolicyVersion: 'v1.0',
  },
}

export interface GetOrCreateRenditionInput {
  workspaceId: string
  sourceMediaAssetId: string
  channel: string
}

export class PublishRenditionService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Resolves an existing PublishRendition or immutably creates and persists a new one.
   */
  async getOrCreateRendition(input: GetOrCreateRenditionInput): Promise<PublishRendition> {
    const { workspaceId, sourceMediaAssetId } = input
    const normalizedChannel = input.channel.toUpperCase()

    // 1. Check existing rendition in database
    const { data: existingRows, error: findError } = await this.supabase
      .from('publish_renditions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('source_media_asset_id', sourceMediaAssetId)
      .eq('channel', normalizedChannel)
      .limit(1)

    if (findError) {
      throw new PublishRenditionError(
        `Failed to query existing publish rendition: ${findError.message}`,
        'RENDITION_QUERY_FAILED'
      )
    }

    if (existingRows && existingRows.length > 0) {
      return existingRows[0] as PublishRendition
    }

    // 2. Fetch and validate source MediaAsset
    const { data: mediaAsset, error: mediaError } = await this.supabase
      .from('media_assets')
      .select('*')
      .eq('id', sourceMediaAssetId)
      .maybeSingle()

    if (mediaError) {
      throw new PublishRenditionError(
        `Failed to fetch source media asset: ${mediaError.message}`,
        'MEDIA_ASSET_FETCH_FAILED'
      )
    }

    if (!mediaAsset) {
      throw new PublishRenditionError(
        `Source media asset "${sourceMediaAssetId}" not found.`,
        'SOURCE_MEDIA_NOT_FOUND'
      )
    }

    // Tenant Isolation Gate
    if (mediaAsset.workspace_id !== workspaceId) {
      throw new PublishRenditionError(
        `Cross-workspace rendition creation forbidden: media asset belongs to "${mediaAsset.workspace_id}", request workspace is "${workspaceId}".`,
        'CROSS_TENANT_RENDITION_FORBIDDEN'
      )
    }

    // Publishability Invariant Gate
    if (!mediaAsset.publish_eligibility || mediaAsset.lifecycle_status !== 'READY') {
      throw new PublishRenditionError(
        `Source media asset "${sourceMediaAssetId}" is not eligible for publish (eligibility: ${mediaAsset.publish_eligibility}, status: ${mediaAsset.lifecycle_status}).`,
        'MEDIA_INELIGIBLE_FOR_RENDITION'
      )
    }

    // 3. Determine channel transform spec
    const spec = CHANNEL_TRANSFORM_POLICIES[normalizedChannel] || {
      format: 'jpeg' as const,
      quality: 90,
      width: mediaAsset.width || 1080,
      height: mediaAsset.height || 1080,
      aspectRatio: '1:1',
      transformPolicyVersion: 'v1.0',
    }

    // 4. Construct Rendition attributes & deterministic hash lineage
    const renditionId = randomUUID()
    const storageBucket = 'content-media'
    const objectPath = `renditions/${workspaceId}/${renditionId}.${spec.format}`

    // Calculate deterministic rendition SHA-256 bound to source SHA and transform params
    const renditionSha256 = createHash('sha256')
      .update(
        `${mediaAsset.sha256_digest}:${normalizedChannel}:${spec.transformPolicyVersion}:${spec.width}x${spec.height}:${spec.format}:${spec.quality}`
      )
      .digest('hex')

    const newRendition: PublishRendition = {
      id: renditionId,
      workspace_id: workspaceId,
      source_media_asset_id: sourceMediaAssetId,
      channel: normalizedChannel,
      transform_policy_version: spec.transformPolicyVersion,
      crop_data: {
        x: 0,
        y: 0,
        width: spec.width,
        height: spec.height,
        sourceWidth: mediaAsset.width,
        sourceHeight: mediaAsset.height,
      },
      format: spec.format,
      quality: spec.quality,
      width: spec.width,
      height: spec.height,
      aspect_ratio: spec.aspectRatio,
      storage_bucket: storageBucket,
      object_path: objectPath,
      rendition_sha256: renditionSha256,
      created_at: new Date().toISOString(),
    }

    // 5. Persist to database
    const { data: insertedRows, error: insertError } = await this.supabase
      .from('publish_renditions')
      .insert({
        id: newRendition.id,
        workspace_id: newRendition.workspace_id,
        source_media_asset_id: newRendition.source_media_asset_id,
        channel: newRendition.channel,
        transform_policy_version: newRendition.transform_policy_version,
        crop_data: newRendition.crop_data,
        format: newRendition.format,
        quality: newRendition.quality,
        width: newRendition.width,
        height: newRendition.height,
        aspect_ratio: newRendition.aspect_ratio,
        storage_bucket: newRendition.storage_bucket,
        object_path: newRendition.object_path,
        rendition_sha256: newRendition.rendition_sha256,
        created_at: newRendition.created_at,
      })
      .select('*')

    if (insertError) {
      throw new PublishRenditionError(
        `Failed to persist publish rendition: ${insertError.message}`,
        'RENDITION_PERSISTENCE_FAILED'
      )
    }

    return insertedRows[0] as PublishRendition
  }
}
