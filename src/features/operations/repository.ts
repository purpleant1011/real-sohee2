import { z } from 'zod'
import { operationEventSchema } from './event-schema'
import type {
  OperationEvent,
  ServerSupabaseClient,
  WorkItem,
  WorkItemPage,
  WorkItemStatus,
} from './types'

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const workItemStatusSchema = z.enum([
  'idea',
  'researching',
  'drafting',
  'review_required',
  'revision_requested',
  'revising',
  'approved',
  'schedule_required',
  'scheduled',
  'publishing',
  'published',
  'blocked',
  'publish_failed',
  'recovery_required',
  'cancelled',
  'archived',
])
const workItemRowSchema = z
  .object({
    id: uuidSchema,
    workspace_id: uuidSchema,
    type: z.enum([
      'content',
      'customer_followup',
      'knowledge_review',
      'recovery',
      'campaign',
      'report_review',
    ]),
    title: z.string().min(1).max(200),
    summary: z.string().max(4_000).nullable(),
    status: workItemStatusSchema,
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
    owner_type: z.enum(['sohee', 'user', 'shared']),
    owner_user_id: uuidSchema.nullable(),
    due_at: timestampSchema.nullable(),
    source_thread_id: uuidSchema.nullable(),
    source_message_id: uuidSchema.nullable(),
    content_item_id: uuidSchema.nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict()

const workItemFields =
  'id, workspace_id, type, title, summary, status, priority, owner_type, owner_user_id, due_at, source_thread_id, source_message_id, content_item_id, created_at, updated_at' as const

function mapWorkItem(row: z.infer<typeof workItemRowSchema>): WorkItem {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    status: row.status,
    priority: row.priority,
    ownerType: row.owner_type,
    ownerUserId: row.owner_user_id,
    dueAt: row.due_at,
    sourceThreadId: row.source_thread_id,
    sourceMessageId: row.source_message_id,
    contentItemId: row.content_item_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

export async function listWorkItems(input: {
  client: ServerSupabaseClient
  workspaceId: string
  statuses: readonly WorkItemStatus[]
  limit: number
}): Promise<WorkItemPage> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const statuses = z.array(workItemStatusSchema).min(1).max(16).parse(input.statuses)
  const limit = z.number().int().min(1).max(100).parse(input.limit)

  const listQuery = input.client
    .from('work_items')
    .select(workItemFields)
    .eq('workspace_id', workspaceId)
    .in('status', statuses)
    .order('updated_at', { ascending: false })
    .limit(limit)
  const countQuery = input.client
    .from('work_items')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('status', statuses)

  const [listResult, countResult] = await Promise.all([listQuery, countQuery])
  const rows = z.array(workItemRowSchema).safeParse(listResult.data)
  if (
    listResult.error ||
    countResult.error ||
    !rows.success ||
    typeof countResult.count !== 'number' ||
    rows.data.some((row) => row.workspace_id !== workspaceId)
  ) {
    throw new Error('work_items_unavailable')
  }

  return Object.freeze({
    items: Object.freeze(rows.data.map(mapWorkItem)),
    total: countResult.count,
  })
}

export async function listOperationEvents(input: {
  client: ServerSupabaseClient
  workspaceId: string
  limit: number
}): Promise<readonly OperationEvent[]> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const limit = z.number().int().min(1).max(100).parse(input.limit)
  const result = await input.client
    .from('operation_events')
    .select('id, workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at')
    .eq('workspace_id', workspaceId)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (result.error || !Array.isArray(result.data)) throw new Error('operation_events_unavailable')
  const events = result.data.map((row) =>
    operationEventSchema.safeParse({
      id: row.id,
      workspaceId: row.workspace_id,
      type: row.event_type,
      eventKey: row.event_key,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      payload: row.payload,
      occurredAt: row.occurred_at,
    }),
  )
  if (events.some((event) => !event.success)) throw new Error('operation_event_invalid')

  return Object.freeze(
    events.map((event) => Object.freeze((event as { success: true; data: OperationEvent }).data)),
  )
}
