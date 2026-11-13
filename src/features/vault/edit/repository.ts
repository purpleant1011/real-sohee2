import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { VaultItem, VaultVariantPayload } from '../types'
import type { EditMutation, VaultEditRepository } from './index'

type Row = Record<string, any>
const fields = 'id,workspace_id,content_id,version_id,channel,release_gate,hold_reason,held_at,held_by,target_date,approved_fingerprint,fingerprint_schema_version,policy_version,spec_version,approval_state,approved_by,bundle_id,idempotency_key,deleted_at,created_at,updated_at'
const mapItem = (r: Row): VaultItem => ({ id: r.id, workspaceId: r.workspace_id, contentId: r.content_id, versionId: r.version_id, channel: r.channel, releaseGate: r.release_gate, holdReason: r.hold_reason, heldAt: r.held_at, heldBy: r.held_by, targetDate: r.target_date, approvedFingerprint: r.approved_fingerprint, fingerprintSchemaVersion: r.fingerprint_schema_version, policyVersion: r.policy_version, specVersion: r.spec_version, approvalState: r.approval_state, approvedBy: r.approved_by, bundleId: r.bundle_id, idempotencyKey: r.idempotency_key, deletedAt: r.deleted_at, createdAt: r.created_at, updatedAt: r.updated_at })
const mapPayload = (r: Row): VaultVariantPayload => ({ id: r.id, workspaceId: r.workspace_id, vaultItemId: r.vault_item_id, payload: r.payload, previewArtifacts: r.preview_artifacts, createdAt: r.created_at, updatedAt: r.updated_at })
function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Vault edit persistence failed: ${result.error.message}`)
  return result.data
}
export class SupabaseVaultEditRepository implements VaultEditRepository {
  private readonly db: any
  constructor(client: Pick<SupabaseClient, 'from' | 'rpc'>) { this.db = client }
  async getItem(workspaceId: string, id: string): Promise<VaultItem | null> {
    const row = checked(await this.db.from('vault_items').select(fields).eq('workspace_id', workspaceId).eq('id', id).maybeSingle())
    return row ? mapItem(row as Row) : null
  }
  async getPayload(workspaceId: string, id: string): Promise<VaultVariantPayload | null> {
    const row = checked(await this.db.from('vault_variant_payloads').select('*').eq('workspace_id', workspaceId).eq('vault_item_id', id).maybeSingle())
    return row ? mapPayload(row as Row) : null
  }
  async listImageCandidates(workspaceId: string): Promise<readonly VaultItem[]> {
    const rows = checked(await this.db.from('vault_items').select(fields).eq('workspace_id', workspaceId).is('deleted_at', null))
    return (rows as Row[]).map(mapItem)
  }
  async changeMany(workspaceId: string, mutations: readonly EditMutation[]): Promise<Record<string, string> | null> {
    const serialized = []
    for (const { item, expectedVersion, actorId, changes, payload, event } of mutations) {
      const existing = payload ? await this.getPayload(workspaceId, item.id) : null
      if (payload && !existing) return null
      serialized.push({ id: item.id, expected_updated_at: expectedVersion, actor_id: actorId, changes: {
        ...('targetDate' in changes ? { target_date: changes.targetDate } : {}), ...('releaseGate' in changes ? { release_gate: changes.releaseGate } : {}),
        ...('holdReason' in changes ? { hold_reason: changes.holdReason } : {}), ...('heldAt' in changes ? { held_at: changes.heldAt } : {}),
        ...('heldBy' in changes ? { held_by: changes.heldBy } : {}), ...('approvedFingerprint' in changes ? { approved_fingerprint: changes.approvedFingerprint } : {}),
        ...('fingerprintSchemaVersion' in changes ? { fingerprint_schema_version: changes.fingerprintSchemaVersion } : {}),
        ...('approvalState' in changes ? { approval_state: changes.approvalState } : {}), ...('approvedBy' in changes ? { approved_by: changes.approvedBy } : {}),
        ...('policyVersion' in changes ? { policy_version: changes.policyVersion } : {}), ...('specVersion' in changes ? { spec_version: changes.specVersion } : {}),
        ...('deletedAt' in changes ? { deleted_at: changes.deletedAt } : {}),
      }, payload, expected_payload: existing?.payload ?? null, event_type: event.eventType, event_payload: event.payload })
    }
    const versions: unknown = checked(await this.db.rpc('vault_apply_edits', { p_workspace_id: workspaceId, p_mutations: serialized }))
    if (versions === null) return null
    if (!versions || typeof versions !== 'object' || Array.isArray(versions) || mutations.some(({ item }) => typeof (versions as Record<string, unknown>)[item.id] !== 'string')) throw new Error('Vault edit persistence returned an invalid version')
    return versions as Record<string, string>
  }
}
