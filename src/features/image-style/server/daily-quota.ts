import { createAdminSupabaseClient } from '@/lib/supabase/admin'

/** 작업공간당 24시간 사용 횟수(audit_events 기록 기준). */
export async function usedInLastDay(workspaceId: string, eventType: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const result = await createAdminSupabaseClient()
    .from('audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('event_type', eventType)
    .gte('created_at', since)
  return result.count ?? 0
}

export async function recordUsage(workspaceId: string, userId: string, eventType: string, entityType = 'workspace_image_style'): Promise<void> {
  await createAdminSupabaseClient().from('audit_events').insert({
    workspace_id: workspaceId,
    actor_id: userId,
    event_type: eventType,
    entity_type: entityType,
    metadata: {},
  })
}
