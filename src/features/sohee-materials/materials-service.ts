import type { MaterialItem, MaterialStatus, WorkspaceMaterialsResult } from './types'

export interface MaterialsClientDeps {
  from(table: string): any
}

function mapMaterialStatus(rawStatus: string | null | undefined): MaterialStatus {
  const status = String(rawStatus ?? '').trim().toLowerCase()
  switch (status) {
    case 'uploading':
    case 'checking':
    case 'registered':
    case 'collection_pending':
    case 'processing':
      return 'received'
    case 'review_required':
    case 'conflict':
      return 'needs_review'
    case 'approved':
      return 'learned'
    default:
      // failed, rejected, paused, archived, refresh_required, disabled, unknown
      return 'attention'
  }
}

export async function listWorkspaceMaterials(
  workspaceId: string,
  client?: MaterialsClientDeps,
): Promise<WorkspaceMaterialsResult> {
  const supabase =
    client ??
    ((await import('@/lib/supabase/admin')).createAdminSupabaseClient() as unknown as MaterialsClientDeps)

  const [itemsRes, sourcesRes] = await Promise.all([
    supabase
      .from('knowledge_items')
      .select('id, name, status, created_at, evidence')
      .eq('workspace_id', workspaceId)
      .limit(100),
    supabase
      .from('knowledge_sources')
      .select('id, display_name, source_type, status, created_at')
      .eq('workspace_id', workspaceId)
      .limit(100),
  ])

  if (itemsRes.error || !Array.isArray(itemsRes.data)) {
    throw new Error(`KNOWLEDGE_ITEMS_QUERY_FAILED: ${itemsRes.error?.message || 'no row list'}`)
  }

  if (sourcesRes.error || !Array.isArray(sourcesRes.data)) {
    throw new Error(`KNOWLEDGE_SOURCES_QUERY_FAILED: ${sourcesRes.error?.message || 'no row list'}`)
  }

  const items: MaterialItem[] = []

  for (const item of itemsRes.data) {
    const rawSuggestions = (item.evidence as any)?.suggestions
    const suggestionsCount = Array.isArray(rawSuggestions)
      ? rawSuggestions.length
      : item.evidence !== undefined
        ? 0
        : undefined

    items.push({
      id: item.id,
      source: 'item',
      name: item.name,
      kind: 'file',
      status: mapMaterialStatus(item.status),
      createdAt: item.created_at,
      ...(suggestionsCount !== undefined ? { suggestionsCount } : {}),
    })
  }

  for (const src of sourcesRes.data) {
    if (src.display_name === '소희 인터뷰') {
      continue
    }
    items.push({
      id: src.id,
      source: 'source',
      name: src.display_name,
      kind: src.source_type === 'url' ? 'url' : 'file',
      status: mapMaterialStatus(src.status),
      createdAt: src.created_at,
    })
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const learnedCount = items.filter((item) => item.status === 'learned').length

  return {
    items,
    learnedCount,
  }
}
