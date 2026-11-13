import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { supportedChannels } from '@/features/channels/channel-capabilities'
import { urlCollectionStates, type UrlCollectionState } from './url-source-schema'

type QueryResult = Promise<{ data: unknown; error: unknown }>

export type UrlSourceListGateway = Readonly<{
  list(workspaceId: string): QueryResult
}>

export type UrlSourceListItem = Readonly<{
  id: string
  channel: (typeof supportedChannels)[number]
  ownership: 'owned' | 'reference'
  allowedUse: 'business_facts' | 'pattern_only'
  requestedScope: 'profile' | 'posts' | 'business_facts'
  url: string
  collectionState: UrlCollectionState
  lastCheckedAt: string | null
  safeFailureReason: string | null
}>

const uuidSchema = z.string().uuid()
const stateSchema = z.enum(urlCollectionStates)
const rowSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  channel_type: z.enum(supportedChannels),
  uri: z.string().url(),
  refresh_policy: z.object({
    ownership: z.enum(['owned', 'reference']),
    allowedUse: z.enum(['business_facts', 'pattern_only']),
    requestedScope: z.enum(['profile', 'posts', 'business_facts']),
    collectionState: stateSchema,
  }).passthrough(),
  last_checked_at: z.string().datetime({ offset: true }).nullable(),
  error_code: z.string().max(120).nullable(),
}).strict()

function failure(): ActionResult<readonly UrlSourceListItem[]> {
  return { error: { message: '주소 출처를 불러오지 못했습니다.', requestId: 'knowledge-url-source-list' } }
}

async function createGateway(): Promise<UrlSourceListGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  return {
    async list(workspaceId) {
      return supabase
        .from('knowledge_sources')
        .select('id, workspace_id, channel_type, uri, refresh_policy, last_checked_at, error_code')
        .eq('workspace_id', workspaceId)
        .eq('source_type', 'url')
        .order('updated_at', { ascending: false })
        .limit(100)
    },
  }
}

export async function listUrlSources(
  workspaceId: string,
  providedGateway?: UrlSourceListGateway,
): Promise<ActionResult<readonly UrlSourceListItem[]>> {
  if (!uuidSchema.safeParse(workspaceId).success) return failure()
  try {
    const gateway = providedGateway ?? await createGateway()
    const result = await gateway.list(workspaceId)
    const rows = z.array(rowSchema).safeParse(result.data)
    if (result.error || !rows.success || rows.data.some((row) => row.workspace_id !== workspaceId)) return failure()
    return {
      data: rows.data.map((row) => ({
        id: row.id,
        channel: row.channel_type,
        ownership: row.refresh_policy.ownership,
        allowedUse: row.refresh_policy.allowedUse,
        requestedScope: row.refresh_policy.requestedScope,
        url: row.uri,
        collectionState: row.refresh_policy.collectionState,
        lastCheckedAt: row.last_checked_at,
        safeFailureReason: row.error_code,
      })),
    }
  } catch {
    return failure()
  }
}
