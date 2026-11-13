import { z } from 'zod'

const timestamp = z.string().datetime({ offset: true })
const safeCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
export const systemObservationSourceSchema = z.enum(['conversation_jobs', 'provider_webhooks', 'operation_events', 'cloudflare', 'queue', 'cron', 'release'])
export const systemObservationStateSchema = z.enum(['healthy', 'degraded', 'error', 'empty', 'unknown'])
export const systemObservationFreshnessSchema = z.enum(['fresh', 'stale', 'empty', 'unknown', 'error'])
export const systemFactKindSchema = z.enum(['observed', 'inference', 'unknown'])

export const systemObservationRowSchema = z.object({
  source: systemObservationSourceSchema,
  state: systemObservationStateSchema,
  freshness: systemObservationFreshnessSchema,
  observed_at: timestamp.nullable(),
  safe_code: safeCode.nullable(),
  metric_value: z.number().int().nonnegative().nullable(),
  fact_kind: systemFactKindSchema.optional(),
}).strict()

export const systemObservationResponseSchema = z.object({
  items: z.array(systemObservationRowSchema),
  observation_window: z.literal('24h'),
  queue: z.array(z.object({ kind: z.enum(['waiting', 'running', 'retryable_failure', 'dead_letter']), count: z.number().int().nonnegative().nullable(), state: systemObservationStateSchema, freshness: systemObservationFreshnessSchema, observed_at: timestamp.nullable(), safe_code: safeCode.nullable(), fact_kind: systemFactKindSchema }).strict()).optional(),
  release: z.object({ version_code: z.string().max(120).nullable(), commit_sha_prefix: z.string().regex(/^[a-f0-9]{0,12}$/u).nullable(), deployed_at: timestamp.nullable(), rollback_candidate_code: safeCode.nullable(), verification_state: z.enum(['verified', 'failed', 'pending', 'unknown']), source: systemObservationSourceSchema, fact_kind: systemFactKindSchema, freshness: systemObservationFreshnessSchema }).strict().optional(),
}).strict()

export const naverPostQueueSummarySchema = z.object({
  pending: z.number().int().nonnegative().nullable(),
  running: z.number().int().nonnegative().nullable(),
  failed: z.number().int().nonnegative().nullable(),
  creditReconcileNeededCount: z.number().int().nonnegative().nullable(),
}).strict()

export type NaverPostQueueSummary = z.infer<typeof naverPostQueueSummarySchema>

export const naverPostJobDlqItemSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  requestKey: z.string(),
  userId: z.string().uuid().optional(),
  status: z.string(),
  contentId: z.string().uuid().nullable().optional(),
  versionId: z.string().uuid().nullable().optional(),
  creditReconcileNeeded: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()

export type NaverPostJobDlqItem = z.infer<typeof naverPostJobDlqItemSchema>

export type SystemObservation = Readonly<{
  source: z.infer<typeof systemObservationSourceSchema>
  state: z.infer<typeof systemObservationStateSchema>
  freshness: z.infer<typeof systemObservationFreshnessSchema>
  observedAt: string | null
  safeCode: string | null
  metricValue: number | null
  observationWindow: '24h'
  factKind: z.infer<typeof systemFactKindSchema>
}>
