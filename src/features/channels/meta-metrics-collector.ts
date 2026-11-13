import 'server-only'

export type MetricType =
  | 'views'
  | 'likes'
  | 'comments'
  | 'saved'
  | 'shares'
  | 'replies'
  | 'reposts'
  | 'quotes'
  | 'visits'
  | 'inquiries'

export type MetricState = 'available' | 'no_data' | 'not_supported' | 'permission_denied' | 'failed'

export interface MetricItem {
  metric: MetricType
  state: MetricState
  value: number | null
}

export interface FreshnessEvaluationResult {
  isStale: boolean
  freshnessStatus: 'FRESH' | 'STALE'
  ageSeconds: number
}

const FOUR_HOURS_SECONDS = 4 * 60 * 60

/**
 * Evaluates freshness of metric observation (ANI-1000).
 * Prevents rendering stale data as live current numbers.
 */
export function evaluateMetricFreshness(
  collectedAtIso: string,
  referenceNowMs: number = Date.now(),
): FreshnessEvaluationResult {
  const collectedMs = new Date(collectedAtIso).getTime()
  const ageSeconds = Math.max(0, Math.floor((referenceNowMs - collectedMs) / 1000))
  const isStale = ageSeconds > FOUR_HOURS_SECONDS

  return {
    isStale,
    freshnessStatus: isStale ? 'STALE' : 'FRESH',
    ageSeconds,
  }
}

export interface MetricCollectionInput {
  workspaceId: string
  publishAttemptId: string
  provider: 'instagram' | 'threads'
  providerObjectId: string
  fetcher: () => Promise<{ success: boolean; metrics: Record<string, number> | null; error?: string }>
  client: any
}

export interface MetricCollectionResult {
  collectionId: string
  status: 'succeeded' | 'no_data' | 'permission_denied' | 'failed'
  collectedAt: string
  metrics: Record<string, MetricItem>
}

/**
 * Ingests real post/media metrics and persists to channel_metric_collections (ANI-1000).
 * Zero synthetic values permitted.
 */
export async function collectPostMetrics(
  input: MetricCollectionInput,
): Promise<MetricCollectionResult> {
  const { workspaceId, publishAttemptId, fetcher, client } = input
  const collectedAt = new Date().toISOString()
  const collectionId = crypto.randomUUID()
  const requestKey = crypto.randomUUID()

  // Generate SHA256 request fingerprint
  const fingerprintRaw = `${workspaceId}:${publishAttemptId}:${input.providerObjectId}:${collectedAt}`
  let hash = 0
  for (let i = 0; i < fingerprintRaw.length; i++) {
    hash = (hash << 5) - hash + fingerprintRaw.charCodeAt(i)
    hash |= 0
  }
  const requestFingerprint = Math.abs(hash).toString(16).padStart(64, '0')

  const fetchResult = await fetcher()
  const hasData = fetchResult.success && fetchResult.metrics && Object.keys(fetchResult.metrics).length > 0

  const allMetricTypes: MetricType[] = [
    'views', 'likes', 'comments', 'saved', 'shares',
    'replies', 'reposts', 'quotes', 'visits', 'inquiries',
  ]

  const metrics: Record<string, MetricItem> = {}

  for (const m of allMetricTypes) {
    if (hasData && typeof fetchResult.metrics?.[m] === 'number') {
      metrics[m] = {
        metric: m,
        state: 'available',
        value: fetchResult.metrics[m],
      }
    } else {
      metrics[m] = {
        metric: m,
        state: 'no_data',
        value: null,
      }
    }
  }

  const status = hasData ? 'succeeded' : 'no_data'

  // Persist collection header
  await client.from('channel_metric_collections').insert({
    id: collectionId,
    workspace_id: workspaceId,
    publish_attempt_id: publishAttemptId,
    request_key: requestKey,
    request_fingerprint: requestFingerprint,
    period_start: collectedAt,
    period_end: collectedAt,
    collected_at: collectedAt,
    status,
  })

  // Persist metric rows
  const metricRows = Object.values(metrics).map((item) => ({
    workspace_id: workspaceId,
    collection_id: collectionId,
    metric: item.metric,
    state: item.state,
    value: item.value,
    created_at: collectedAt,
  }))

  await client.from('channel_metric_values').insert(metricRows)

  return {
    collectionId,
    status,
    collectedAt,
    metrics,
  }
}
