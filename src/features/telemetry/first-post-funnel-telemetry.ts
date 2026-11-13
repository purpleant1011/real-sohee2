/**
 * First Post Funnel Telemetry & Observability Engine (ANI-1436)
 *
 * Measures North Star: Time to First Verified Post and evaluates drop-off across
 * the 16-step journey from onboarding initiation to external verification.
 * Strictly guarantees Zero PII & Token leakage and multi-tenant isolation.
 */

export const FUNNEL_STEPS = [
  'ONBOARDING_START',
  'CONVERSATION_AUTOFILL',
  'USER_CORRECTION',
  'OAUTH_START',
  'OAUTH_CALLBACK',
  'PROVIDER_VERIFIED',
  'KNOWLEDGE_CONFIRMED',
  'TEXT_HARNESS_CONFIRMED',
  'IMAGE_HARNESS_CONFIRMED',
  'POLICY_CONFIRMED',
  'SOHEE_READY_ACHIEVED',
  'FIRST_MISSION_CREATED',
  'EXACT_APPROVAL',
  'PROVIDER_ACCEPTED',
  'EXTERNALLY_VERIFIED',
  'FIRST_POST_COMPLETE',
] as const

export type FunnelStep = (typeof FUNNEL_STEPS)[number]

export type FailureCategory =
  | 'OAUTH_REJECTED'
  | 'OAUTH_ERROR'
  | 'TOKEN_EXPIRED'
  | 'CAPABILITY_FAILED'
  | 'PERSISTENCE_FAILED'
  | 'HARNESS_INSUFFICIENT'
  | 'APPROVAL_REJECTED'
  | 'TAMPER_DETECTED'
  | 'PROVIDER_UNAVAILABLE'
  | 'READBACK_TIMEOUT'
  | 'KILL_SWITCH_ACTIVE'
  | 'USER_DROP_OFF'
  | 'UNKNOWN'

export interface FunnelEventPayload {
  workspaceId: string
  correlationId: string
  step: FunnelStep
  stepIndex: number
  timestamp: string
  durationMsFromStart?: number
  metadata?: Record<string, any>
}

export interface FunnelStepMetric {
  step: FunnelStep
  stepIndex: number
  reachCount: number
  conversionFromStartPct: number
  dropOffFromPrevPct: number
}

export interface TimeToPostMetric {
  totalCompletedCount: number
  avgSeconds: number
  medianSeconds: number
  p90Seconds: number
}

export interface FunnelMetricsResult {
  workspaceId: string
  totalJourneys: number
  completedJourneys: number
  overallConversionRatePct: number
  steps: FunnelStepMetric[]
  timeToFirstVerifiedPostSec: TimeToPostMetric
}

export interface FailureBreakdownItem {
  category: FailureCategory
  count: number
  percentage: number
}

export interface FailureTaxonomyResult {
  totalFailures: number
  breakdown: FailureBreakdownItem[]
}

const SECRET_KEY_PATTERNS = [
  /token/i,
  /password/i,
  /jwt/i,
  /apikey/i,
  /secret/i,
  /authorization/i,
  /auth_code/i,
  /code_verifier/i,
]

const PII_PATTERNS = [
  /\b\d{6}-[1-4]\d{6}\b/g, // Korean resident registration number
  /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g, // Credit card number
]

/**
 * Sanitizes metadata to enforce Zero PII & Token Invariant.
 * Redacts secrets, truncates verbose prompts, and strips PII patterns.
 */
