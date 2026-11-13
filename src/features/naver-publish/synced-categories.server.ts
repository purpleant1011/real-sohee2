import 'server-only'

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { NaverCategory } from './types'

const naverCategoryItemSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(100),
  parentId: z.string().min(1).max(200).nullable(),
}).strict()

/**
 * Returns the synced Naver Blog categories for the given workspace.
 * Reads the latest synced list for any connected naver_blog browser channel connection.
 * If multiple connections exist, the most recently synced is preferred.
 * Drops invalid category rows rather than throwing.
 */
export async function getSyncedNaverCategories(
  workspaceId: string,
  client?: SupabaseClient<any>,
): Promise<NaverCategory[]> {
  const supabase = client ?? (await createServerSupabaseClient())

  const { data: connections, error: connError } = await supabase
    .from('browser_channel_connections')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'naver_blog')
    .eq('status', 'connected')

  if (connError || !connections || connections.length === 0) {
    return []
  }

  const connectionIds = connections.map((c: { id: string }) => c.id)

  const { data: records, error: catError } = await (supabase as any)
    .from('naver_blog_categories')
    .select('categories, synced_at')
    .eq('workspace_id', workspaceId)
    .in('browser_channel_connection_id', connectionIds)
    .order('synced_at', { ascending: false })
    .limit(1)

  if (catError || !records || records.length === 0) {
    return []
  }

  const raw = records[0]?.categories
  if (!Array.isArray(raw)) {
    return []
  }

  const result: NaverCategory[] = []
  for (const item of raw) {
    const parsed = naverCategoryItemSchema.safeParse(item)
    if (parsed.success) {
      result.push(parsed.data)
    }
  }

  return result
}
