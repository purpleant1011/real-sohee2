import { z } from 'zod'
const state = z.enum(['loading', 'ready', 'error', 'unknown', 'stale'])
const dataset = z.enum(['ACTUAL', 'DEMO', 'TEST', 'UNKNOWN'])
const kind = z.enum(['post_publish', 'dm_reply', 'comment_reply', 'proposal'])
const remote = <T extends z.ZodType>(data: T) => z.object({ state, data: data.nullable(), observedAt: z.string().nullable(), validUntil: z.string().nullable() })
export const mobileHomeSchema = z.object({
  workspaceId: z.string().min(1), businessName: z.string().nullable(), timeZone: z.string().nullable(), generatedAt: z.string(),
  agent: remote(z.object({ label: z.string(), detailHref: z.string() })),
  decisions: remote(z.object({ items: z.array(z.object({ id: z.string(), kind, title: z.string(), targetLabel: z.string(), createdAt: z.string(), expiresAt: z.string().nullable() })), total: z.number().int().nonnegative().nullable(), complete: z.boolean() })),
  activity: remote(z.array(z.object({ id: z.string(), title: z.string(), statusLabel: z.string(), observedAt: z.string(), evidenceRef: z.string().nullable() }))),
  results: remote(z.array(z.object({ id: z.enum(['published', 'bookings', 'revenue']), label: z.string(), value: z.number().finite().nullable(), unit: z.enum(['건', '원']), state, evidenceRef: z.string().nullable(), source: z.string().nullable().optional(), datasetMode: dataset, period: z.object({ start: z.string(), end: z.string(), timeZone: z.string() }).nullable() }))),
})
export const mobileApprovalSchema = z.object({
  workspaceId: z.string().min(1), id: z.string(), kind, title: z.string(), targetLabel: z.string().nullable(),
  sourceText: z.string().nullable(), fullContent: z.string().nullable(), imageUrls: z.array(z.string().url()),
  datasetMode: dataset, writeState: z.literal('unsupported'), reason: z.string(),
})