export function sanitizeTelemetryMetadata(
  rawMeta?: Record<string, any>
): Record<string, any> {
  if (!rawMeta || typeof rawMeta !== 'object') return {}

  const result: Record<string, any> = {}

  for (const [key, val] of Object.entries(rawMeta)) {
    // 1. Check secret key name
    const isSecretKey = SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))
    if (isSecretKey) {
      result[key] = '[REDACTED_SECRET]'
      continue
    }

    if (typeof val === 'string') {
      let sanitizedVal = val

      // 2. Redact JWT or Bearer tokens in values
      if (
        sanitizedVal.startsWith('Bearer ') ||
        /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(sanitizedVal)
      ) {
        result[key] = '[REDACTED_SECRET]'
        continue
      }

      // 3. Redact PII (resident number, card number)
      for (const piiRegex of PII_PATTERNS) {
        sanitizedVal = sanitizedVal.replace(piiRegex, '[REDACTED_PII]')
      }

      // 4. Truncate long prompts (> 120 chars) to prevent prompt injection and data bloat
      if (sanitizedVal.length > 120 && (key.includes('prompt') || key.includes('text') || key.includes('raw'))) {
        sanitizedVal = `${sanitizedVal.slice(0, 100)}...[TRUNCATED]`
      }

      result[key] = sanitizedVal
    } else if (Array.isArray(val)) {
      result[key] = val.map((item) => {
        if (typeof item === 'string') {
          let sItem = item
          if (
            sItem.startsWith('Bearer ') ||
            /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(sItem)
          ) {
            return '[REDACTED_SECRET]'
          }
          for (const piiRegex of PII_PATTERNS) {
            sItem = sItem.replace(piiRegex, '[REDACTED_PII]')
          }
          return sItem
        } else if (typeof item === 'object' && item !== null) {
          return sanitizeTelemetryMetadata(item)
        }
        return item
      })
    } else if (typeof val === 'object' && val !== null) {
      result[key] = sanitizeTelemetryMetadata(val)
    } else {
      result[key] = val
    }
  }

  return result
}

/**
 * Validates a funnel event against schema requirements
 */
