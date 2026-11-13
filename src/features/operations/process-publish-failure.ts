import 'server-only'

import { operationEventSchema } from './event-schema'
import { processOperationEvent } from './event-processor'
import { createSupabaseEventGateway } from './supabase-event-gateway'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function processPublishFailure(input: {
  workspaceId: string
  attemptId: string
  contentVersionId: string
  errorCode: string
}) {
  const client = createAdminSupabaseClient()
  const eventKey = `publish:${input.attemptId}:failed`
  const occurredAt = new Date().toISOString()
  const inserted = await client.from('operation_events').upsert({
    workspace_id: input.workspaceId,
    event_type: 'publish.failed',
    event_key: eventKey,
    subject_type: 'publish_attempt',
    subject_id: input.attemptId,
    payload: {
      attemptId: input.attemptId,
      contentVersionId: input.contentVersionId,
      errorCode: input.errorCode.trim().toLowerCase(),
    },
    occurred_at: occurredAt,
  }, { onConflict: 'workspace_id,event_key', ignoreDuplicates: true })
    .select('id, workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at')
    .maybeSingle()
  if (inserted.error) throw new Error('publish_failure_event_create_failed')

  const row = inserted.data ?? (await client.from('operation_events')
    .select('id, workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at')
    .eq('workspace_id', input.workspaceId)
    .eq('event_key', eventKey)
    .single()).data
  const event = operationEventSchema.parse({
    id: row?.id,
    workspaceId: row?.workspace_id,
    type: row?.event_type,
    eventKey: row?.event_key,
    subjectType: row?.subject_type,
    subjectId: row?.subject_id,
    payload: row?.payload,
    occurredAt: row?.occurred_at,
  })
  return processOperationEvent(event, createSupabaseEventGateway(client))
}
