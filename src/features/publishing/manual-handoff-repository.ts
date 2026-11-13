import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualHandoffEvent, ManualHandoffInput, ManualHandoffRepository } from './manual-handoff'

export function createManualHandoffRepository(admin: Pick<SupabaseClient, 'from'>): ManualHandoffRepository {
  return {
    async loadApprovedVersion(input: ManualHandoffInput) {
      const { data, error } = await admin.from('vault_items')
        .select('id,version_id,approved_fingerprint')
        .eq('workspace_id', input.workspaceId).eq('content_id', input.contentId)
        .eq('version_id', input.versionId).eq('channel', input.channel)
        .eq('approval_state', 'APPROVED').is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (error) throw new Error('MANUAL_HANDOFF_READ_FAILED')
      if (!data?.approved_fingerprint) return null
      return { itemId: data.id, versionId: data.version_id, fingerprint: data.approved_fingerprint }
    },
    async readEvent(workspaceId: string, id: string): Promise<ManualHandoffEvent | null> {
      const { data, error } = await admin.from('vault_events')
        .select('id,workspace_id,vault_item_id,actor_id,payload,occurred_at')
        .eq('workspace_id', workspaceId).eq('id', id).eq('event_type', 'vault.manual_handoff_confirmed').maybeSingle()
      if (error) throw new Error('MANUAL_HANDOFF_READ_FAILED')
      if (!data) return null
      const payload = data.payload as Record<string, unknown>
      if (payload.source !== 'OWNER_REPORTED' || payload.providerVerified !== false) throw new Error('MANUAL_HANDOFF_INVALID_SOURCE')
      return { id: data.id, workspaceId: data.workspace_id, itemId: data.vault_item_id,
        actorId: data.actor_id, versionId: String(payload.versionId ?? ''), fingerprint: String(payload.fingerprint ?? ''), occurredAt: data.occurred_at }
    },
    async putEvent(event: ManualHandoffEvent) {
      const { error } = await admin.from('vault_events').upsert({
        id: event.id, workspace_id: event.workspaceId, vault_item_id: event.itemId,
        actor_id: event.actorId, event_type: 'vault.manual_handoff_confirmed',
        payload: { versionId: event.versionId, fingerprint: event.fingerprint, source: 'OWNER_REPORTED', providerVerified: false },
      }, { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw new Error('MANUAL_HANDOFF_WRITE_FAILED')
    },
  }
}