export function validateFunnelEvent(event: Partial<FunnelEventPayload>): {
  isValid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!event.workspaceId || typeof event.workspaceId !== 'string') {
    errors.push('workspaceId is required and must be a string')
  }

  if (!event.correlationId || typeof event.correlationId !== 'string') {
    errors.push('correlationId is required and must be a string')
  }

  if (!event.step || !FUNNEL_STEPS.includes(event.step as FunnelStep)) {
    errors.push(`step must be one of: ${FUNNEL_STEPS.join(', ')}`)
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * Constructs a standardized, sanitized funnel event
 */
export function createFunnelEvent(params: {
  workspaceId: string
  correlationId: string
  step: FunnelStep
  correlationStartTime?: string
  metadata?: Record<string, any>
}): FunnelEventPayload {
  const { workspaceId, correlationId, step, correlationStartTime, metadata } = params

  const now = new Date()
  const stepIndex = FUNNEL_STEPS.indexOf(step)

  let durationMsFromStart: number | undefined
  if (correlationStartTime) {
    const startMs = new Date(correlationStartTime).getTime()
    if (!isNaN(startMs)) {
      durationMsFromStart = Math.max(0, now.getTime() - startMs)
    }
  }

  return {
    workspaceId,
    correlationId,
    step,
    stepIndex,
    timestamp: now.toISOString(),
    durationMsFromStart,
    metadata: sanitizeTelemetryMetadata(metadata),
  }
}

/**
 * Calculates funnel conversion metrics, step drop-offs, and Time to First Verified Post
 */
export function calculateFunnelMetrics(
  events: FunnelEventPayload[],
  targetWorkspaceId: string
): FunnelMetricsResult {
  // Tenant isolation: filter events by targetWorkspaceId
  const workspaceEvents = events.filter((e) => e.workspaceId === targetWorkspaceId)

  // Group events by correlationId
  const journeyMap = new Map<string, FunnelEventPayload[]>()
  for (const event of workspaceEvents) {
    const existing = journeyMap.get(event.correlationId) || []
    existing.push(event)
    journeyMap.set(event.correlationId, existing)
  }

  const totalJourneys = journeyMap.size
  let completedJourneys = 0
  const completionDurationsSec: number[] = []

  // Check completions and calculate total duration
  for (const [, jEvents] of journeyMap) {
    const startEvent = jEvents.find((e) => e.step === 'ONBOARDING_START')
    const completeEvent = jEvents.find((e) => e.step === 'FIRST_POST_COMPLETE')

    if (completeEvent) {
      completedJourneys++
      if (completeEvent.durationMsFromStart !== undefined) {
        completionDurationsSec.push(Math.round(completeEvent.durationMsFromStart / 1000))
      } else if (startEvent) {
        const diffMs =
          new Date(completeEvent.timestamp).getTime() - new Date(startEvent.timestamp).getTime()
        completionDurationsSec.push(Math.round(Math.max(0, diffMs) / 1000))
      }
    }
  }

  const overallConversionRatePct =
    totalJourneys > 0 ? (completedJourneys / totalJourneys) * 100 : 0

  // Calculate step-by-step reaches and drop-offs
  const stepMetrics: FunnelStepMetric[] = []
  let prevReachCount = totalJourneys

  for (let idx = 0; idx < FUNNEL_STEPS.length; idx++) {
    const stepName = FUNNEL_STEPS[idx]

    // Count unique journeys that reached this step
    let reachCount = 0
    for (const [, jEvents] of journeyMap) {
      if (jEvents.some((e) => e.step === stepName)) {
        reachCount++
      }
    }

    const conversionFromStartPct = totalJourneys > 0 ? (reachCount / totalJourneys) * 100 : 0
    const dropOffFromPrevPct =
      prevReachCount > 0 ? ((prevReachCount - reachCount) / prevReachCount) * 100 : 0

    stepMetrics.push({
      step: stepName,
      stepIndex: idx,
      reachCount,
      conversionFromStartPct,
      dropOffFromPrevPct: Math.max(0, dropOffFromPrevPct),
    })

    prevReachCount = reachCount
  }

  // Calculate duration statistics
  completionDurationsSec.sort((a, b) => a - b)
  const totalCompleted = completionDurationsSec.length
  let avgSeconds = 0
  let medianSeconds = 0
  let p90Seconds = 0

  if (totalCompleted > 0) {
    const sum = completionDurationsSec.reduce((acc, v) => acc + v, 0)
    avgSeconds = Math.round(sum / totalCompleted)

    const midIdx = Math.floor(totalCompleted / 2)
    medianSeconds =
      totalCompleted % 2 === 0
        ? Math.round((completionDurationsSec[midIdx - 1] + completionDurationsSec[midIdx]) / 2)
        : completionDurationsSec[midIdx]

    const p90Idx = Math.min(totalCompleted - 1, Math.floor(totalCompleted * 0.9))
    p90Seconds = completionDurationsSec[p90Idx]
  }

  return {
    workspaceId: targetWorkspaceId,
    totalJourneys,
    completedJourneys,
    overallConversionRatePct,
    steps: stepMetrics,
    timeToFirstVerifiedPostSec: {
      totalCompletedCount: totalCompleted,
      avgSeconds,
      medianSeconds,
      p90Seconds,
    },
  }
}

/**
 * Aggregates failure categories from funnel events
 */
export function aggregateFailureTaxonomy(
  events: FunnelEventPayload[]
): FailureTaxonomyResult {
  const categoryCountMap = new Map<FailureCategory, number>()
  let totalFailures = 0

  for (const event of events) {
    const cat = event.metadata?.failureCategory as FailureCategory | undefined
    if (cat) {
      totalFailures++
      categoryCountMap.set(cat, (categoryCountMap.get(cat) || 0) + 1)
    }
  }

  const breakdown: FailureBreakdownItem[] = []
  for (const [cat, count] of categoryCountMap) {
    const percentage = totalFailures > 0 ? Math.round((count / totalFailures) * 100) : 0
    breakdown.push({
      category: cat,
      count,
      percentage,
    })
  }

  // Sort descending by count
  breakdown.sort((a, b) => b.count - a.count)

  return {
    totalFailures,
    breakdown,
  }
}

/**
 * In-memory ring buffer for telemetry events (low-latency store for serverless runs)
 */
const globalFunnelEventStore: FunnelEventPayload[] = []
const MAX_BUFFER_SIZE = 1000

export function recordGlobalFunnelEvent(event: FunnelEventPayload): void {
  globalFunnelEventStore.push(event)
  if (globalFunnelEventStore.length > MAX_BUFFER_SIZE) {
    globalFunnelEventStore.shift()
  }
}

export function getGlobalFunnelEvents(workspaceId?: string): FunnelEventPayload[] {
  if (!workspaceId) return [...globalFunnelEventStore]
  return globalFunnelEventStore.filter((e) => e.workspaceId === workspaceId)
}

/**
 * Merges and deduplicates in-memory and database funnel events.
 * Earlier timestamp wins for duplicate correlationId + step.
 */
export function mergeFunnelEvents(
  primaryEvents: FunnelEventPayload[],
  secondaryEvents: FunnelEventPayload[]
): FunnelEventPayload[] {
  const map = new Map<string, FunnelEventPayload>()

  const addEvent = (e: FunnelEventPayload) => {
    const key = `${e.correlationId}:${e.step}`
    const existing = map.get(key)
    if (!existing) {
      map.set(key, e)
    } else {
      const existingTime = new Date(existing.timestamp).getTime()
      const newTime = new Date(e.timestamp).getTime()
      if (newTime < existingTime) {
        map.set(key, e)
      }
    }
  }

  for (const e of primaryEvents) addEvent(e)
  for (const e of secondaryEvents) addEvent(e)

  const result = Array.from(map.values())
  result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  return result
}

/**
 * Persists a funnel event into mission_events table for durable auditability.
 * R2-B9: Pre-mission events do NOT forge fake zero UUIDs; mission_id is null.
 */
export async function persistFunnelEventToDatabase(params: {
  supabase: any
  event: FunnelEventPayload
  actorUserId?: string
}): Promise<boolean> {
  const { supabase, event, actorUserId } = params
  try {
    const rawMissionId = event.metadata?.missionId
    // R2-B9: Eliminate fake zero UUIDs. If no mission yet or if zero UUID, use null.
    const missionId =
      rawMissionId &&
      rawMissionId !== '00000000-0000-0000-0000-000000000000' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawMissionId)
        ? rawMissionId
        : null

    const payload = {
      stepIndex: event.stepIndex,
      durationMs: event.durationMsFromStart,
      metadata: event.metadata || {},
    }

    const { error } = await supabase.from('mission_events').insert({
      workspace_id: event.workspaceId,
      mission_id: missionId,
      trace_id: event.correlationId,
      from_status: null,
      to_status: event.step,
      actor_type: 'user',
      actor_id: actorUserId && actorUserId !== '00000000-0000-0000-0000-000000000000' ? actorUserId : null,
      event_name: `FUNNEL_${event.step}`,
      payload,
      occurred_at: event.timestamp,
    })

    if (error) {
      console.warn('[persistFunnelEventToDatabase] DB insert warning:', error.message)
      return false
    }
    return true
  } catch (err: any) {
    console.warn('[persistFunnelEventToDatabase] DB insert exception:', err?.message || err)
    return false
  }
}

