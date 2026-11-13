import 'server-only'
import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { parseInteractionDraftSnapshot, type InteractionDraftCardData } from '@/features/engagement/interaction-draft-contract'

const uuid = z.string().uuid()
const jobSchema = z.object({ id: uuid, workspace_id: uuid, thread_id: uuid, assistant_message_id: uuid, status: z.literal('succeeded') })
const stepSchema = z.object({ id: uuid, workspace_id: uuid, job_id: uuid,
  capability_id: z.enum(['comment.reply_draft', 'dm.reply_draft']), status: z.literal('completed'), output_payload: z.unknown() })

/** Result projection only: canonical domain drafts and existing job steps remain the owners. */
export async function loadConversationInteractionDrafts(input: {
  client: ServerSupabaseClient; workspaceId: string; threadId: string; messageIds: readonly string[]
}): Promise<ReadonlyMap<string, readonly InteractionDraftCardData[]>> {
  const workspaceId = uuid.parse(input.workspaceId)
  const threadId = uuid.parse(input.threadId)
  const messageIds = [...new Set(z.array(uuid).max(100).parse(input.messageIds))]
  const result = new Map<string, InteractionDraftCardData[]>()
  if (!messageIds.length) return result
  const jobs = await input.client.from('conversation_jobs').select('id,workspace_id,thread_id,assistant_message_id,status')
    .eq('workspace_id', workspaceId).eq('thread_id', threadId).eq('status', 'succeeded')
    .in('assistant_message_id', messageIds).limit(100)
  const parsedJobs = z.array(jobSchema).safeParse(jobs.data)
  if (jobs.error || !parsedJobs.success) throw new Error('CONVERSATION_DRAFT_RESULTS_UNAVAILABLE')
  if (parsedJobs.data.some(job => job.workspace_id !== workspaceId || job.thread_id !== threadId
    || !messageIds.includes(job.assistant_message_id))) throw new Error('CONVERSATION_DRAFT_RESULTS_SCOPE_MISMATCH')
  const messagesByJob = new Map(parsedJobs.data.map(job => [job.id, job.assistant_message_id]))
  if (!messagesByJob.size) return result
  const steps = await input.client.from('conversation_job_steps').select('id,workspace_id,job_id,capability_id,status,output_payload')
    .eq('workspace_id', workspaceId).eq('status', 'completed').in('job_id', [...messagesByJob.keys()])
    .in('capability_id', ['comment.reply_draft', 'dm.reply_draft']).order('step_index', { ascending: true }).limit(501)
  const parsedSteps = z.array(stepSchema).max(500).safeParse(steps.data)
  if (steps.error || !parsedSteps.success) throw new Error('CONVERSATION_DRAFT_RESULTS_UNAVAILABLE')
  for (const step of parsedSteps.data) {
    const messageId = messagesByJob.get(step.job_id)
    if (!messageId || step.workspace_id !== workspaceId) throw new Error('CONVERSATION_DRAFT_RESULTS_SCOPE_MISMATCH')
    const snapshot = parseInteractionDraftSnapshot(step.output_payload, workspaceId)
    if ((step.capability_id === 'dm.reply_draft') !== (snapshot.targetKind === 'dm')) throw new Error('CONVERSATION_DRAFT_RESULTS_SCOPE_MISMATCH')
    const drafts = result.get(messageId) ?? []
    drafts.push(Object.freeze({ id: step.id, ...snapshot }))
    result.set(messageId, drafts)
  }
  return result
}
