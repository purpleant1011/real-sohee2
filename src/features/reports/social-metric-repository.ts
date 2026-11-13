import 'server-only'

import { z } from 'zod'
import type { SocialMetricName, SocialMetricState } from './meta-insights-provider'

type Gateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}>

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const metricName = z.enum([
  'views', 'likes', 'comments', 'saved', 'shares',
  'replies', 'reposts', 'quotes', 'visits', 'inquiries',
])
const metricState = z.enum([
  'available', 'no_data', 'not_supported', 'permission_denied', 'failed',
])
const metric = z.object({
  metric: metricName,
  state: metricState,
  value: z.number().int().nonnegative().safe().nullable(),
}).strict().superRefine((value, context) => {
  if ((value.state === 'available') !== (value.value !== null)) {
    context.addIssue({ code: 'custom', message: 'METRIC_VALUE_STATE_MISMATCH' })
  }
})
const inputSchema = z.object({
  workspaceId: uuid,
  publishAttemptId: uuid,
  requestKey: uuid,
  periodStart: timestamp,
  periodEnd: timestamp,
  collectedAt: timestamp,
  status: z.enum(['succeeded', 'no_data', 'permission_denied', 'failed']),
  errorCode: z.string().min(1).max(120).regex(/^[A-Z0-9_]+$/u).nullable(),
  nextAttemptAt: timestamp.nullable(),
  metrics: z.array(metric).min(1).max(10),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.periodEnd) < Date.parse(value.periodStart)) {
    context.addIssue({ code: 'custom', message: 'INVALID_PERIOD' })
  }
  if (new Set(value.metrics.map((item) => item.metric)).size !== value.metrics.length) {
    context.addIssue({ code: 'custom', message: 'DUPLICATE_METRIC' })
  }
  if (value.status === 'failed' && value.errorCode === null) {
    context.addIssue({ code: 'custom', message: 'MISSING_ERROR_CODE' })
  }
  if (value.status !== 'failed' && value.errorCode !== null) {
    context.addIssue({ code: 'custom', message: 'UNEXPECTED_ERROR_CODE' })
  }
})

const metricContextSchema = z.object({
  workspace_id: uuid,
  publish_attempt_id: uuid,
  channel_connection_id: uuid,
  channel: z.enum(['instagram', 'threads']),
  provider_post_reference: z.string().min(1).max(500),
  published_at: timestamp,
}).strict()

export type PublishedMetricContext = Readonly<{
  workspaceId: string
  publishAttemptId: string
  channelConnectionId: string
  channel: 'instagram' | 'threads'
  providerPostReference: string
  publishedAt: string
}>

export type SaveMetricCollectionInput = Readonly<{
  workspaceId: string
  publishAttemptId: string
  requestKey: string
  periodStart: string
  periodEnd: string
  collectedAt: string
  status: 'succeeded' | 'no_data' | 'permission_denied' | 'failed'
  errorCode: string | null
  nextAttemptAt: string | null
  metrics: readonly Readonly<{
    metric: SocialMetricName
    state: SocialMetricState
    value: number | null
  }>[]
}>

async function productionGateway(): Promise<Gateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminSupabaseClient()
  return { rpc: (name, args) => supabase.rpc(name as never, args as never) as never }
}

export async function loadPublishedMetricContext(
  workspaceId: string,
  publishAttemptId: string,
  providedGateway?: Gateway,
): Promise<PublishedMetricContext> {
  if (!uuid.safeParse(workspaceId).success || !uuid.safeParse(publishAttemptId).success) {
    throw new Error('채널 게시 결과를 확인해 주세요.')
  }
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('load_social_metric_context', {
    p_workspace_id: workspaceId,
    p_publish_attempt_id: publishAttemptId,
  })
  const row = Array.isArray(result.data) ? result.data[0] : result.data
  const parsed = metricContextSchema.safeParse(row)
  if (
    result.error || !parsed.success
    || parsed.data.workspace_id !== workspaceId
    || parsed.data.publish_attempt_id !== publishAttemptId
  ) {
    throw new Error('채널 게시 결과를 확인해 주세요.')
  }
  return Object.freeze({
    workspaceId: parsed.data.workspace_id,
    publishAttemptId: parsed.data.publish_attempt_id,
    channelConnectionId: parsed.data.channel_connection_id,
    channel: parsed.data.channel,
    providerPostReference: parsed.data.provider_post_reference,
    publishedAt: parsed.data.published_at,
  })
}

export async function saveMetricCollection(
  rawInput: SaveMetricCollectionInput,
  providedGateway?: Gateway,
): Promise<Readonly<{ collectionId: string }>> {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) throw new Error('채널 성과 수집 기록을 확인해 주세요.')
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('save_channel_metric_collection', {
    p_workspace_id: parsed.data.workspaceId,
    p_publish_attempt_id: parsed.data.publishAttemptId,
    p_request_key: parsed.data.requestKey,
    p_period_start: parsed.data.periodStart,
    p_period_end: parsed.data.periodEnd,
    p_collected_at: parsed.data.collectedAt,
    p_status: parsed.data.status,
    p_error_code: parsed.data.errorCode,
    p_next_attempt_at: parsed.data.nextAttemptAt,
    p_metrics: parsed.data.metrics,
  })
  const rawCollectionId = Array.isArray(result.data) ? result.data[0] : result.data
  const collectionId = uuid.safeParse(rawCollectionId)
  if (result.error || !collectionId.success) {
    throw new Error('채널 성과 수집 기록을 저장하지 못했습니다.')
  }
  return Object.freeze({ collectionId: collectionId.data })
}

export type SavedMetricSnapshot = Readonly<{
  collectedAt: string
  metrics: readonly Readonly<{
    metric: SocialMetricName
    state: SocialMetricState
    value: number | null
  }>[]
}>

export async function loadSavedMetricSnapshot(
  workspaceId: string,
  collectionId: string,
): Promise<SavedMetricSnapshot | null> {
  if (!uuid.safeParse(workspaceId).success || !uuid.safeParse(collectionId).success) {
    return null
  }
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminSupabaseClient()
  const [collectionRes, valuesRes] = await Promise.all([
    supabase
      .from('channel_metric_collections')
      .select('collected_at')
      .eq('workspace_id', workspaceId)
      .eq('id', collectionId)
      .maybeSingle(),
    supabase
      .from('channel_metric_values')
      .select('metric, state, value')
      .eq('workspace_id', workspaceId)
      .eq('collection_id', collectionId),
  ])
  if (collectionRes.error || !collectionRes.data || valuesRes.error || !Array.isArray(valuesRes.data)) return null
  return Object.freeze({
    collectedAt: collectionRes.data.collected_at,
    metrics: Object.freeze(
      valuesRes.data.map((row) =>
        Object.freeze({
          metric: row.metric as SocialMetricName,
          state: row.state as SocialMetricState,
          value: row.value === null ? null : Number(row.value),
        }),
      ),
    ),
  })
}
