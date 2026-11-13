import 'server-only'

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getSoheeReadiness } from '@/features/sohee-ready/read-model'
import type { SoheeReadinessSnapshot } from '@/features/sohee-ready/types'
import { partitionCohort, type CohortWorkspaceInput, type EventAt, type RegistryRow, type SourceCount } from './funnel'
import { COHORT_CONFIG } from './config'
import { countOpenComplaintsByWorkspace } from '@/features/feedback/repository'

type Client = { from(table: string): any }
type Rows = { workspace_id: string; [k: string]: unknown }[]

export type CohortLoad =
  | { status: 'ERROR' }
  | { status: 'OK'; inputs: CohortWorkspaceInput[]; unclassified: number; totalConfirmed: boolean }

/** 소스 하나가 실패하면 그 소스만 undefined(알 수 없음)로 남긴다. 실패를 0/없음으로 바꾸지 않는다. */
async function readRows(run: () => Promise<{ data: unknown; error: unknown }>): Promise<Rows | undefined> {
  try {
    const result = await run()
    // PostgREST caps each response at 1000 rows; a full page cannot prove completeness.
    return result.error || !Array.isArray(result.data) || result.data.length >= 1000 ? undefined : (result.data as Rows)
  } catch {
    return undefined
  }
}

function firstAtByWorkspace(rows: Rows | undefined, ids: readonly string[], column: string): Map<string, EventAt> {
  const map = new Map<string, EventAt>()
  for (const id of ids) map.set(id, rows === undefined ? undefined : null)
  if (rows === undefined) return map
  for (const row of rows) {
    const at = row[column]
    if (typeof at !== 'string') continue
    const current = map.get(row.workspace_id)
    if (current === null || (typeof current === 'string' && at < current)) map.set(row.workspace_id, at)
  }
  return map
}

function countByWorkspace(rows: Rows | undefined, ids: readonly string[]): Map<string, SourceCount> {
  const map = new Map<string, SourceCount>()
  for (const id of ids) map.set(id, rows === undefined ? undefined : 0)
  if (rows === undefined) return map
  for (const row of rows) map.set(row.workspace_id, ((map.get(row.workspace_id) as number | undefined) ?? 0) + 1)
  return map
}

export async function loadCohort(client: Client = createAdminSupabaseClient() as unknown as Client): Promise<CohortLoad> {
  let registry: RegistryRow[]
  try {
    const result = await client.from('workspace_registry')
      .select('workspace_id,display_name,dataset_mode,actor_kind,created_at')
      .eq('dataset_mode', 'ACTUAL').order('created_at', { ascending: true }).limit(COHORT_CONFIG.MAX_COHORT + 1)
    if (result.error || !Array.isArray(result.data)) return { status: 'ERROR' }
    registry = result.data as RegistryRow[]
  } catch {
    return { status: 'ERROR' }
  }
  const { included, unclassified, totalConfirmed } = partitionCohort(registry)
  const ids = included.map((r) => r.workspace_id)
  if (ids.length === 0) return { status: 'OK', inputs: [], unclassified, totalConfirmed }

  const [vaults, recheck, published, reactions, channels, complaints] = await Promise.all([
    readRows(() => client.from('vault_items').select('workspace_id,created_at').in('workspace_id', ids).is('deleted_at', null)),
    readRows(() => client.from('vault_items').select('workspace_id').in('workspace_id', ids).is('deleted_at', null).in('approval_state', ['NEEDS_REAPPROVAL', 'INVALIDATED'])),
    readRows(() => client.from('publish_attempts').select('workspace_id,finished_at').in('workspace_id', ids).eq('status', 'succeeded')),
    readRows(() => client.from('channel_metric_values').select('workspace_id,created_at').in('workspace_id', ids).eq('state', 'available').gt('value', 0)),
    readRows(() => client.from('channel_connections').select('workspace_id').in('workspace_id', ids).eq('status', 'error')),
    countOpenComplaintsByWorkspace(client, ids),
  ])
  const firstVault = firstAtByWorkspace(vaults, ids, 'created_at')
  const firstPublish = firstAtByWorkspace(published, ids, 'finished_at')
  const firstReaction = firstAtByWorkspace(reactions, ids, 'created_at')
  const recheckCount = countByWorkspace(recheck, ids)
  const channelCount = countByWorkspace(channels, ids)

  const inputs = await Promise.all(included.map(async (row): Promise<CohortWorkspaceInput> => {
    let snapshot: SoheeReadinessSnapshot | null = null
    try {
      snapshot = await getSoheeReadiness(row.workspace_id, { adminClient: client as never })
    } catch {
      snapshot = null
    }
    return {
      workspaceId: row.workspace_id,
      name: row.display_name,
      createdAt: row.created_at,
      snapshot,
      firstVaultAt: firstVault.get(row.workspace_id),
      firstPublishAt: firstPublish.get(row.workspace_id),
      firstReactionAt: firstReaction.get(row.workspace_id),
      vaultRecheckCount: recheckCount.get(row.workspace_id),
      channelProblemCount: channelCount.get(row.workspace_id),
      complaintCount: complaints?.get(row.workspace_id),
    }
  }))
  return { status: 'OK', inputs, unclassified, totalConfirmed }
}
