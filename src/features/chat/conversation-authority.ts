import { z } from 'zod'
import { workspaceRoleSchema } from '@/features/auth/workspace-context'
import type { ConversationJob } from './jobs/types'

interface Query {
  eq(column: string, value: unknown): Query
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>
}
export interface ConversationAuthorityDatabase { from(table: string): { select(columns: string): Query } }
const uuid = z.string().uuid()
const scopeSchema = z.object({ workspaceId: uuid, userId: uuid, threadId: uuid })
const memberSchema = z.object({ role: workspaceRoleSchema, status: z.literal('active') })
const threadSchema = z.object({ id: uuid, workspace_id: uuid, status: z.literal('active') })
const jobSchema = z.object({ id: uuid, workspace_id: uuid, thread_id: uuid, user_message_id: uuid, assistant_message_id: uuid, worker_id: uuid, status: z.literal('running') })

export async function loadConversationActor(db: ConversationAuthorityDatabase, input: z.infer<typeof scopeSchema>) {
  const scope = scopeSchema.safeParse(input)
  if (!scope.success) return null
  try {
    const [membership, thread] = await Promise.all([
      db.from('workspace_members').select('role, status').eq('workspace_id', input.workspaceId).eq('user_id', input.userId).eq('status', 'active').maybeSingle(),
      db.from('conversation_threads').select('id, workspace_id, status').eq('workspace_id', input.workspaceId).eq('id', input.threadId).eq('status', 'active').maybeSingle(),
    ])
    const member = memberSchema.safeParse(membership.data)
    const owned = threadSchema.safeParse(thread.data)
    if (membership.error || thread.error || !member.success || !owned.success
      || owned.data.id !== input.threadId || owned.data.workspace_id !== input.workspaceId) return null
    return { workspaceId: input.workspaceId, userId: input.userId, role: member.data.role }
  } catch { return null }
}

/** A running status alone is not a worker lease. Never acquire another claim here. */
export async function isPreparedConversationOwned(db: ConversationAuthorityDatabase, job: ConversationJob): Promise<boolean> {
  if (!uuid.safeParse(job.workerId).success) return false
  try {
    const result = await db.from('conversation_jobs').select('id, workspace_id, thread_id, user_message_id, assistant_message_id, worker_id, status')
      .eq('workspace_id', job.workspaceId).eq('id', job.id).eq('worker_id', job.workerId).maybeSingle()
    const parsed = jobSchema.safeParse(result.data)
    return !result.error && parsed.success && parsed.data.id === job.id && parsed.data.workspace_id === job.workspaceId
      && parsed.data.thread_id === job.threadId && parsed.data.user_message_id === job.userMessageId
      && parsed.data.assistant_message_id === job.assistantMessageId && parsed.data.worker_id === job.workerId
  } catch { return false }
}
