import type { CatalogGateway } from './catalog-service'

/**
 * Supabase adapter for the catalog gateway. Every query is scoped by workspace id,
 * and the update is additionally guarded by the version the caller read (`updated_at`).
 */

const COLUMNS =
  'id, workspace_id, name, price, duration_minutes, resource_name, cancellation_policy, valid_from, valid_until, active, updated_at, knowledge_fact_id'

export function createSupabaseCatalogGateway(client: any): CatalogGateway {
  return {
    async list(workspaceId) {
      const { data, error } = await client
        .from('workspace_products_services')
        .select(COLUMNS)
        .eq('workspace_id', workspaceId)
        .order('name', { ascending: true })
      return { data, error }
    },

    async find(workspaceId, serviceId) {
      const { data, error } = await client
        .from('workspace_products_services')
        .select(COLUMNS)
        .eq('workspace_id', workspaceId)
        .eq('id', serviceId)
        .maybeSingle()
      return { data, error }
    },

    async insert(payload) {
      const { data, error } = await client
        .from('workspace_products_services')
        .insert(payload)
        .select(COLUMNS)
        .single()
      return { data, error }
    },

    async update(workspaceId, serviceId, expectedUpdatedAt, patch) {
      const { data, error } = await client
        .from('workspace_products_services')
        .update(patch)
        .eq('workspace_id', workspaceId)
        .eq('id', serviceId)
        .eq('updated_at', expectedUpdatedAt)
        .select(COLUMNS)
        .maybeSingle()
      if (!error && !data) return { data: null, error: { code: 'CATALOG_CONFLICT' } }
      return { data, error }
    },

    async setFactLink(workspaceId, serviceId, expectedUpdatedAt, knowledgeFactId) {
      // `updated_at` is deliberately absent: it is the catalog version booking slots are bound to, so
      // writing the link must not invalidate them. The guard is the version the content write returned.
      const { data, error } = await client
        .from('workspace_products_services')
        .update({ knowledge_fact_id: knowledgeFactId })
        .eq('workspace_id', workspaceId)
        .eq('id', serviceId)
        .eq('updated_at', expectedUpdatedAt)
        .select(COLUMNS)
        .maybeSingle()
      if (!error && !data) return { data: null, error: { code: 'CATALOG_CONFLICT' } }
      return { data, error }
    },

    async countStaleSlots(workspaceId, serviceId, catalogVersion) {
      const { count, error } = await client
        .from('booking_recovery_slots')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('service_id', serviceId)
        .eq('status', 'AVAILABLE')
        .neq('catalog_version', catalogVersion)
      return { count: typeof count === 'number' ? count : null, error }
    },
  }
}
