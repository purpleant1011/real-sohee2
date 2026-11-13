import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import type { Json } from '@/lib/supabase/database.types'
import type { TaskTimelineMessageArtifact } from './stream-events'
import { parseTaskTimeline } from './task-timeline'

export async function saveTaskTimeline(input: {
  client: ServerSupabaseClient; workspaceId: string; threadId: string; messageId: string; timeline: TaskTimelineMessageArtifact
}): Promise<void> {
  const workspaceId = z.string().uuid().parse(input.workspaceId)
  const threadId = z.string().uuid().parse(input.threadId)
  const messageId = z.string().uuid().parse(input.messageId)
  const timeline = parseTaskTimeline(input.timeline)
  if (!timeline) throw new Error('TASK_TIMELINE_INVALID')
  const result = await input.client.from('messages').select('status, usage_metadata')
    .eq('workspace_id', workspaceId).eq('thread_id', threadId).eq('id', messageId).eq('role', 'sohee').maybeSingle()
  const row = z.object({ status: z.enum(['streaming', 'completed', 'failed', 'cancelled']),
    usage_metadata: z.record(z.string(), z.unknown()) }).safeParse(result.data)
  // 종료 상태의 최종 스냅샷은 허용하되 진행 중 스냅샷이나 취소된 요청의 늦은 갱신은 덮어쓰지 않는다.
  if (result.error || !row.success || row.data.status === 'cancelled'
    || (row.data.status !== 'streaming' && timeline.isLive)) throw new Error('TASK_TIMELINE_UNAVAILABLE')
  const saved = await input.client.from('messages')
    .update({ usage_metadata: { ...row.data.usage_metadata, soheeTaskTimeline: timeline } as unknown as Json })
    .eq('workspace_id', workspaceId).eq('thread_id', threadId).eq('id', messageId).eq('role', 'sohee')
    .eq('status', row.data.status).eq('usage_metadata', JSON.stringify(row.data.usage_metadata)).select('id').maybeSingle()
  if (saved.error || saved.data?.id !== messageId) throw new Error('TASK_TIMELINE_SAVE_FAILED')
}
