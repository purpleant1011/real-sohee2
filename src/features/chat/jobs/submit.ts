import { z } from 'zod'
import { chatRequestSchema, type ChatRequest } from '../chat-request-schema'
import { parseConversationImageRequest } from '../conversation-image-intent'
import { parseConversationPostRequest } from '../conversation-post-intent'

const uuid = z.string().uuid()
const storedSchema = z.object({
  job: z.object({
    id: uuid,
    workspaceId: uuid,
    threadId: uuid,
    status: z.enum(['queued', 'running', 'cancel_requested', 'succeeded', 'needs_attention', 'cancelled']),
    kind: z.enum(['chat', 'content_generation', 'image_generation', 'publish_preparation']),
    queueDispatchedAt: z.string().datetime({ offset: true }).nullable(),
  }).passthrough(),
  userMessage: z.object({ id: uuid }).passthrough(),
  assistantMessage: z.object({ id: uuid }).passthrough(),
  reservation: z.object({ id: uuid, requestedCredits: z.number().int().positive() }).strict(),
}).strict()

export type StoredConversationJob = z.infer<typeof storedSchema>

export type SubmitConversationJobDependencies = Readonly<{
  enqueue(input: Readonly<{
    workspaceId: string
    threadId: string
    userId: string
    request: ChatRequest
    kind: StoredConversationJob['job']['kind']
    requestedCredits: number
    reservationId: string
  }>): Promise<StoredConversationJob>
  persistRequestMetadata(jobId: string, request: ChatRequest): Promise<void>
  markDispatched(jobId: string, workspaceId: string): Promise<void>
  failDispatch(jobId: string, workspaceId: string): Promise<void>
  queue: Readonly<{ send(message: unknown): Promise<void> | void }>
}>

function classify(request: ChatRequest) {
  const post = parseConversationPostRequest(request.content)
  if (post) {
    const images = post.candidates.reduce((total, candidate) => total + candidate.count, 0)
    return { kind: 'content_generation' as const, requestedCredits: 30 + images * 45 }
  }
  const image = parseConversationImageRequest(request.content)
  if (image) return { kind: 'image_generation' as const, requestedCredits: image.count * 45 }
  return { kind: 'chat' as const, requestedCredits: 20 }
}

export async function submitConversationJob(
  rawInput: Readonly<{ workspaceId: string; threadId: string; userId: string; request: unknown }>,
  dependencies: SubmitConversationJobDependencies,
): Promise<StoredConversationJob> {
  const ids = z.object({ workspaceId: uuid, threadId: uuid, userId: uuid }).safeParse(rawInput)
  const request = chatRequestSchema.safeParse(rawInput.request)
  if (!ids.success || !request.success) throw new Error('CONVERSATION_JOB_SUBMIT_INVALID')
  if (request.data.workRef) throw new Error('CONVERSATION_WORK_REVIEW_REQUIRES_FOREGROUND')
  const classification = classify(request.data)
  const stored = storedSchema.parse(await dependencies.enqueue({
    ...ids.data,
    request: request.data,
    ...classification,
    reservationId: crypto.randomUUID(),
  }))
  if (stored.job.workspaceId !== ids.data.workspaceId || stored.job.threadId !== ids.data.threadId) {
    throw new Error('CONVERSATION_JOB_SCOPE_MISMATCH')
  }
  if (stored.job.queueDispatchedAt) return stored

  await dependencies.persistRequestMetadata(stored.job.id, request.data)
  try {
    await dependencies.queue.send({
      schemaVersion: 1,
      jobId: stored.job.id,
      workspaceId: stored.job.workspaceId,
    })
  } catch {
    await dependencies.failDispatch(stored.job.id, stored.job.workspaceId).catch(() => undefined)
    throw new Error('CONVERSATION_JOB_DISPATCH_FAILED')
  }
  await dependencies.markDispatched(stored.job.id, stored.job.workspaceId)
  return stored
}
