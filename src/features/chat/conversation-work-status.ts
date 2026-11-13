import { z } from 'zod'

const statusSchema = z.object({
  activeJobCount: z.number().int().nonnegative(),
  attentionThreadCount: z.number().int().nonnegative(),
  threads: z.array(z.object({
    threadId: z.string().uuid(),
    displayStatus: z.enum(['idle', 'working', 'attention', 'archived']),
    activeJobCount: z.number().int().nonnegative(),
    latestJobUpdatedAt: z.string().datetime({ offset: true }).nullable(),
  }).strict()),
  creditBalance: z.object({
    available: z.number().int(),
    weeklyLimit: z.number().int().positive(),
    consumed: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    policyVersion: z.string().min(1),
  }).passthrough(),
  observedAt: z.string().datetime({ offset: true }),
}).strict()

export type ConversationWorkStatus = z.infer<typeof statusSchema>
export type ThreadWorkStatus = ConversationWorkStatus['threads'][number]['displayStatus']

export function parseConversationWorkStatus(value: unknown): ConversationWorkStatus {
  return statusSchema.parse(value)
}

export function nextWorkStatusPollMs(status: ConversationWorkStatus | null, visible: boolean): number | null {
  if (!visible) return null
  if ((status?.activeJobCount ?? 0) > 0) return 5_000
  if ((status?.attentionThreadCount ?? 0) > 0) return 30_000
  return 120_000
}
