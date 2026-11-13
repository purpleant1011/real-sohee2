import { z } from 'zod'
import type { ConversationJob, ConversationJobExecution, RecordedJobUsage } from './types'

const uuid = z.string().uuid()
const persistedRequestSchema = z.object({
  userId: uuid,
  clientMessageId: uuid,
  displayContent: z.string().trim().min(1).max(8_000),
  executionContent: z.string().trim().min(1).max(8_000),
  attachmentIds: z.array(uuid).max(20),
  retryAssistantMessageId: uuid.optional(),
  replyToMessageId: uuid.optional(),
  selectedSlideId: uuid.optional(),
  retryFailedSlideId: uuid.optional(),
}).strict()

export type PersistedRequest = z.infer<typeof persistedRequestSchema>

export function createPreparedMessageExecutor(dependencies: Readonly<{
  load(job: ConversationJob): Promise<PersistedRequest>
  execute(input: Readonly<{
    job: ConversationJob
    request: PersistedRequest
    onUsage(usage: RecordedJobUsage): void
  }>): Promise<Readonly<{
    status: 'completed' | 'failed' | 'cancelled'
    safeErrorCode: string | null
    billingDisposition: 'settle_usage' | 'release'
  }>>
}>) {
  return Object.freeze({
    async execute(job: ConversationJob): Promise<ConversationJobExecution> {
      const request = persistedRequestSchema.parse(await dependencies.load(job))
      const usage: RecordedJobUsage[] = []
      const result = await dependencies.execute({
        job,
        request,
        onUsage(value) {
          usage.push(value)
        },
      })
      return Object.freeze({
        status: result.status === 'completed'
          ? 'succeeded' as const
          : result.status === 'cancelled'
            ? 'cancelled' as const
            : 'needs_attention' as const,
        safeErrorCode: result.safeErrorCode,
        billingDisposition: result.billingDisposition,
        usage: Object.freeze([...usage]),
      })
    },
  })
}
