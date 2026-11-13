import type { SupabaseClient } from '@supabase/supabase-js'

export type ReportingDatasetMode = 'ACTUAL' | 'EXCLUDED' | 'UNKNOWN'

/** Operator-only metadata: call with a server client after workspace authorization. */
export async function readWorkspaceDataset(client: SupabaseClient | undefined, workspaceId: string): Promise<{
  mode: ReportingDatasetMode
  state: 'OBSERVED' | 'NOT_OBSERVED' | 'ERROR'
}> {
  if (!client) return { mode: 'UNKNOWN', state: 'NOT_OBSERVED' }
  try {
    const { data, error } = await client.from('workspace_registry').select('workspace_id,dataset_mode')
      .eq('workspace_id', workspaceId).maybeSingle()
    if (error || (data && data.workspace_id !== workspaceId)) return { mode: 'UNKNOWN', state: 'ERROR' }
    if (data?.dataset_mode === 'ACTUAL') return { mode: 'ACTUAL', state: 'OBSERVED' }
    if (['TEST', 'CANARY', 'SHOWCASE_DEMO'].includes(data?.dataset_mode)) return { mode: 'EXCLUDED', state: 'NOT_OBSERVED' }
    return { mode: 'UNKNOWN', state: 'NOT_OBSERVED' }
  } catch {
    return { mode: 'UNKNOWN', state: 'ERROR' }
  }
}
