import 'server-only'

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { SameTruthGateway } from './read-model'

/** Supabase service-role client is only created on the server, after operator authorization at the route. */
export function createSameTruthGateway(client?: { from(table: string): any; rpc(name: string, args: Record<string, unknown>): Promise<any> }): SameTruthGateway {
  const getClient = (): { from(table: string): any; rpc(name: string, args: Record<string, unknown>): Promise<any> } =>
    client ?? (createAdminSupabaseClient() as unknown as { from(table: string): any; rpc(name: string, args: Record<string, unknown>): Promise<any> })
  return {
    async readRegistry(ids) {
      if (!ids.length) return []
      const result = await getClient().from('workspace_registry')
        .select('workspace_id,dataset_mode,actor_kind').in('workspace_id', ids)
      if (result.error || !Array.isArray(result.data)) throw new Error('REGISTRY_UNAVAILABLE')
      return result.data
    },
    async countVault(ids) {
      if (!ids.length) return 0
      const result = await getClient().rpc('count_admin_actual_vault_items', { p_workspace_ids: ids })
      if (result.error || !Number.isSafeInteger(result.data) || result.data < 0) throw new Error('VAULT_COUNT_UNAVAILABLE')
      return result.data
    },
  }
}
