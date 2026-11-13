import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { VaultEvent, VaultItem, VaultVariantPayload } from '../types'
import type { VaultDraft, VaultSaveRepository, ChannelTruth } from './save-repository'

// Generated database types do not yet include the vault migration. This adapter is the only
// untyped Data API boundary; service logic and its repository contract remain fully typed.
type Client = Pick<SupabaseClient, 'from'>
type Row = Record<string, any>
const FIELDS = 'id,workspace_id,content_id,version_id,channel,release_gate,hold_reason,held_at,held_by,target_date,approved_fingerprint,fingerprint_schema_version,policy_version,spec_version,approval_state,approved_by,bundle_id,idempotency_key,deleted_at,created_at,updated_at'
const mapItem = (r: Row): VaultItem => ({ id: r.id, workspaceId: r.workspace_id, contentId: r.content_id, versionId: r.version_id, channel: r.channel, releaseGate: r.release_gate, holdReason: r.hold_reason, heldAt: r.held_at, heldBy: r.held_by, targetDate: r.target_date, approvedFingerprint: r.approved_fingerprint, fingerprintSchemaVersion: r.fingerprint_schema_version, policyVersion: r.policy_version, specVersion: r.spec_version, approvalState: r.approval_state, approvedBy: r.approved_by, bundleId: r.bundle_id, idempotencyKey: r.idempotency_key, deletedAt: r.deleted_at, createdAt: r.created_at, updatedAt: r.updated_at })
const mapEvent = (r: Row): VaultEvent => ({ id: r.id, workspaceId: r.workspace_id, vaultItemId: r.vault_item_id, eventType: r.event_type, actorId: r.actor_id, payload: r.payload, occurredAt: r.occurred_at })
const mapPayload = (r: Row): VaultVariantPayload => ({ id: r.id, workspaceId: r.workspace_id, vaultItemId: r.vault_item_id, payload: r.payload, previewArtifacts: r.preview_artifacts, createdAt: r.created_at, updatedAt: r.updated_at })
function assertNoError(error: { code?: string; message?: string } | null) { if (error) throw new Error(`[vault-repository] ${error.code ?? 'QUERY_FAILED'}: ${error.message ?? 'Database query failed'}`) }
/** A list query must return a row list; null is a query failure, never an empty result. */
function assertRows<T>(data: T[] | null): T[] { if (!Array.isArray(data)) throw new Error('[vault-repository] QUERY_FAILED: Database query returned no row list'); return data }

export class SupabaseVaultSaveRepository implements VaultSaveRepository {
  private readonly db: any
  constructor(client: Client) { this.db = client }

  async getDraft(workspaceId: string, contentId: string, versionId: string): Promise<VaultDraft | null> {
    const content = await this.db.from('content_items').select('id,workspace_id,title').eq('workspace_id', workspaceId).eq('id', contentId).maybeSingle()
    assertNoError(content.error)
    if (!content.data) return null
    const version = await this.db.from('content_versions').select('id,workspace_id,content_id,caption,hashtags').eq('workspace_id', workspaceId).eq('content_id', contentId).eq('id', versionId).maybeSingle()
    assertNoError(version.error)
    if (!version.data) return null
    const links = await this.db.from('content_version_media').select('position,media_asset_id').eq('workspace_id', workspaceId).eq('version_id', versionId).order('position')
    assertNoError(links.error)
    const ids = assertRows(links.data as Row[] | null).map((link: Row) => link.media_asset_id)
    const assets = ids.length ? await this.db.from('media_assets').select('id,mime_type,size_bytes,sha256_digest').eq('workspace_id', workspaceId).in('id', ids) : { data: [], error: null }
    assertNoError(assets.error)
    const byId = new Map(assertRows(assets.data as Row[] | null).map((asset: Row) => [asset.id, asset]))
    // A missing image row or digest cannot produce an approved fingerprint.
    return { workspaceId, contentId, versionId, title: content.data.title, caption: version.data.caption, hashtags: version.data.hashtags, validUntil: null,
      media: assertRows(links.data as Row[] | null).map((link: Row) => {
        const asset = byId.get(link.media_asset_id) as Row | undefined
        return { position: link.position, type: asset?.mime_type?.startsWith('video/') ? 'video' : 'image', mimeType: asset?.mime_type ?? null, sizeBytes: asset?.size_bytes ?? null, renditionContentDigest: asset?.sha256_digest ?? null }
      }) }
  }

