import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { VaultEvent, VaultItem, VaultVariantPayload } from '../types'
import type { ManualPublishRecord } from './types'
import type {
  RenditionReader,
  RenditionSigner,
  VaultImageRendition,
} from '../rendition/repository'

type Client = Pick<SupabaseClient, 'from' | 'storage'>
type Row = Record<string, any>

const VAULT_ITEM_FIELDS =
  'id,workspace_id,content_id,version_id,channel,release_gate,hold_reason,held_at,held_by,target_date,approved_fingerprint,fingerprint_schema_version,policy_version,spec_version,approval_state,approved_by,bundle_id,idempotency_key,deleted_at,created_at,updated_at'

function mapItem(r: Row): VaultItem {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    contentId: r.content_id,
    versionId: r.version_id,
    channel: r.channel,
    releaseGate: r.release_gate,
    holdReason: r.hold_reason,
    heldAt: r.held_at,
    heldBy: r.held_by,
    targetDate: r.target_date,
    approvedFingerprint: r.approved_fingerprint,
    fingerprintSchemaVersion: r.fingerprint_schema_version,
    policyVersion: r.policy_version,
    specVersion: r.spec_version,
    approvalState: r.approval_state,
    approvedBy: r.approved_by,
    bundleId: r.bundle_id,
    idempotencyKey: r.idempotency_key,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapPayload(r: Row): VaultVariantPayload {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    vaultItemId: r.vault_item_id,
    payload: r.payload,
    previewArtifacts: r.preview_artifacts,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapManualPublish(r: Row): ManualPublishRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    vaultItemId: r.vault_item_id,
    channel: r.channel,
    publishedUrl: r.published_url,
    verificationStatus: 'UNVERIFIED',
    registeredBy: r.registered_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapEvent(r: Row): VaultEvent {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    vaultItemId: r.vault_item_id,
    eventType: r.event_type,
    actorId: r.actor_id,
    payload: r.payload,
    occurredAt: r.occurred_at,
  }
}

function assertNoError(error: { code?: string; message?: string } | null) {
  if (error) {
    throw new Error(
      `[vault-bundle-repository] ${error.code ?? 'QUERY_FAILED'}: ${error.message ?? 'Database query failed'}`,
    )
  }
}

/** A list query must return a row list; null is a query failure, never an empty result. */
function assertRows<T>(data: T[] | null): T[] {
  if (!Array.isArray(data)) {
    throw new Error('[vault-bundle-repository] QUERY_FAILED: Database query returned no row list')
  }
  return data
}

export interface VaultBundleRepository {
  getItem(workspaceId: string, itemId: string): Promise<VaultItem | null>
  getVariantPayload(
    workspaceId: string,
    itemId: string,
  ): Promise<VaultVariantPayload | null>
  getPublishedUrl(
    workspaceId: string,
    itemId: string,
  ): Promise<ManualPublishRecord | null>
  savePublishedUrl(
    record: Omit<ManualPublishRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ManualPublishRecord>
  appendEvent(event: Omit<VaultEvent, 'id' | 'occurredAt'>): Promise<VaultEvent>
}

export class SupabaseVaultBundleRepository implements VaultBundleRepository {
  private readonly db: any
  constructor(client: Client) {
    this.db = client
  }

  async getItem(workspaceId: string, itemId: string): Promise<VaultItem | null> {
    const { data, error } = await this.db
      .from('vault_items')
      .select(VAULT_ITEM_FIELDS)
      .eq('workspace_id', workspaceId)
      .eq('id', itemId)
      .is('deleted_at', null)
      .maybeSingle()
    assertNoError(error)
    return data ? mapItem(data) : null
  }

  async getVariantPayload(
    workspaceId: string,
    itemId: string,
  ): Promise<VaultVariantPayload | null> {
    const { data, error } = await this.db
      .from('vault_variant_payloads')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('vault_item_id', itemId)
      .maybeSingle()
    assertNoError(error)
    return data ? mapPayload(data) : null
  }

  async getPublishedUrl(
    workspaceId: string,
    itemId: string,
  ): Promise<ManualPublishRecord | null> {
    const { data, error } = await this.db
      .from('vault_published_urls')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('vault_item_id', itemId)
      .maybeSingle()
    assertNoError(error)
    return data ? mapManualPublish(data) : null
  }

  async savePublishedUrl(
    record: Omit<ManualPublishRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ManualPublishRecord> {
    const existing = await this.getPublishedUrl(
      record.workspaceId,
      record.vaultItemId,
    )
    if (existing) {
      const { data, error } = await this.db
        .from('vault_published_urls')
        .update({
          published_url: record.publishedUrl,
          channel: record.channel,
          verification_status: 'UNVERIFIED',
          registered_by: record.registeredBy,
        })
        .eq('workspace_id', record.workspaceId)
        .eq('vault_item_id', record.vaultItemId)
        .select('*')
        .maybeSingle()
      assertNoError(error)
      if (!data) {
        throw new Error(
          '[vault-bundle-repository] Failed to update published url',
        )
      }
      return mapManualPublish(data)
    }

    const { data, error } = await this.db
      .from('vault_published_urls')
      .upsert(
        {
          workspace_id: record.workspaceId,
          vault_item_id: record.vaultItemId,
          channel: record.channel,
          published_url: record.publishedUrl,
          verification_status: 'UNVERIFIED',
          registered_by: record.registeredBy,
        },
        { onConflict: 'workspace_id,vault_item_id', ignoreDuplicates: true },
      )
      .select('*')
      .maybeSingle()
    assertNoError(error)
    if (!data) {
      const fallback = await this.getPublishedUrl(
        record.workspaceId,
        record.vaultItemId,
      )
      if (fallback) return fallback
      throw new Error(
        '[vault-bundle-repository] Failed to persist published url',
      )
    }
    return mapManualPublish(data)
  }

  async appendEvent(
    event: Omit<VaultEvent, 'id' | 'occurredAt'>,
  ): Promise<VaultEvent> {
    const { data, error } = await this.db
      .from('vault_events')
      .insert({
        workspace_id: event.workspaceId,
        vault_item_id: event.vaultItemId,
        event_type: event.eventType,
        actor_id: event.actorId,
        payload: event.payload,
      })
      .select('*')
      .maybeSingle()
    assertNoError(error)
    return mapEvent(data)
  }
}

export function createSupabaseRenditionReader(
  client: Pick<SupabaseClient, 'from'>,
): RenditionReader {
  return {
    async list(
      workspaceId: string,
      vaultItemId: string,
    ): Promise<VaultImageRendition[]> {
      const { data, error } = await (client as any)
        .from('vault_image_renditions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('vault_item_id', vaultItemId)
      assertNoError(error)
      return assertRows(data as Row[] | null).map((r: Row) => ({
        id: r.id,
        workspace_id: r.workspace_id,
        vault_item_id: r.vault_item_id,
        source_media_asset_id: r.source_media_asset_id,
        channel: r.channel,
        storage_bucket: r.storage_bucket,
        object_path: r.object_path,
        rendition_content_digest: r.rendition_content_digest,
        rights_expires_at: r.rights_expires_at,
        qc_expires_at: r.qc_expires_at,
      }))
    },
  }
}

export function createSupabaseRenditionSigner(
  client: Pick<SupabaseClient, 'storage'>,
): RenditionSigner {
  return {
    async createSignedUrl(
      bucket: string,
      objectPath: string,
      ttlSeconds: number,
    ): Promise<string> {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(objectPath, ttlSeconds)
      if (error || !data?.signedUrl) {
        throw new Error(
          `[vault-bundle-signer] Failed to create signed URL: ${error?.message ?? 'unknown'}`,
        )
      }
      return data.signedUrl
    },
  }
}
