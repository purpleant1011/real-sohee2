import 'server-only'
import type { AuthorizedQuickContext } from '@/features/quick-start/route-auth'
import type { CatalogActor } from './catalog-service'
import { createSupabaseCatalogGateway } from './supabase-gateway'
import { createApprovedFactWriter } from './fact-writer'

/** Wires the authenticated request context to the catalog gateway and the existing Fact flow. */
export function createCatalogActor(auth: AuthorizedQuickContext): CatalogActor {
  return {
    gateway: createSupabaseCatalogGateway(auth.admin),
    facts: createApprovedFactWriter(auth.userId),
    workspaceId: auth.workspaceId,
    role: auth.role,
  }
}
