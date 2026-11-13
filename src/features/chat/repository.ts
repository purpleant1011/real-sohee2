import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import {
  contentInterviewViewFromUsageMetadata,
  usageMetadataSchema,
} from './content-interview-repository'
import type { ConversationMessage } from './types'
import { restoreTaskTimeline } from './task-timeline'
import { compareConversationMessages } from './message-order'

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const messageRowSchema = z
  .object({
    id: uuidSchema,
    client_message_id: uuidSchema.nullable().optional(),
    workspace_id: uuidSchema,
    thread_id: uuidSchema,
    role: z.enum(['user', 'sohee', 'system_event']),
    content: z.string().min(1).max(20_000),
    status: z.enum(['queued', 'streaming', 'completed', 'failed', 'cancelled']),
    work_item_id: uuidSchema.nullable(),
    artifact_type: z.enum(['media_asset']).nullable().optional(),
    artifact_id: uuidSchema.nullable().optional(),
    message_artifacts: z.array(z.object({ artifact_id: uuidSchema }).strict()).optional(),
    usage_metadata: usageMetadataSchema.optional(),
    created_at: timestampSchema,
    completed_at: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    if (Boolean(row.artifact_type) !== Boolean(row.artifact_id)) {
      context.addIssue({ code: 'custom', message: 'conversation_message_artifact_invalid' })
    }
  })

const messageFields =
  'id, client_message_id, workspace_id, thread_id, role, content, status, work_item_id, artifact_type, artifact_id, usage_metadata, created_at, completed_at, message_artifacts(artifact_id)' as const

function mapMessage(row: z.infer<typeof messageRowSchema>): ConversationMessage {
  const clarification = contentInterviewViewFromUsageMetadata(row.usage_metadata)
  const taskTimeline = row.role === 'sohee' ? restoreTaskTimeline(row.usage_metadata?.soheeTaskTimeline, row.status) : null
  return Object.freeze({
    ...(taskTimeline ? { taskTimeline } : {}),
    id: row.id,
    ...(row.client_message_id ? { clientMessageId: row.client_message_id } : {}),
    workspaceId: row.workspace_id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content,
    status: row.status,
    workItemId: row.work_item_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    ...(clarification ? { clarification } : {}),
    ...(row.artifact_type === 'media_asset' && row.artifact_id
      ? { artifact: { type: row.artifact_type, id: row.artifact_id } }
      : {}),
    ...(row.message_artifacts?.length
      ? {
          artifacts: Object.freeze(row.message_artifacts.map((artifact) => Object.freeze({
            type: 'conversation_artifact' as const,
            id: artifact.artifact_id,
          }))),
        }
      : {}),
  })
}

function parseMessage(
  value: unknown,
  workspaceId: string,
  threadId: string,
): ConversationMessage {
  const parsed = messageRowSchema.safeParse(value)
  if (
    !parsed.success ||
    parsed.data.workspace_id !== workspaceId ||
    parsed.data.thread_id !== threadId
  ) {
    throw new Error('conversation_message_invalid')
  }
  return mapMessage(parsed.data)
}

export async function listConversationMessages(input: {
  client: ServerSupabaseClient
  workspaceId: string
  threadId: string
  before?: string
  limit: number
}): Promise<readonly ConversationMessage[]> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const threadId = uuidSchema.parse(input.threadId)
  const limit = z.number().int().min(1).max(100).parse(input.limit)
  const before = input.before === undefined ? undefined : timestampSchema.parse(input.before)

  let query = input.client
    .from('messages')
    .select(messageFields)
    .eq('workspace_id', workspaceId)
    .eq('thread_id', threadId)

  if (before !== undefined) query = query.lt('created_at', before)

  const result = await query.order('created_at', { ascending: false }).limit(limit)
  const rows = z.array(messageRowSchema).safeParse(result.data)
  if (result.error || !rows.success) throw new Error('conversation_messages_unavailable')
  if (
    rows.data.some(
      (row) => row.workspace_id !== workspaceId || row.thread_id !== threadId,
    )
  ) {
    throw new Error('conversation_message_workspace_mismatch')
  }

  const messages = rows.data.map(mapMessage).sort((left, right) => compareConversationMessages(right, left))
  const marked = messages.filter(message => message.role === 'sohee' && message.status === 'completed'
    && message.taskTimeline?.steps.some(step => step.status === 'completed' && step.capabilityId))
  if (!marked.length) return Object.freeze(messages)
  const messageIds = marked.map(message => message.id)
  try {
    const { loadConversationInteractionDrafts } = await import('./interaction-draft-results.server')
    const drafts = await loadConversationInteractionDrafts({ client: input.client, workspaceId, threadId, messageIds })
    return Object.freeze(messages.map(message => {
      if (!messageIds.includes(message.id)) return message
      const restored = drafts.get(message.id)
      return Object.freeze({ ...message, ...(restored?.length ? { interactionDrafts: restored } : { interactionDraftsUnavailable: true }) })
    }))
  } catch {
    return Object.freeze(messages.map(message => messageIds.includes(message.id)
      ? Object.freeze({ ...message, interactionDraftsUnavailable: true }) : message))
  }
}

export async function upsertConversationUserMessage(input: {
  client: ServerSupabaseClient
  workspaceId: string
  threadId: string
  clientMessageId: string
  userId: string
  content: string
}): Promise<Readonly<{ message: ConversationMessage; created: boolean }>> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const threadId = uuidSchema.parse(input.threadId)
  const clientMessageId = uuidSchema.parse(input.clientMessageId)
  const userId = uuidSchema.parse(input.userId)
  const content = z.string().trim().min(1).max(20_000).parse(input.content)

  const inserted = await input.client
    .from('messages')
    .upsert(
      {
        workspace_id: workspaceId,
        thread_id: threadId,
        client_message_id: clientMessageId,
        role: 'user',
        content,
        status: 'completed',
        completed_at: new Date().toISOString(),
        created_by_user_id: userId,
      },
      { ignoreDuplicates: true, onConflict: 'workspace_id,client_message_id' },
    )
    .select(messageFields)
    .maybeSingle()

  if (inserted.error) throw new Error('conversation_message_create_failed')
  if (inserted.data) {
    return Object.freeze({
      message: parseMessage(inserted.data, workspaceId, threadId),
      created: true,
    })
  }

  const existing = await input.client
    .from('messages')
    .select(messageFields)
    .eq('workspace_id', workspaceId)
    .eq('client_message_id', clientMessageId)
    .maybeSingle()

  if (existing.error || !existing.data) throw new Error('conversation_message_create_failed')
  return Object.freeze({
    message: parseMessage(existing.data, workspaceId, threadId),
    created: false,
  })
}

export async function createConversationMessage(
  input: Parameters<typeof upsertConversationUserMessage>[0],
): Promise<ConversationMessage> {
  return (await upsertConversationUserMessage(input)).message
}
