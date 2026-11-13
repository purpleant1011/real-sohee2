import { z } from 'zod'

/** Shared device-authenticated POST /api/connector/connections/categories contract. */
export const categorySyncRequestSchema = z.object({
  browserChannelConnectionId: z.string().uuid(),
  categories: z.array(z.object({
    id: z.string().min(1).max(200),
    label: z.string().min(1).max(100),
    depth: z.number().int().min(0).max(1),
  }).strict()).max(200),
}).strict()

export const categorySyncResponseSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().min(0).max(200),
}).strict()

export type CategorySyncRequest = z.infer<typeof categorySyncRequestSchema>
export type CategorySyncResponse = z.infer<typeof categorySyncResponseSchema>
