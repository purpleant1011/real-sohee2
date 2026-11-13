import { z } from 'zod'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type {
  UrlSourceCollectionGateway,
  UrlSourceRecord,
} from './url-collection-runner'
import { supportedChannels, type SupportedChannel } from '@/features/channels/channel-capabilities'
import { urlCollectionStates, type UrlCollectionState } from './url-source-schema'

type QueryResult = Readonly<{ data: unknown; error: unknown }>
type AdminQuery = PromiseLike<QueryResult> & {
  select(columns: string): AdminQuery
  update(values: Record<string, unknown>): AdminQuery
  eq(column: string, value: string): AdminQuery
  maybeSingle(): Promise<QueryResult>
}
type AdminClient = Readonly<{ from(table: string): AdminQuery }>

const rowSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  channel_type: z.enum(supportedChannels),
  uri: z.string().url(),
  refresh_policy: z.object({
    ownership: z.enum(['owned', 'reference']),
    collectionState: z.enum(urlCollectionStates),
  }).passthrough(),
  last_checked_at: z.string().datetime({ offset: true }).nullable(),
  error_code: z.string().max(120).nullable(),
}).strict()

function toRecord(row: z.infer<typeof rowSchema>): UrlSourceRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    channel: row.channel_type as SupportedChannel,
    ownership: row.refresh_policy.ownership,
    url: row.uri,
    collectionState: row.refresh_policy.collectionState as UrlCollectionState,
    lastCheckedAt: row.last_checked_at ?? undefined,
    safeFailureReason: row.error_code ?? undefined,
  }
}

export function createAdminUrlSourceCollectionGateway(): UrlSourceCollectionGateway {
  const admin = createAdminSupabaseClient() as unknown as AdminClient
  return {
    async load(input) {
      const result = await admin
        .from('knowledge_sources')
        .select('id, workspace_id, channel_type, uri, refresh_policy, last_checked_at, error_code')
        .eq('workspace_id', input.workspaceId)
        .eq('id', input.sourceId)
        .eq('source_type', 'url')
        .maybeSingle()
      const parsed = rowSchema.safeParse(result.data)
      return result.error || !parsed.success ? null : toRecord(parsed.data)
    },
    async save(source) {
      const result = await admin
        .from('knowledge_sources')
        .update({
          status: source.collectionState === 'refresh_required' ? 'refresh_required' : 'registered',
          refresh_policy: {
            ownership: source.ownership,
            allowedUse: source.ownership === 'reference' ? 'pattern_only' : 'business_facts',
            requestedScope: 'business_facts',
            collectionState: source.collectionState,
          },
          last_checked_at: source.lastCheckedAt ?? new Date().toISOString(),
          error_code: source.safeFailureReason ?? null,
        })
        .eq('workspace_id', source.workspaceId)
        .eq('id', source.id)
      if (result.error) throw new Error('knowledge_url_source_save_failed')
      return source
    },
    async saveCandidates(input) {
      if (input.observations.length > 0) {
        throw new Error('knowledge_url_candidate_persistence_requires_review_adapter')
      }
    },
  }
}
