import { z } from 'zod'
import type { Json } from '@/lib/supabase/database.types'
import type { ServerSupabaseClient } from '@/features/operations/types'
import {
  contentInterviewView,
  parseContentInterviewState,
  safeParseContentInterviewState,
  type ContentInterviewState,
} from './content-interview'

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })

export type ContentInterviewUsageMetadata = Readonly<{
  soheeConversationInterview: ContentInterviewState
}>

export const usageMetadataSchema = z.object({
  soheeConversationInterview: z.unknown().optional(),
}).passthrough()

const interviewMessageRowSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema,
  thread_id: uuidSchema,
  role: z.literal('sohee'),
  reply_to_message_id: uuidSchema.nullable(),
  status: z.enum(['queued', 'streaming', 'completed', 'failed', 'cancelled']),
  usage_metadata: usageMetadataSchema.optional(),
  created_at: timestampSchema,
}).strict()

const interviewMessageFields =
  'id, workspace_id, thread_id, role, reply_to_message_id, status, usage_metadata, created_at' as const

export function contentInterviewViewFromUsageMetadata(
  value: unknown,
) {
  const metadata = usageMetadataSchema.safeParse(value)
  if (!metadata.success || metadata.data.soheeConversationInterview === undefined) return undefined

  const state = safeParseContentInterviewState(metadata.data.soheeConversationInterview)
  return state.success ? contentInterviewView(state.data) : undefined
}

export function validateContentInterviewUsageMetadata(
  value: unknown,
): ContentInterviewUsageMetadata {
  const metadata = z.object({
    soheeConversationInterview: z.unknown(),
  }).strict().parse(value)
  const state = parseContentInterviewState(metadata.soheeConversationInterview)
  return { soheeConversationInterview: state }
}

export function terminalCancelledContentInterviewState(
  state: ContentInterviewState,
): ContentInterviewState {
  return Object.freeze({ ...state, status: 'cancelled' as const }) as ContentInterviewState
}

export async function findLatestContentInterview(input: {
  client: ServerSupabaseClient
  workspaceId: string
  threadId: string
}): Promise<Readonly<{
  messageId: string
  userMessageId: string | null
  state: ContentInterviewState
}> | null> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const threadId = uuidSchema.parse(input.threadId)
  const result = await input.client
    .from('messages')
    .select(interviewMessageFields)
    .eq('workspace_id', workspaceId)
    .eq('thread_id', threadId)
    .eq('role', 'sohee')
    .in('status', ['completed', 'streaming'])
    .contains('usage_metadata', { soheeConversationInterview: { kind: 'content_interview' } })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (result.error) throw new Error('content_interview_unavailable')
  if (!result.data) return null

  const row = interviewMessageRowSchema.safeParse(result.data)
  if (!row.success
    || row.data.workspace_id !== workspaceId
    || row.data.thread_id !== threadId
    || !['completed', 'streaming'].includes(row.data.status)) {
    return null
  }

  const stateValue = row.data.usage_metadata?.soheeConversationInterview
  const state = safeParseContentInterviewState(stateValue)
  if (!state.success || state.data.status !== 'collecting') return null

  return Object.freeze({
    messageId: row.data.id,
    userMessageId: row.data.reply_to_message_id,
    state: state.data,
  })
}

export async function findLatestReadyContentInterview(input: {
  client: ServerSupabaseClient
  workspaceId: string
  threadId: string
}): Promise<Readonly<{
  messageId: string
  userMessageId: string | null
  state: ContentInterviewState
}> | null> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const threadId = uuidSchema.parse(input.threadId)
  const result = await input.client
    .from('messages')
    .select(interviewMessageFields)
    .eq('workspace_id', workspaceId)
    .eq('thread_id', threadId)
    .eq('role', 'sohee')
    .in('status', ['completed', 'streaming'])
    .contains('usage_metadata', { soheeConversationInterview: { status: 'ready_to_generate' } })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (result.error) throw new Error('content_interview_unavailable')
  if (!result.data) return null
  const row = interviewMessageRowSchema.safeParse(result.data)
  if (
    !row.success
    || row.data.workspace_id !== workspaceId
    || row.data.thread_id !== threadId
    || !['completed', 'streaming'].includes(row.data.status)
  ) return null
  const state = safeParseContentInterviewState(row.data.usage_metadata?.soheeConversationInterview)
  if (!state.success || state.data.status !== 'ready_to_generate') return null
  return Object.freeze({ messageId: row.data.id, userMessageId: row.data.reply_to_message_id, state: state.data })
}

export async function completeContentInterview(input: {
  client: ServerSupabaseClient
  workspaceId: string
  messageId: string
}): Promise<ContentInterviewState | null> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const messageId = uuidSchema.parse(input.messageId)
  const current = await input.client
    .from('messages')
    .select(interviewMessageFields)
    .eq('workspace_id', workspaceId)
    .eq('id', messageId)
    .eq('role', 'sohee')
    .maybeSingle()
  if (current.error) throw new Error('content_interview_unavailable')
  if (!current.data) return null
  const row = interviewMessageRowSchema.safeParse(current.data)
  if (!row.success || row.data.workspace_id !== workspaceId || row.data.id !== messageId) return null
  const state = safeParseContentInterviewState(row.data.usage_metadata?.soheeConversationInterview)
  if (!state.success || state.data.status !== 'ready_to_generate') return null
  const completed = Object.freeze({ ...state.data, status: 'completed' as const })
  const metadata = { ...(row.data.usage_metadata ?? {}), soheeConversationInterview: completed }
  const updated = await input.client
    .from('messages')
    .update({ usage_metadata: metadata as unknown as Json })
    .eq('workspace_id', workspaceId)
    .eq('id', messageId)
    .eq('role', 'sohee')
    .eq('usage_metadata', JSON.stringify(row.data.usage_metadata ?? {}))
    .select('id')
    .maybeSingle()
  if (updated.error || updated.data?.id !== messageId) throw new Error('content_interview_complete_failed')
  return completed
}