  async getChannelTruth(workspaceId: string): Promise<ChannelTruth> {
    const truth: ChannelTruth = { instagram: { verified: false, accountId: null }, threads: { verified: false, accountId: null }, naver_blog: { verified: false, accountId: null }, daangn_business: { verified: false, accountId: null } }
    // Never import getPersistedChannelVerification here: on missing receipts it performs a live provider probe.
    const [credentials, runs] = await Promise.all([
      this.db.from('meta_channel_credentials').select('provider,status,granted_scopes,token_expires_at,channel_connections(external_account_id)').eq('workspace_id', workspaceId),
      this.db.from('channel_verification_runs').select('channel,status,read_after_write_at,created_at').eq('workspace_id', workspaceId).in('channel', ['instagram', 'threads']).in('status', ['VERIFIED', 'success']).order('created_at', { ascending: false }),
    ])
    if (credentials.error || runs.error || !Array.isArray(credentials.data) || !Array.isArray(runs.data)) return truth
    const now = Date.now()
    for (const channel of ['instagram', 'threads'] as const) {
      const credential = (credentials.data as Row[]).find((r: Row) => r.provider === channel)
      const receipt = (runs.data as Row[]).find((r: Row) => r.channel === channel)
      const scopes = credential?.granted_scopes ?? []
      const required = channel === 'instagram' ? ['instagram_business_basic', 'instagram_business_content_publish'] : ['threads_basic', 'threads_content_publish']
      const verified = credential && ['active', 'connected'].includes(credential.status) && required.every(scope => scopes.includes(scope))
        && Date.parse(credential.token_expires_at) > now + 86_400_000
        && receipt && Date.parse(receipt.read_after_write_at || receipt.created_at) > now - 7 * 86_400_000
        && credential.channel_connections?.external_account_id
      if (verified) truth[channel] = { verified: true, accountId: credential.channel_connections.external_account_id }
    }
    return truth
  }
  async getProviderReviewStatus(): Promise<'APPROVED' | 'PENDING' | 'REJECTED' | 'UNKNOWN'> {
    const value = process.env.META_APP_REVIEW_STATUS?.toUpperCase()
    return value === 'APPROVED' || value === 'PENDING' || value === 'REJECTED' ? value : 'UNKNOWN'
  }
  async findByIdempotencyKey(workspaceId: string, key: string): Promise<VaultItem | null> {
    const { data, error } = await this.db.from('vault_items').select(FIELDS).eq('workspace_id', workspaceId).eq('idempotency_key', key).maybeSingle()
    assertNoError(error)
    return data ? mapItem(data) : null
  }
  async createItem(item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ item: VaultItem; created: boolean }> {
    const row = { workspace_id: item.workspaceId, content_id: item.contentId, version_id: item.versionId, channel: item.channel, release_gate: item.releaseGate, hold_reason: item.holdReason, held_at: item.heldAt, held_by: item.heldBy, target_date: item.targetDate, approved_fingerprint: item.approvedFingerprint, fingerprint_schema_version: item.fingerprintSchemaVersion, policy_version: item.policyVersion, spec_version: item.specVersion, approval_state: item.approvalState, approved_by: item.approvedBy, bundle_id: item.bundleId, idempotency_key: item.idempotencyKey, deleted_at: item.deletedAt }
    // ON CONFLICT DO NOTHING avoids an insert error that would poison a surrounding transaction.
    const { data, error } = await this.db.from('vault_items').upsert(row, { onConflict: 'workspace_id,idempotency_key', ignoreDuplicates: true }).select(FIELDS).maybeSingle()
    assertNoError(error)
    if (!data) {
      const prior = await this.findByIdempotencyKey(item.workspaceId, item.idempotencyKey)
      if (!prior) throw new Error('[vault-repository] conflict row unavailable')
      return { item: prior, created: false }
    }
    return { item: mapItem(data), created: true }
  }
  async putVariantPayload(payload: Omit<VaultVariantPayload, 'id' | 'createdAt' | 'updatedAt'>): Promise<VaultVariantPayload> {
    const { data: existing, error: readError } = await this.db.from('vault_variant_payloads').select('*').eq('workspace_id', payload.workspaceId).eq('vault_item_id', payload.vaultItemId).maybeSingle()
    assertNoError(readError)
    if (existing) return mapPayload(existing)
    const { data, error } = await this.db.from('vault_variant_payloads').upsert({ workspace_id: payload.workspaceId, vault_item_id: payload.vaultItemId, payload: payload.payload, preview_artifacts: payload.previewArtifacts }, { onConflict: 'workspace_id,vault_item_id', ignoreDuplicates: true }).select('*').maybeSingle()
    assertNoError(error)
    if (!data) {
      const prior = await this.getVariantPayload(payload.workspaceId, payload.vaultItemId)
      if (!prior) throw new Error('[vault-repository] variant conflict row unavailable')
      return prior
    }
    return mapPayload(data)
  }
  async getVariantPayload(workspaceId: string, itemId: string): Promise<VaultVariantPayload | null> {
    const { data, error } = await this.db.from('vault_variant_payloads').select('*').eq('workspace_id', workspaceId).eq('vault_item_id', itemId).maybeSingle()
    assertNoError(error)
    return data ? mapPayload(data) : null
  }
  async appendEvent(event: Omit<VaultEvent, 'id' | 'occurredAt'>): Promise<VaultEvent> {
    const { data, error } = await this.db.from('vault_events').insert({ workspace_id: event.workspaceId, vault_item_id: event.vaultItemId, event_type: event.eventType, actor_id: event.actorId, payload: event.payload }).select('*').maybeSingle()
    assertNoError(error)
    return mapEvent(data)
  }
  async listEvents(workspaceId: string, itemId: string): Promise<readonly VaultEvent[]> {
    const { data, error } = await this.db.from('vault_events').select('*').eq('workspace_id', workspaceId).eq('vault_item_id', itemId)
    assertNoError(error)
    return assertRows(data as Row[] | null).map(mapEvent)
  }
  async listItems(workspaceId: string): Promise<readonly VaultItem[]> {
    const { data, error } = await this.db.from('vault_items').select(FIELDS).eq('workspace_id', workspaceId).is('deleted_at', null)
    assertNoError(error)
    return assertRows(data as Row[] | null).map(mapItem)
  }
  async updateItem(workspaceId: string, itemId: string, changes: Partial<VaultItem>): Promise<VaultItem> {
    const row: Row = {}
    for (const [key, column] of Object.entries({ releaseGate: 'release_gate', holdReason: 'hold_reason', heldAt: 'held_at', heldBy: 'held_by', targetDate: 'target_date', approvalState: 'approval_state' })) {
      if (key in changes) row[column] = changes[key as keyof VaultItem]
    }
    const { data, error } = await this.db.from('vault_items').update(row).eq('workspace_id', workspaceId).eq('id', itemId).select(FIELDS).maybeSingle()
    assertNoError(error)
    if (!data) throw new Error('[vault-repository] vault item unavailable')
    return mapItem(data)
  }
}
