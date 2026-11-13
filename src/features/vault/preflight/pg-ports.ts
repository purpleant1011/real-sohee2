import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { CURRENT_SPEC_VERSION } from '../channel-spec/spec-table'
import type { PreflightPorts, PreflightSnapshot, PreflightConnectionHealth } from './index'
import type { VaultItem, VaultPreflightRun, VaultJson } from '../types'
import type { VaultFingerprintV3Input } from '../fingerprint/fingerprint'

/** Read-only persisted evidence; no provider API imports and no action-request writes. */
export class PgVaultPreflightPorts implements PreflightPorts {
  private readonly db: any
  constructor(client: Pick<SupabaseClient, 'from'>) { this.db = client }
  vault = {
    getItem: async (workspaceId: string, itemId: string): Promise<VaultItem | null> => {
      const { data, error } = await this.db.from('vault_items').select('*').eq('workspace_id', workspaceId).eq('id', itemId).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? { id: data.id, workspaceId: data.workspace_id, contentId: data.content_id, versionId: data.version_id, channel: data.channel, releaseGate: data.release_gate, holdReason: data.hold_reason, heldAt: data.held_at, heldBy: data.held_by, targetDate: data.target_date, approvedFingerprint: data.approved_fingerprint, fingerprintSchemaVersion: data.fingerprint_schema_version, policyVersion: data.policy_version, specVersion: data.spec_version, approvalState: data.approval_state, approvedBy: data.approved_by, bundleId: data.bundle_id, idempotencyKey: data.idempotency_key, deletedAt: data.deleted_at, createdAt: data.created_at, updatedAt: data.updated_at } : null
    },
    recordPreflightRun: async (run: Omit<VaultPreflightRun, 'id' | 'runAt'>): Promise<VaultPreflightRun> => {
      const { data, error } = await this.db.from('preflight_runs').insert({ workspace_id: run.workspaceId, vault_item_id: run.vaultItemId, overall: run.overall, items: run.items, triggered_by: run.triggeredBy }).select('*').maybeSingle()
      if (error || !data) throw new Error(error?.message ?? 'Preflight evidence not recorded')
      return { id: data.id, workspaceId: data.workspace_id, vaultItemId: data.vault_item_id, overall: data.overall, items: data.items as VaultJson[], triggeredBy: data.triggered_by, runAt: data.run_at }
    },
  }
  async readSnapshot(workspaceId: string, item: VaultItem): Promise<PreflightSnapshot | null> {
    const [payload, renditions, content, version] = await Promise.all([
      this.db.from('vault_variant_payloads').select('payload').eq('workspace_id', workspaceId).eq('vault_item_id', item.id).maybeSingle(),
      this.db.from('vault_image_renditions').select('rights_expires_at,qc_expires_at').eq('workspace_id', workspaceId).eq('vault_item_id', item.id),
      this.db.from('content_items').select('title').eq('workspace_id', workspaceId).eq('id', item.contentId).maybeSingle(),
      this.db.from('content_versions').select('caption,hashtags').eq('workspace_id', workspaceId).eq('content_id', item.contentId).eq('id', item.versionId).maybeSingle(),
    ])
    if (payload.error || renditions.error || content.error || version.error || !payload.data || !content.data || !version.data) return null
    const data = payload.data.payload
    const settings = data?.settings
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !data.textBlockRenderSpec) return null
    const category = typeof settings.category === 'string' ? settings.category : (settings.category === null || settings.category === undefined) ? null : undefined
    const visibility = typeof settings.visibility === 'string' && settings.visibility ? settings.visibility : settings.visibility === undefined ? 'PUBLIC' : undefined
    const coupon = typeof settings.coupon === 'string' ? settings.coupon : (settings.coupon === null || settings.coupon === undefined) ? null : undefined
    if (category === undefined || visibility === undefined || coupon === undefined) return null
    const images = Array.isArray(data.media) ? data.media.filter((media: any) => media.type === 'image').map((media: any) => ({ position: media.position, renditionContentDigest: media.renditionContentDigest })) : []
    const fingerprintPayload: VaultFingerprintV3Input = {
      workspaceId, contentId: item.contentId, versionId: item.versionId, channel: item.channel,
      targetAccountId: settings.approved_target_account_id, title: data.title,
      textBlockRenderSpec: { channel: item.channel, blocks: [{ type: 'body', text: data.text }], digest: createHash('sha256').update(JSON.stringify(['body', item.channel, data.text])).digest('hex') },
      tags: data.hashtags, settings: { category, visibility, coupon }, images,
    }
    const state = (key: 'rights_expires_at' | 'qc_expires_at'): 'VALID' | 'EXPIRED' | 'UNKNOWN' => {
      if (images.length === 0) return 'VALID'
      if (!renditions.data || renditions.data.length !== images.length) return 'UNKNOWN'
      if (renditions.data.some((r: any) => !r[key] || !Number.isFinite(Date.parse(r[key])))) return 'UNKNOWN'
      return renditions.data.some((r: any) => Date.parse(r[key]) <= Date.now()) ? 'EXPIRED' : 'VALID'
    }
    const versions = settings.approved_policy_versions
    return {
      fingerprint: item.fingerprintSchemaVersion === 3 ? { fingerprintSchemaVersion: 3, payload: fingerprintPayload } : null,
      validUntil: typeof settings.valid_until === 'string' ? settings.valid_until : settings.valid_until === null ? null : 'invalid',
      imageRights: state('rights_expires_at'), imageQc: state('qc_expires_at'),
      policyChanges: versions && typeof versions === 'object' && !Array.isArray(versions)
        ? [{ policyId: 'channel-spec', version: CURRENT_SPEC_VERSION, approvalSensitive: true, channel: item.channel }, { policyId: 'vault-save', version: item.policyVersion, approvalSensitive: true, channel: item.channel }]
        : null,
      approvedPolicyVersions: versions && typeof versions === 'object' && !Array.isArray(versions) ? versions : null,
      approvedAccountId: typeof settings.approved_target_account_id === 'string' ? settings.approved_target_account_id : null,
    }
  }
  async readConnectionHealth(workspaceId: string, channel: VaultItem['channel']): Promise<PreflightConnectionHealth | null> {
    if (channel !== 'instagram' && channel !== 'threads') return null
    const [credentials, receipts, connections] = await Promise.all([
      this.db.from('meta_channel_credentials').select('status,token_expires_at,granted_scopes,channel_connections(external_account_id,account_label)').eq('workspace_id', workspaceId).eq('provider', channel),
      this.db.from('channel_verification_runs').select('status,created_at,read_after_write_at').eq('workspace_id', workspaceId).eq('channel', channel).order('created_at', { ascending: false }),
      this.db.from('channel_connections').select('account_label,status,external_account_id').eq('workspace_id', workspaceId).eq('channel', channel).maybeSingle(),
    ])
    if (credentials.error || receipts.error) return null
    const row = credentials.data?.[0]
    const receipt = receipts.data?.[0]
    const required = channel === 'instagram' ? ['instagram_business_basic', 'instagram_business_content_publish'] : ['threads_basic', 'threads_content_publish']
    const verified = row && ['active', 'connected'].includes(row.status) && required.every(scope => row.granted_scopes?.includes(scope)) && receipt?.status === 'VERIFIED' && Date.parse(receipt.read_after_write_at || receipt.created_at) > Date.now() - 7 * 86_400_000
    const review = process.env.META_APP_REVIEW_STATUS?.toUpperCase()
    const accountLabel = (row?.channel_connections as any)?.account_label ?? connections?.data?.account_label ?? null
    const accountId = (row?.channel_connections as any)?.external_account_id ?? connections?.data?.external_account_id ?? null
    return { connection: !row ? 'DISCONNECTED' : row.token_expires_at && Date.parse(row.token_expires_at) <= Date.now() ? 'EXPIRED' : verified ? 'VERIFIED' : 'DISCONNECTED', tokenExpiresAt: row?.token_expires_at ?? null, providerReview: review === 'APPROVED' || review === 'PENDING' || review === 'REJECTED' ? review : 'UNKNOWN', accountId, accountLabel }
  }
}
