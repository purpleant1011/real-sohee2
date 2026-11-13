import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'

const uuid = z.string().uuid()
const scope = z.object({ workspaceId: uuid, threadId: uuid, assistantMessageId: uuid, clientMessageId: uuid })
const base = z.object({ id: uuid, workspace_id: uuid, thread_id: uuid })
const assistantSchema = base.extend({ role: z.literal('sohee'), status: z.enum(['failed', 'cancelled']), reply_to_message_id: uuid, error_code: z.string().nullable() })
const userSchema = base.extend({ role: z.literal('user'), client_message_id: uuid,
  usage_metadata: z.object({ attachmentIds: z.array(uuid).max(20).optional() }).passthrough().nullable() })
const jobSchema = base.extend({ assistant_message_id: uuid, user_message_id: uuid, status: z.literal('needs_attention'),
  safe_error_code: z.enum(['CONVERSATION_CONTEXT_UNAVAILABLE', 'CREDIT_STATE_UNAVAILABLE']), worker_id: uuid })

/** The authenticated route owns admission. This service read never treats a failed bubble as zero effects. */
export async function prepareConversationRetry(input: {
  client: ServerSupabaseClient; workspaceId: string; threadId: string; assistantMessageId: string; clientMessageId: string
}): Promise<{ attachmentIds: string[] }> {
  const ids = scope.parse(input)
  const refuse = (): never => { throw new Error('CHAT_RETRY_RECONCILIATION_REQUIRED') }
  const assistant = await input.client.from('messages').select('id,workspace_id,thread_id,role,status,reply_to_message_id,error_code')
    .eq('workspace_id', ids.workspaceId).eq('thread_id', ids.threadId).eq('id', ids.assistantMessageId).eq('role', 'sohee').maybeSingle()
  const message = assistantSchema.safeParse(assistant.data)
  if (assistant.error || !message.success || message.data.id !== ids.assistantMessageId || message.data.workspace_id !== ids.workspaceId
    || message.data.thread_id !== ids.threadId || /UNKNOWN/u.test(message.data.error_code ?? '')) return refuse()
  const original = await input.client.from('messages').select('id,workspace_id,thread_id,role,client_message_id,usage_metadata')
    .eq('workspace_id', ids.workspaceId).eq('thread_id', ids.threadId).eq('id', message.data.reply_to_message_id).eq('role', 'user').maybeSingle()
  const user = userSchema.safeParse(original.data)
  if (original.error || !user.success || user.data.id !== message.data.reply_to_message_id || user.data.workspace_id !== ids.workspaceId
    || user.data.thread_id !== ids.threadId || user.data.client_message_id !== ids.clientMessageId) return refuse()
  const origin = await input.client.from('conversation_jobs')
    .select('id,workspace_id,thread_id,assistant_message_id,user_message_id,status,safe_error_code,worker_id')
    .eq('workspace_id', ids.workspaceId).eq('thread_id', ids.threadId).eq('assistant_message_id', ids.assistantMessageId).maybeSingle()
  if (origin.error) return refuse()
  if (origin.data !== null) {
    const job = jobSchema.safeParse(origin.data)
    if (!job.success || job.data.workspace_id !== ids.workspaceId || job.data.thread_id !== ids.threadId
      || job.data.assistant_message_id !== ids.assistantMessageId || job.data.user_message_id !== user.data.id) return refuse()
    // The RPC rechecks released credit, zero steps and zero usage under the native job lock.
    const proof = await input.client.rpc('resolve_unstarted_conversation_job_attention', {
      p_workspace_id: ids.workspaceId, p_job_id: job.data.id, p_worker_id: job.data.worker_id,
    })
    if (proof.error || proof.data !== true) return refuse()
  }
  const unresolved = await input.client.from('conversation_jobs').select('id')
    .eq('workspace_id', ids.workspaceId).eq('thread_id', ids.threadId).eq('status', 'needs_attention')
    .is('attention_resolved_at', null).limit(1)
  if (unresolved.error || !Array.isArray(unresolved.data) || unresolved.data.length) return refuse()
  return { attachmentIds: [...(user.data.usage_metadata?.attachmentIds ?? [])] }
}