export interface FetchPersistedFunnelEventsResult {
  events: FunnelEventPayload[]
  evidenceUnavailable: boolean
  error?: string
}

/**
 * Fetches persisted funnel events from mission_events table with explicit DB error status.
 * R2-B9: Distinguishes between 0 events and evidenceUnavailable due to DB failure.
 */
export async function fetchPersistedFunnelEventsResult(
  supabase: any,
  workspaceId: string
): Promise<FetchPersistedFunnelEventsResult> {
  try {
    const { data, error } = await supabase
      .from('mission_events')
      .select('workspace_id, trace_id, to_status, event_name, payload, occurred_at')
      .eq('workspace_id', workspaceId)
      .like('event_name', 'FUNNEL_%')
      .order('occurred_at', { ascending: true })

    if (error) {
      console.warn('[fetchPersistedFunnelEventsResult] Query error:', error?.message)
      return { events: [], evidenceUnavailable: true, error: error.message }
    }

    if (!data) {
      return { events: [], evidenceUnavailable: false }
    }

    const events = data.map((row: any) => {
      const step = (row.to_status || row.event_name.replace('FUNNEL_', '')) as FunnelStep
      const stepIndex = row.payload?.stepIndex ?? FUNNEL_STEPS.indexOf(step)
      return {
        workspaceId: row.workspace_id,
        correlationId: row.trace_id,
        step,
        stepIndex: stepIndex >= 0 ? stepIndex : 0,
        timestamp: row.occurred_at,
        durationMsFromStart: row.payload?.durationMs,
        metadata: row.payload?.metadata,
      }
    })

    return { events, evidenceUnavailable: false }
  } catch (err: any) {
    console.warn('[fetchPersistedFunnelEventsResult] Exception:', err?.message || err)
    return { events: [], evidenceUnavailable: true, error: err?.message || String(err) }
  }
}

/**
 * Fetches persisted funnel events from mission_events table.
 */
export async function fetchPersistedFunnelEvents(
  supabase: any,
  workspaceId: string
): Promise<FunnelEventPayload[]> {
  const result = await fetchPersistedFunnelEventsResult(supabase, workspaceId)
  return result.events
}