export async function retireContentInterview(input: {
  client: ServerSupabaseClient
  workspaceId: string
  messageId: string
}): Promise<boolean> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const messageId = uuidSchema.parse(input.messageId)
  const current = await input.client
    .from('messages')
    .select(interviewMessageFields)
    .eq('workspace_id', workspaceId)
    .eq('id', messageId)
    .eq('role', 'sohee')
    .maybeSingle()
  if (current.error) throw new Error('content_interview_unavailable')
  if (!current.data) return false
  const row = interviewMessageRowSchema.safeParse(current.data)
  if (!row.success || row.data.workspace_id !== workspaceId || row.data.id !== messageId) return false
  const state = safeParseContentInterviewState(row.data.usage_metadata?.soheeConversationInterview)
  if (!state.success || !['collecting', 'ready_to_generate'].includes(state.data.status)) return false
  const { soheeConversationInterview: _retired, ...metadata } = row.data.usage_metadata ?? {}
  void _retired
  const updated = await input.client
    .from('messages')
    .update({ usage_metadata: metadata as unknown as Json })
    .eq('workspace_id', workspaceId)
    .eq('id', messageId)
    .eq('role', 'sohee')
    .eq('usage_metadata', JSON.stringify(row.data.usage_metadata ?? {}))
    .select('id')
    .maybeSingle()
  if (updated.error || updated.data?.id !== messageId) throw new Error('content_interview_retire_failed')
  return true
}

export async function findContentInterviewByMessage(input: {
  client: ServerSupabaseClient
  workspaceId: string
  messageId: string
}): Promise<Readonly<{
  messageId: string
  userMessageId: string | null
  state: ContentInterviewState
}> | null> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const messageId = uuidSchema.parse(input.messageId)
  const result = await input.client
    .from('messages')
    .select(interviewMessageFields)
    .eq('workspace_id', workspaceId)
    .eq('id', messageId)
    .eq('role', 'sohee')
    .maybeSingle()

  if (result.error) throw new Error('content_interview_unavailable')
  if (!result.data) return null
  const row = interviewMessageRowSchema.safeParse(result.data)
  if (!row.success || row.data.workspace_id !== workspaceId || row.data.id !== messageId) return null
  const state = safeParseContentInterviewState(row.data.usage_metadata?.soheeConversationInterview)
  if (!state.success || state.data.status !== 'ready_to_generate') return null
  return Object.freeze({ messageId: row.data.id, userMessageId: row.data.reply_to_message_id, state: state.data })
}

export async function validateContentInterviewAttachments(input: {
  client: ServerSupabaseClient
  workspaceId: string
  attachmentIds: readonly string[]
}): Promise<readonly string[]> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const attachmentIds = input.attachmentIds.map((id) => uuidSchema.parse(id))
  if (attachmentIds.length === 0) return Object.freeze([])
  const result = await input.client
    .from('media_assets')
    .select('id, workspace_id, bucket_id, kind, rights_status')
    .eq('workspace_id', workspaceId)
    .eq('bucket_id', 'content-media')
    .eq('kind', 'content')
    .eq('rights_status', 'confirmed')
    .in('id', attachmentIds)
    .limit(attachmentIds.length)
  if (result.error || !Array.isArray(result.data)) throw new Error('content_interview_attachment_unavailable')
  const allowed = new Set(result.data.map((row) => row.id))
  if (allowed.size !== attachmentIds.length || attachmentIds.some((id) => !allowed.has(id))) {
    throw new Error('content_interview_attachment_forbidden')
  }
  return Object.freeze([...attachmentIds])
}

export async function cancelContentInterview(input: {
  client: ServerSupabaseClient
  workspaceId: string
  messageId: string
}): Promise<ContentInterviewState | null> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const messageId = uuidSchema.parse(input.messageId)
  const current = await input.client
    .from('messages')
    .select(interviewMessageFields)
    .eq('workspace_id', workspaceId)
    .eq('id', messageId)
    .eq('role', 'sohee')
    .maybeSingle()
  if (current.error) throw new Error('content_interview_unavailable')
  if (!current.data) return null
  const row = interviewMessageRowSchema.safeParse(current.data)
  if (!row.success || row.data.workspace_id !== workspaceId || row.data.id !== messageId) return null
  const state = safeParseContentInterviewState(row.data.usage_metadata?.soheeConversationInterview)
  if (!state.success || !['collecting', 'ready_to_generate'].includes(state.data.status)) return null
  const cancelled = terminalCancelledContentInterviewState(state.data)
  const metadata = {
    ...(row.data.usage_metadata ?? {}),
    soheeConversationInterview: cancelled,
  }
  const updated = await input.client
    .from('messages')
    .update({
      content: '응답 생성을 중단했습니다.',
      status: 'cancelled',
      error_code: 'CHAT_CANCELLED',
      completed_at: new Date().toISOString(),
      usage_metadata: metadata as unknown as Json,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', messageId)
    .eq('role', 'sohee')
    .eq('usage_metadata', JSON.stringify(row.data.usage_metadata ?? {}))
    .select('id')
    .maybeSingle()
  if (updated.error || updated.data?.id !== messageId) throw new Error('content_interview_cancel_failed')
  return cancelled
}
