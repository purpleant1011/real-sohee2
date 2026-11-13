export const dynamic = 'force-dynamic';
import { z } from 'zod'
import { submitConversationJob } from '@/features/chat/jobs/submit'

type Context = Readonly<{ params: Promise<{ workspaceId: string; threadId: string }> }>
type Dependencies = Readonly<{
  authenticate(): Promise<string | null>
  authorize(input: { userId: string; workspaceId: string; threadId: string }): Promise<boolean>
  submit(input: { workspaceId: string; threadId: string; userId: string; request: unknown }): Promise<unknown>
}>

const uuid = z.string().uuid()
const queuedMessage = z.object({
  id: uuid,
  client_message_id: uuid.nullable().optional(),
  workspace_id: uuid,
  thread_id: uuid,
  role: z.enum(['user', 'sohee', 'system_event']),
  content: z.string(),
  status: z.enum(['queued', 'streaming', 'completed', 'failed', 'cancelled']),
  work_item_id: uuid.nullable(),
  created_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).nullable(),
}).passthrough()

function mapMessage(message: z.infer<typeof queuedMessage>) {
  return {
    id: message.id,
    ...(message.client_message_id ? { clientMessageId: message.client_message_id } : {}),
    workspaceId: message.workspace_id,
    threadId: message.thread_id,
    role: message.role,
    content: message.content,
    status: message.status,
    workItemId: message.work_item_id,
    createdAt: message.created_at,
    completedAt: message.completed_at,
  }
}

function error(status: number, code: string) {
  return Response.json({ error: { code } }, { status })
}

export function createConversationJobsPostHandler(dependencies: Dependencies) {
  return async function POST(request: Request, context: Context) {
    let body: unknown
    try { body = await request.json() } catch { return error(400, 'CONVERSATION_JOB_REQUEST_INVALID') }
    const params = await context.params
    const ids = z.object({ workspaceId: uuid, threadId: uuid }).safeParse(params)
    if (!ids.success) return error(400, 'CONVERSATION_JOB_REQUEST_INVALID')
    const userId = await dependencies.authenticate()
    if (!userId) return error(401, 'AUTH_REQUIRED')
    if (!await dependencies.authorize({ ...ids.data, userId })) return error(403, 'CHAT_THREAD_FORBIDDEN')
    try {
      const result = await dependencies.submit({ ...ids.data, userId, request: body })
      return Response.json({ data: result }, { status: 202, headers: { 'cache-control': 'private, no-store' } })
    } catch (caught) {
      const code = caught instanceof Error && caught.message === 'CONVERSATION_JOB_DISPATCH_FAILED'
        ? caught.message
        : 'CONVERSATION_JOB_SUBMIT_FAILED'
      return error(503, code)
    }
  }
}

const production = createConversationJobsPostHandler({
  async authenticate() {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const result = await (await createServerSupabaseClient()).auth.getUser()
    return result.error ? null : result.data.user?.id ?? null
  },
  async authorize(input) {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const { loadConversationActor } = await import('@/features/chat/conversation-authority')
    const actor = await loadConversationActor(await createServerSupabaseClient() as unknown as import('@/features/chat/conversation-authority').ConversationAuthorityDatabase, input)
    return Boolean(actor && actor.role !== 'viewer')
  },
  async submit(input) {
    const [{ getCloudflareContext }, { createAdminSupabaseClient }] = await Promise.all([
      import('@opennextjs/cloudflare'),
      import('@/lib/supabase/admin'),
    ])
    const { env } = await getCloudflareContext({ async: true })
    const queue = (env as unknown as { CONVERSATION_JOBS_QUEUE?: { send(value: unknown): Promise<void> } }).CONVERSATION_JOBS_QUEUE
    if (!queue) throw new Error('CONVERSATION_JOB_QUEUE_UNAVAILABLE')
    const admin = createAdminSupabaseClient()
    return submitConversationJob(input, {
      async enqueue(value) {
        const result = await admin.rpc('enqueue_conversation_job', {
          p_workspace_id: value.workspaceId,
          p_thread_id: value.threadId,
          p_user_id: value.userId,
          p_client_message_id: value.request.clientMessageId,
          p_display_content: value.request.displayContent ?? value.request.content,
          p_execution_content: value.request.content,
          p_kind: value.kind,
          p_requested_credits: value.requestedCredits,
          p_reservation_id: value.reservationId,
        })
        const parsed = z.object({
          job: z.object({ id: uuid, workspace_id: uuid, thread_id: uuid, status: z.enum(['queued', 'running', 'cancel_requested', 'succeeded', 'needs_attention', 'cancelled']), kind: z.string(), queue_dispatched_at: z.string().nullable() }).passthrough(),
          userMessage: queuedMessage,
          assistantMessage: queuedMessage,
          reservation: z.object({ id: uuid, requestedCredits: z.number().int().positive() }).strict(),
        }).strict().safeParse(result.data)
        if (result.error || !parsed.success) throw new Error('CONVERSATION_JOB_ENQUEUE_FAILED')
        return {
          job: {
            ...parsed.data.job,
            workspaceId: parsed.data.job.workspace_id,
            threadId: parsed.data.job.thread_id,
            kind: parsed.data.job.kind as 'chat' | 'content_generation' | 'image_generation' | 'publish_preparation',
            queueDispatchedAt: parsed.data.job.queue_dispatched_at,
          },
          userMessage: mapMessage(parsed.data.userMessage),
          assistantMessage: mapMessage(parsed.data.assistantMessage),
          reservation: parsed.data.reservation,
        }
      },
      async persistRequestMetadata(jobId, value) {
        const metadata = {
          attachmentIds: value.attachmentIds,
          ...(value.replyToMessageId ? { replyToMessageId: value.replyToMessageId } : {}),
          ...(value.selectedSlideId ? { selectedSlideId: value.selectedSlideId } : {}),
          ...(value.retryFailedSlideId ? { retryFailedSlideId: value.retryFailedSlideId } : {}),
          ...(value.retryAssistantMessageId ? { retryAssistantMessageId: value.retryAssistantMessageId } : {}),
        }
        const result = await admin.rpc('persist_conversation_job_request', { p_workspace_id: input.workspaceId, p_job_id: jobId, p_request_metadata: metadata })
        if (result.error || result.data !== true) throw new Error('CONVERSATION_JOB_METADATA_FAILED')
      },
      async markDispatched(jobId, workspaceId) {
        const result = await admin.rpc('mark_conversation_job_dispatched', { p_workspace_id: workspaceId, p_job_id: jobId, p_now: new Date().toISOString() })
        if (result.error || result.data !== true) throw new Error('CONVERSATION_JOB_DISPATCH_RECORD_FAILED')
      },
      async failDispatch(jobId, workspaceId) {
        await admin.rpc('fail_conversation_job_dispatch', { p_workspace_id: workspaceId, p_job_id: jobId, p_now: new Date().toISOString() })
      },
      queue,
    })
  },
})

export const POST = production
