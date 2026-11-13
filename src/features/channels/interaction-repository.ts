import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'

type Gateway = Readonly<{
  rpc(name: string, args: { p_workspace_id: string }): Promise<{ data: unknown; error: unknown }>
}>

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const row = z.object({
  event_id: uuid,
  provider: z.enum(['instagram', 'threads']),
  category: z.enum(['comment', 'reply', 'mention', 'dm']),
  occurred_at: timestamp,
  inbound_text: z.string().max(4000).nullable(),
  response_job_id: uuid.nullable(),
  response_kind: z.enum(['instagram_comment_reply', 'threads_reply', 'instagram_dm']).nullable(),
  response_text: z.string().max(2200).nullable(),
  response_status: z.enum(['needs_draft', 'draft', 'approved', 'sending', 'sent', 'failed', 'unknown', 'cancelled']).nullable(),
  response_approved_at: timestamp.nullable(),
  response_provider_reference: z.string().max(500).nullable(),
  delivery_status: z.enum(['pending', 'succeeded', 'failed', 'unknown']).nullable(),
  delivery_error_code: z.string().max(120).nullable(),
  content_id: uuid.nullable(),
  content_version_id: uuid.nullable(),
  content_title: z.string().max(200).nullable(),
  schedule_id: uuid.nullable(),
  publish_at: timestamp.nullable(),
  schedule_status: z.enum(['scheduled', 'publishing', 'published', 'failed', 'cancelled']).nullable(),
}).strict()

export type ChannelInteraction = Readonly<{
  id: string
  channel: 'instagram' | 'threads'
  category: 'comment' | 'reply' | 'mention' | 'dm'
  occurredAt: string
  inboundText: string
  responseJobId: string | null
  responseText: string | null
  responseStatus: z.infer<typeof row>['response_status']
  responseApprovedAt: string | null
  deliveryStatus: z.infer<typeof row>['delivery_status']
  deliveryErrorCode: string | null
  content: Readonly<{ id: string; versionId: string; title: string }> | null
  schedule: Readonly<{ id: string; publishAt: string; status: string }> | null
}>

async function productionGateway(): Promise<Gateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  return await createServerSupabaseClient() as unknown as Gateway
}

export async function listChannelInteractions(
  workspaceId: string,
  providedGateway?: Gateway,
): Promise<ActionResult<readonly ChannelInteraction[]>> {
  if (!uuid.safeParse(workspaceId).success) {
    return { error: { message: '채널 대화 요청을 확인해 주세요.', requestId: 'channel-interactions-input' } }
  }
  try {
    const gateway = providedGateway ?? await productionGateway()
    const result = await gateway.rpc('list_channel_interactions', { p_workspace_id: workspaceId })
    if (result.error) throw new Error('query')
    const parsed = z.array(row).max(100).safeParse(result.data)
    if (!parsed.success) throw new Error('shape')
    return { data: Object.freeze(parsed.data.map((item) => Object.freeze({
      id: item.event_id,
      channel: item.provider,
      category: item.category,
      occurredAt: item.occurred_at,
      inboundText: item.inbound_text ?? '(텍스트가 없는 이벤트)',
      responseJobId: item.response_job_id,
      responseText: item.response_text,
      responseStatus: item.response_status,
      responseApprovedAt: item.response_approved_at,
      deliveryStatus: item.delivery_status,
      deliveryErrorCode: item.delivery_error_code,
      content: item.content_id && item.content_version_id && item.content_title
        ? Object.freeze({ id: item.content_id, versionId: item.content_version_id, title: item.content_title })
        : null,
      schedule: item.schedule_id && item.publish_at && item.schedule_status
        ? Object.freeze({ id: item.schedule_id, publishAt: item.publish_at, status: item.schedule_status })
        : null,
    }))) }
  } catch {
    return { error: { message: '채널 대화를 불러오지 못했습니다.', requestId: 'channel-interactions' } }
  }
}
