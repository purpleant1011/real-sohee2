import { z } from 'zod'
import { marketingStrategyBriefSchema } from '@/features/content/blog-strategy-brief'

export const marketingStrategyReferenceSchema = z.object({
  missionId: z.string().uuid(), runId: z.string().uuid(), briefId: z.string().uuid(), revision: z.number().int().positive(),
}).strict()
export const marketingStrategyApprovalSchema = z.object({
  missionId: z.string().uuid(), runId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(),
  brief: marketingStrategyBriefSchema,
}).strict()
