import { PgVaultPreflightPorts } from '../../preflight/pg-ports'
import { runPreflight } from '../../preflight'
import { loadReadiness } from '@/features/readiness/load'
import type { ReleaseDependencies } from './release-service'
import type { VaultItem } from '../../types'
import { readInterventionState } from '@/features/admin/interventions/read-state'
import { recordVaultFunnelEvent } from '@/features/vault/funnel'
import { reevaluateReleaseGates } from '../../service/save'
import { SupabaseVaultSaveRepository } from '../../model/supabase-save-repository'

/** Server-only adapter. It never creates an external action or invokes a provider. */
export function createReleaseDependencies(admin: any, supabase: any): ReleaseDependencies {
  const ports = new PgVaultPreflightPorts(admin)
  const repository = new SupabaseVaultSaveRepository(admin)
  return {
    reevaluate: workspaceId => reevaluateReleaseGates(workspaceId, { repository }),
    async listItems(workspaceId) {
      const { data, error } = await admin.from('vault_items').select('id,workspace_id,channel,release_gate,deleted_at,approval_state').eq('workspace_id', workspaceId).is('deleted_at', null)
      if (error || !Array.isArray(data)) throw new Error('보관 목록을 가져오지 못했어요')
      return data.map((row: any) => ({ id: row.id, workspaceId: row.workspace_id, channel: row.channel, releaseGate: row.release_gate, deletedAt: row.deleted_at, approvalState: row.approval_state })) as VaultItem[]
    },
    readConnectionHealth: (workspaceId, channel) => ports.readConnectionHealth(workspaceId, channel),
    readInterventionState: (workspaceId, channel) => readInterventionState(admin, workspaceId, channel),
    async recordReleaseRequested(workspaceId, item, actorId) {
      const recorded = await recordVaultFunnelEvent({
        workspaceId,
        userId: actorId,
        event: 'release_requested',
        channel: item.channel,
        properties: { vaultItemId: item.id },
        dedupeKey: `release_requested:${item.id}`,
      }, { admin })
      if (!recorded.success) console.warn('[vault.release] request event needs reconciliation')
    },
    async readiness(workspaceId) { return (await loadReadiness(workspaceId, { supabaseClient: supabase })).stage },
    runPreflight: (workspaceId, itemId, actorId) => runPreflight(ports, { workspaceId, itemId, triggeredBy: actorId, now: new Date() }),
    async markRequested(workspaceId, itemId) {
      const safety = await readInterventionState(admin, workspaceId)
      if (safety.blocked) throw new Error(safety.label ?? '소희가 잠시 멈췄어요')
      const { data, error } = await admin.from('vault_items').update({ release_gate: 'RELEASE_REQUESTED', hold_reason: 'RELEASE_REQUESTED' })
        .eq('workspace_id', workspaceId).eq('id', itemId).in('release_gate', ['HELD_USER', 'HELD_PROVIDER_PENDING', 'HELD_CONNECTION_PENDING']).eq('approval_state', 'APPROVED').is('deleted_at', null).select('id').maybeSingle()
      if (error) throw new Error(error.message?.includes('SAFETY_INTERVENTION_BLOCKED') ? '소희가 잠시 멈췄어요' : '발행 요청 상태를 저장하지 못했어요')
      return Boolean(data)
    },
  }
}
