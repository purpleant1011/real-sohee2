import { z } from 'zod'
import type { Json } from '@/lib/supabase/database.types'
import type { ServerSupabaseClient } from '@/features/operations/types'
import type { MessageEvidenceView } from './stream-events'
import {
  contentInterviewViewFromUsageMetadata,
  usageMetadataSchema,
  validateContentInterviewUsageMetadata,
  type ContentInterviewUsageMetadata,
} from './content-interview-repository'
import type { ConversationMessage } from './types'
import { restoreTaskTimeline } from './task-timeline'

const uuidSchema = z.string().uuid()
const finalStatusSchema = z.enum(['completed', 'failed', 'cancelled'])
const timestampSchema = z.string().datetime({ offset: true })
const rowSchema = z.object({
  id: uuidSchema,
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
  created_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((row, context) => {
  if (Boolean(row.artifact_type) !== Boolean(row.artifact_id)) {
    context.addIssue({ code: 'custom', message: 'conversation_message_artifact_invalid' })
  }
})

const fields = 'id, workspace_id, thread_id, role, content, status, work_item_id, artifact_type, artifact_id, usage_metadata, created_at, completed_at, message_artifacts(artifact_id)' as const

function message(raw: unknown): ConversationMessage {
  const row = rowSchema.parse(raw)
  const clarification = contentInterviewViewFromUsageMetadata(row.usage_metadata)
  const taskTimeline = row.role === 'sohee' ? restoreTaskTimeline(row.usage_metadata?.soheeTaskTimeline, row.status) : null
  return Object.freeze({
    ...(taskTimeline ? { taskTimeline } : {}),
    id: row.id,
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

export async function findAssistantReply(input: {
  client: ServerSupabaseClient
  workspaceId: string
  threadId: string
  userMessageId: string
}): Promise<ConversationMessage | null> {
  const result = await input.client
    .from('messages')
    .select(fields)
    .eq('workspace_id', uuidSchema.parse(input.workspaceId))
    .eq('thread_id', uuidSchema.parse(input.threadId))
    .eq('reply_to_message_id', uuidSchema.parse(input.userMessageId))
    .eq('role', 'sohee')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (result.error) throw new Error('assistant_reply_unavailable')
  return result.data ? message(result.data) : null
}

export async function createAssistantMessage(input: {
  client: ServerSupabaseClient
  workspaceId: string
  threadId: string
  userMessageId: string
  model: string
  usageMetadata?: ContentInterviewUsageMetadata
}): Promise<ConversationMessage> {
  const usageMetadata = input.usageMetadata === undefined
    ? undefined
    : validateContentInterviewUsageMetadata(input.usageMetadata)
  const result = await input.client
    .from('messages')
    .insert({
      workspace_id: uuidSchema.parse(input.workspaceId),
      thread_id: uuidSchema.parse(input.threadId),
      reply_to_message_id: uuidSchema.parse(input.userMessageId),
      role: 'sohee',
      content: '응답을 준비하고 있습니다.',
      status: 'streaming',
      model_name: z.string().trim().min(1).max(120).parse(input.model),
      ...(usageMetadata ? { usage_metadata: usageMetadata as unknown as Json } : {}),
    })
    .select(fields)
    .single()

  if (result.error || !result.data) throw new Error('assistant_reply_create_failed')
  return message(result.data)
}

export async function createOrGetAssistantMessage(input: {
  client: ServerSupabaseClient
  workspaceId: string
  threadId: string
  userMessageId: string
  assistantMessageId: string
  model: string
  usageMetadata?: ContentInterviewUsageMetadata
}): Promise<Readonly<{ message: ConversationMessage; created: boolean }>> {
  const usageMetadata = input.usageMetadata === undefined
    ? undefined
    : validateContentInterviewUsageMetadata(input.usageMetadata)
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const threadId = uuidSchema.parse(input.threadId)
  const userMessageId = uuidSchema.parse(input.userMessageId)
  const assistantMessageId = uuidSchema.parse(input.assistantMessageId)
  const model = z.string().trim().min(1).max(120).parse(input.model)
  const result = await input.client
    .from('messages')
    .insert({
      id: assistantMessageId,
      workspace_id: workspaceId,
      thread_id: threadId,
      reply_to_message_id: userMessageId,
      role: 'sohee',
      content: '응답을 준비하고 있습니다.',
      status: 'streaming',
      model_name: model,
      ...(usageMetadata ? { usage_metadata: usageMetadata as unknown as Json } : {}),
    })
    .select(fields)
    .single()

  if (!result.error && result.data) {
    return Object.freeze({ message: message(result.data), created: true })
  }

  const existing = await input.client
    .from('messages')
    .select(fields)
    .eq('workspace_id', workspaceId)
    .eq('id', assistantMessageId)
    .eq('thread_id', threadId)
    .eq('reply_to_message_id', userMessageId)
    .eq('role', 'sohee')
    .maybeSingle()
  if (existing.error || !existing.data) throw new Error('assistant_reply_create_failed')
  return Object.freeze({ message: message(existing.data), created: false })
}

export async function finalizeAssistantMessage(input: {
  client: ServerSupabaseClient
  workspaceId: string
  messageId: string
  content: string
  status: 'completed' | 'failed' | 'cancelled'
  errorCode: string | null
  artifact?: Readonly<{ type: 'media_asset'; id: string }>
  usageMetadata?: ContentInterviewUsageMetadata
}): Promise<void> {
  const status = finalStatusSchema.parse(input.status)
  const content = z.string().trim().min(1).max(20_000).parse(input.content)
  const errorCode = input.errorCode === null
    ? null
    : z.string().trim().min(1).max(120).parse(input.errorCode)
  const usageMetadata = input.usageMetadata === undefined
    ? undefined
    : validateContentInterviewUsageMetadata(input.usageMetadata)
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const messageId = uuidSchema.parse(input.messageId)
  let currentUsageMetadata: z.infer<typeof usageMetadataSchema> | undefined
  let mergedUsageMetadata: z.infer<typeof usageMetadataSchema> | undefined

  if (usageMetadata) {
    const current = await input.client
      .from('messages')
      .select('usage_metadata')
      .eq('workspace_id', workspaceId)
      .eq('id', messageId)
      .eq('role', 'sohee')
      .eq('status', 'streaming')
      .maybeSingle()
    const parsedCurrent = z.object({ usage_metadata: usageMetadataSchema }).strict().safeParse(current.data)
    if (current.error || !parsedCurrent.success) {
      throw new Error('assistant_reply_finalize_failed')
    }
    currentUsageMetadata = parsedCurrent.data.usage_metadata
    mergedUsageMetadata = {
      ...currentUsageMetadata,
      soheeConversationInterview: usageMetadata.soheeConversationInterview,
    }
  }

  let updateQuery = input.client
    .from('messages')
    .update({
      content,
      status,
      error_code: errorCode,
      completed_at: new Date().toISOString(),
      ...(mergedUsageMetadata
        ? { usage_metadata: mergedUsageMetadata as unknown as Json }
        : {}),
      ...(input.artifact
        ? {
            artifact_type: input.artifact.type,
            artifact_id: uuidSchema.parse(input.artifact.id),
          }
        : {}),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', messageId)
    .eq('role', 'sohee')
    .eq('status', 'streaming')
  if (currentUsageMetadata) {
    updateQuery = updateQuery.eq('usage_metadata', JSON.stringify(currentUsageMetadata))
  }
  const result = await updateQuery.select('id').maybeSingle()

  if (result.error || result.data?.id !== input.messageId) {
    throw new Error('assistant_reply_finalize_failed')
  }
}

/**
 * Terminal fallback for workers that lost the optimistic streaming-row or
 * metadata equality race. The route only calls this after the normal
 * finalize path failed, so it deliberately scopes the update to the exact
 * workspace/message/role and does not require the row to still be streaming.
 */
export async function forceFinalizeAssistantMessage(input: {
  client: ServerSupabaseClient
  workspaceId: string
  messageId: string
  content: string
  status: 'completed' | 'failed' | 'cancelled'
  errorCode: string | null
  artifact?: Readonly<{ type: 'media_asset'; id: string }>
  usageMetadata?: ContentInterviewUsageMetadata
}): Promise<void> {
  const status = finalStatusSchema.parse(input.status)
  const content = z.string().trim().min(1).max(20_000).parse(input.content)
  const errorCode = input.errorCode === null
    ? null
    : z.string().trim().min(1).max(120).parse(input.errorCode)
  const usageMetadata = input.usageMetadata === undefined
    ? undefined
    : validateContentInterviewUsageMetadata(input.usageMetadata)
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const messageId = uuidSchema.parse(input.messageId)
  let mergedUsageMetadata: z.infer<typeof usageMetadataSchema> | undefined

  if (usageMetadata) {
    const current = await input.client
      .from('messages')
      .select('usage_metadata')
      .eq('workspace_id', workspaceId)
      .eq('id', messageId)
      .eq('role', 'sohee')
      .maybeSingle()
    if (current.error) throw new Error('assistant_reply_force_finalize_failed')
    const currentMetadata = current.data?.usage_metadata
    const parsedCurrent = currentMetadata === undefined
      ? { success: true as const, data: {} }
      : usageMetadataSchema.safeParse(currentMetadata)
    if (!parsedCurrent.success) throw new Error('assistant_reply_force_finalize_failed')
    mergedUsageMetadata = {
      ...parsedCurrent.data,
      soheeConversationInterview: usageMetadata.soheeConversationInterview,
    }
  }

  const result = await input.client
    .from('messages')
    .update({
      content,
      status,
      error_code: errorCode,
      completed_at: new Date().toISOString(),
      ...(mergedUsageMetadata ? { usage_metadata: mergedUsageMetadata as unknown as Json } : {}),
      ...(input.artifact
        ? {
            artifact_type: input.artifact.type,
            artifact_id: uuidSchema.parse(input.artifact.id),
          }
        : {}),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', messageId)
    .eq('role', 'sohee')
    .select('id')
    .maybeSingle()

  if (result.error || result.data?.id !== messageId) {
    throw new Error('assistant_reply_force_finalize_failed')
  }
}

export async function reconcileStaleAssistantMessages(input: {
  client: ServerSupabaseClient
  workspaceId: string
  threadId: string
  staleBefore?: string
}): Promise<void> {
  const staleBefore = input.staleBefore ?? new Date(Date.now() - 30 * 60_000).toISOString()
  const result = await input.client
    .from('messages')
    .update({
      content: '이전 응답 생성 작업이 중단됐습니다. 입력은 보존됐으며 다시 시도할 수 있습니다.',
      status: 'failed',
      error_code: 'CHAT_WORKER_INTERRUPTED',
      completed_at: new Date().toISOString(),
    })
    .eq('workspace_id', uuidSchema.parse(input.workspaceId))
    .eq('thread_id', uuidSchema.parse(input.threadId))
    .eq('role', 'sohee')
    .eq('status', 'streaming')
    .lt('created_at', timestampSchema.parse(staleBefore))

  if (result.error) throw new Error('stale_assistant_reconciliation_failed')
}

const evidenceType = {
  knowledge: 'knowledge',
  work: 'work_item',
  schedule: 'schedule',
  report: 'report',
  customer_conversation: 'customer_conversation',
  policy: 'policy',
} as const

export async function saveMessageEvidence(input: {
  client: ServerSupabaseClient
  workspaceId: string
  messageId: string
  evidence: MessageEvidenceView
}): Promise<void> {
  const result = await input.client.from('message_evidence').upsert({
    workspace_id: uuidSchema.parse(input.workspaceId),
    message_id: uuidSchema.parse(input.messageId),
    evidence_type: evidenceType[input.evidence.kind],
    evidence_id: uuidSchema.parse(input.evidence.id),
    label: z.string().trim().min(1).max(200).parse(input.evidence.title),
    source_uri: z.string().startsWith('/').max(500).parse(input.evidence.href),
  }, { onConflict: 'message_id,evidence_type,evidence_id', ignoreDuplicates: true })

  if (result.error) throw new Error('message_evidence_create_failed')
}
