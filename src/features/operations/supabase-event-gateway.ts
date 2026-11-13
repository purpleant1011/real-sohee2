import 'server-only'

import { z } from 'zod'
import type { ServerSupabaseClient } from './types'
import type { OperationEventGateway, ProcessedOperationEvent } from './event-processor'

const uuidSchema = z.string().uuid()

async function ownerOrManagerId(client: ServerSupabaseClient, workspaceId: string) {
  const result = await client.from('workspace_members').select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .in('role', ['owner', 'manager'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const userId = uuidSchema.safeParse(result.data?.user_id)
  if (result.error || !userId.success) throw new Error('operation_event_actor_unavailable')
  return userId.data
}

async function unreadCount(client: ServerSupabaseClient, workspaceId: string) {
  const result = await client.from('notifications').select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId).is('read_at', null)
  if (result.error || typeof result.count !== 'number') throw new Error('notification_count_unavailable')
  return result.count
}

export function createSupabaseEventGateway(client: ServerSupabaseClient): OperationEventGateway {
  return {
    async getProcessedResult(event): Promise<ProcessedOperationEvent | null> {
      const message = await client.from('messages')
        .select('id, thread_id')
        .eq('workspace_id', event.workspaceId)
        .contains('usage_metadata', { operationEventKey: event.eventKey })
        .limit(1)
        .maybeSingle()
      if (message.error) throw new Error('operation_report_unavailable')
      if (!message.data) return null

      const [work, notifications] = await Promise.all([
        client.from('work_items').select('id')
          .eq('workspace_id', event.workspaceId)
          .eq('source_message_id', message.data.id)
          .eq('type', 'recovery')
          .limit(1)
          .maybeSingle(),
        client.from('notifications').select('id')
          .eq('workspace_id', event.workspaceId)
          .eq('event_key', event.eventKey),
      ])
      if (work.error || notifications.error || !work.data || !Array.isArray(notifications.data)) return null

      return Object.freeze({
        eventKey: event.eventKey,
        threadId: uuidSchema.parse(message.data.thread_id),
        messageId: uuidSchema.parse(message.data.id),
        workItemId: uuidSchema.parse(work.data.id),
        notificationIds: Object.freeze(notifications.data.map((item) => uuidSchema.parse(item.id))),
        unreadCount: await unreadCount(client, event.workspaceId),
      })
    },
    async ensureConversationThread({ workspaceId }) {
      const existing = await client.from('conversation_threads').select('id')
        .eq('workspace_id', workspaceId).eq('kind', 'operations').eq('status', 'active')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1).maybeSingle()
      if (existing.error) throw new Error('operation_thread_unavailable')
      if (existing.data) return uuidSchema.parse(existing.data.id)

      const inserted = await client.from('conversation_threads').insert({
        workspace_id: workspaceId,
        kind: 'operations',
        title: '기본 운영 대화',
        status: 'active',
      }).select('id').single()
      if (inserted.error || !inserted.data) throw new Error('operation_thread_create_failed')
      return uuidSchema.parse(inserted.data.id)
    },
    async ensureSystemReport({ event, threadId, content }) {
      const existing = await client.from('messages').select('id')
        .eq('workspace_id', event.workspaceId)
        .contains('usage_metadata', { operationEventKey: event.eventKey })
        .limit(1).maybeSingle()
      if (existing.error) throw new Error('operation_report_unavailable')
      if (existing.data) return uuidSchema.parse(existing.data.id)

      const now = new Date().toISOString()
      const inserted = await client.from('messages').insert({
        workspace_id: event.workspaceId,
        thread_id: threadId,
        role: 'system_event',
        content,
        status: 'completed',
        model_name: 'operation-event-processor',
        usage_metadata: { operationEventKey: event.eventKey, operationEventId: event.id },
        completed_at: now,
      }).select('id').single()
      if (inserted.error || !inserted.data) throw new Error('operation_report_create_failed')
      return uuidSchema.parse(inserted.data.id)
    },
    async ensureRecoveryWork({ event, threadId, messageId }) {
      const existing = await client.from('work_items').select('id')
        .eq('workspace_id', event.workspaceId)
        .eq('source_message_id', messageId)
        .eq('type', 'recovery')
        .limit(1).maybeSingle()
      if (existing.error) throw new Error('recovery_work_unavailable')
      if (existing.data) return uuidSchema.parse(existing.data.id)

      const actorId = await ownerOrManagerId(client, event.workspaceId)
      const inserted = await client.from('work_items').insert({
        workspace_id: event.workspaceId,
        type: 'recovery',
        title: '게시 실패 복구 확인',
        summary: `안전 오류 코드 ${event.payload.errorCode}. 채널 연결과 승인 버전을 확인해 주세요.`,
        status: 'recovery_required',
        priority: 'urgent',
        owner_type: 'shared',
        source_thread_id: threadId,
        source_message_id: messageId,
        content_item_id: null,
        created_by: actorId,
      }).select('id').single()
      if (inserted.error || !inserted.data) throw new Error('recovery_work_create_failed')
      return uuidSchema.parse(inserted.data.id)
    },
    async ensureNotifications({ event, href, body }) {
      const members = await client.from('workspace_members').select('user_id')
        .eq('workspace_id', event.workspaceId).eq('status', 'active')
      if (members.error || !Array.isArray(members.data)) throw new Error('notification_recipients_unavailable')
      const recipientIds = members.data.map((member) => uuidSchema.parse(member.user_id))
      if (recipientIds.length === 0) return []

      const upserted = await client.from('notifications').upsert(
        recipientIds.map((userId) => ({
          workspace_id: event.workspaceId,
          user_id: userId,
          kind: 'publish',
          body,
          href,
          event_key: event.eventKey,
        })),
        { onConflict: 'workspace_id,user_id,event_key', ignoreDuplicates: true },
      )
      if (upserted.error) throw new Error('operation_notification_create_failed')
      const result = await client.from('notifications').select('id')
        .eq('workspace_id', event.workspaceId).eq('event_key', event.eventKey)
      if (result.error || !Array.isArray(result.data)) throw new Error('operation_notification_unavailable')
      return Object.freeze(result.data.map((item) => uuidSchema.parse(item.id)))
    },
    async countUnreadNotifications(workspaceId) {
      return unreadCount(client, workspaceId)
    },
    async saveProcessedResult(event, result) {
      const updated = await client.from('operation_events').update({ processed_at: new Date().toISOString() })
        .eq('workspace_id', event.workspaceId)
        .eq('event_key', result.eventKey)
      if (updated.error) throw new Error('operation_event_finalize_failed')
    },
  }
}
