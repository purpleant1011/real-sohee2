import { z } from 'zod'
import type { WorkspaceRole } from '@/features/auth/workspace-context'
import type { ServerSupabaseClient } from '@/features/operations/types'
import type { ConversationMessage } from './types'

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const threadSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  title: z.string().trim().min(1).max(120),
  status: z.enum(['active', 'archived']),
  last_message_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).strict()

const threadFields =
  'id, workspace_id, title, status, last_message_at, created_at, updated_at' as const

const startedMessageSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  thread_id: uuidSchema,
  role: z.literal('user'),
  content: z.string().trim().min(1).max(8_000),
  status: z.literal('completed'),
  work_item_id: uuidSchema.nullable(),
  created_at: timestampSchema,
  completed_at: timestampSchema,
}).passthrough()

const startConversationResultSchema = z.object({
  // The RPC returns to_jsonb(conversation_threads), including columns that are
  // intentionally omitted from list/detail projections. Validate the public
  // contract and strip those database-only fields before mapping the result.
  thread: threadSchema.strip(),
  user_message: startedMessageSchema,
}).strict()

export type ConversationThreadSummary = Readonly<{
  id: string
  workspaceId: string
  title: string
  status: 'active' | 'archived'
  lastMessageAt: string | null
  createdAt: string
  updatedAt: string
}>

export type ConversationThreadPage = Readonly<{
  items: readonly ConversationThreadSummary[]
  hasMore: boolean
}>

export type StartedConversation = Readonly<{
  thread: ConversationThreadSummary
  userMessage: ConversationMessage
}>

function mapThread(value: unknown, expectedWorkspaceId?: string): ConversationThreadSummary {
  const thread = threadSchema.parse(value)
  if (expectedWorkspaceId && thread.workspace_id !== expectedWorkspaceId) {
    throw new Error('conversation_thread_workspace_mismatch')
  }
  return Object.freeze({
    id: thread.id,
    workspaceId: thread.workspace_id,
    title: thread.title,
    status: thread.status,
    lastMessageAt: thread.last_message_at,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
  })
}

export async function listConversationThreads(input: {
  client: ServerSupabaseClient
  workspaceId: string
  page: number
  limit: number
}): Promise<ConversationThreadPage> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const page = z.number().int().min(0).max(10_000).parse(input.page)
  const limit = z.number().int().min(1).max(50).parse(input.limit)
  const offset = page * limit
  const result = await input.client.from('conversation_threads')
    .select(threadFields)
    .eq('workspace_id', workspaceId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit)
  const rows = z.array(threadSchema).safeParse(result.data)
  if (result.error || !rows.success) throw new Error('conversation_threads_unavailable')
  if (rows.data.some((row) => row.workspace_id !== workspaceId)) {
    throw new Error('conversation_thread_workspace_mismatch')
  }
  return Object.freeze({
    items: Object.freeze(rows.data.slice(0, limit).map((row) => mapThread(row, workspaceId))),
    hasMore: rows.data.length > limit,
  })
}

export async function createConversationThread(input: {
  client: ServerSupabaseClient
  workspaceId: string
  requestKey: string
}): Promise<ConversationThreadSummary> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const requestKey = uuidSchema.parse(input.requestKey)
  const createdAt = new Date().toISOString()
  const inserted = await input.client.from('conversation_threads').upsert({
    workspace_id: workspaceId,
    kind: 'operations',
    title: '새 대화',
    status: 'active',
    last_message_at: createdAt,
    creation_request_key: requestKey,
  }, { ignoreDuplicates: true, onConflict: 'workspace_id,creation_request_key' })
    .select(threadFields)
    .maybeSingle()
  if (inserted.error) throw new Error('conversation_thread_create_failed')
  if (inserted.data) return mapThread(inserted.data, workspaceId)

  const existing = await input.client.from('conversation_threads')
    .select(threadFields)
    .eq('workspace_id', workspaceId)
    .eq('creation_request_key', requestKey)
    .maybeSingle()
  if (existing.error || !existing.data) throw new Error('conversation_thread_create_failed')
  return mapThread(existing.data, workspaceId)
}

export async function startConversation(input: {
  client: ServerSupabaseClient
  workspaceId: string
  requestKey: string
  userId: string
  clientMessageId: string
  content: string
}): Promise<StartedConversation> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const requestKey = uuidSchema.parse(input.requestKey)
  const userId = uuidSchema.parse(input.userId)
  const clientMessageId = uuidSchema.parse(input.clientMessageId)
  const content = z.string().trim().min(1).max(8_000).parse(input.content)
  const result = await input.client.rpc('start_conversation_with_first_message', {
    p_client_message_id: clientMessageId,
    p_content: content,
    p_request_key: requestKey,
    p_user_id: userId,
    p_workspace_id: workspaceId,
  })
  const parsed = startConversationResultSchema.safeParse(result.data)
  if (result.error || !parsed.success) throw new Error('conversation_start_failed')
  if (
    parsed.data.thread.workspace_id !== workspaceId
    || parsed.data.user_message.workspace_id !== workspaceId
    || parsed.data.user_message.thread_id !== parsed.data.thread.id
  ) throw new Error('conversation_start_workspace_mismatch')

  const message = parsed.data.user_message
  return Object.freeze({
    thread: mapThread(parsed.data.thread, workspaceId),
    userMessage: Object.freeze({
      id: message.id,
      workspaceId: message.workspace_id,
      threadId: message.thread_id,
      role: message.role,
      content: message.content,
      status: message.status,
      workItemId: message.work_item_id,
      createdAt: message.created_at,
      completedAt: message.completed_at,
    }),
  })
}

async function updateConversationThreadStatus(input: {
  client: ServerSupabaseClient
  workspaceId: string
  threadId: string
  from: 'active' | 'archived'
  status: 'active' | 'archived'
}): Promise<ConversationThreadSummary> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const threadId = uuidSchema.parse(input.threadId)
  const result = await input.client.from('conversation_threads')
    .update({ status: input.status })
    .eq('workspace_id', workspaceId)
    .eq('id', threadId)
    .eq('status', input.from)
    .select(threadFields)
    .maybeSingle()
  if (result.error || !result.data) throw new Error('conversation_thread_update_failed')
  return mapThread(result.data, workspaceId)
}

export function archiveConversationThread(input: {
  client: ServerSupabaseClient
  workspaceId: string
  threadId: string
}) {
  return updateConversationThreadStatus({ ...input, from: 'active', status: 'archived' })
}

export function restoreConversationThread(input: {
  client: ServerSupabaseClient
  workspaceId: string
  threadId: string
}) {
  return updateConversationThreadStatus({ ...input, from: 'archived', status: 'active' })
}

export async function getOrCreateOperationsThread(input: {
  client: ServerSupabaseClient
  workspaceId: string
  role: WorkspaceRole
}): Promise<ConversationThreadSummary | null> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const existing = await input.client.from('conversation_threads')
    .select(threadFields)
    .eq('workspace_id', workspaceId)
    .eq('kind', 'operations')
    .eq('status', 'active')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing.error) throw new Error('conversation_thread_unavailable')
  if (existing.data) return mapThread(existing.data, workspaceId)
  if (input.role === 'viewer') return null

  const inserted = await input.client.from('conversation_threads').insert({
    workspace_id: workspaceId,
    kind: 'operations',
    title: '기본 운영 대화',
    status: 'active',
    last_message_at: new Date().toISOString(),
  }).select(threadFields).single()
  if (inserted.error || !inserted.data) throw new Error('conversation_thread_create_failed')
  return mapThread(inserted.data, workspaceId)
}
