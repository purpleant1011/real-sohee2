/**
 * [ANI-1455] Privacy-Safe Tutorial Learning Signals & UX Funnel Observability
 *
 * Tracks user learning journey and employee calibration progression
 * while strictly upholding the Zero PII, Zero Secret, and Content-Separation Invariants.
 */

export const TUTORIAL_LEARNING_EVENTS = [
  'tutorial_started',
  'tutorial_completed',
  'first_meeting_goal_candidate_created',
  'business_candidate_confirmed',
  'business_candidate_edited',
  'text_calibration_generated',
  'text_calibration_selected',
  'text_calibration_feedback',
  'text_calibration_regenerated',
  'text_calibration_confirmed',
  'image_calibration_generated',
  'image_calibration_selected',
  'image_calibration_feedback',
  'image_calibration_regenerated',
  'image_calibration_confirmed',
  'first_post_revision_count',
  'publish_channel_external_verified',
  'stage_dropoff',
] as const

export type TutorialLearningEventType = (typeof TUTORIAL_LEARNING_EVENTS)[number]

export interface TutorialLearningSignal {
  id: string
  workspaceId: string
  sessionId: string
  eventType: TutorialLearningEventType
  timestamp: string
  stage: 'FIRST_MEETING' | 'BUSINESS_KNOWLEDGE' | 'CHANNELS' | 'TEXT_HARNESS' | 'IMAGE_HARNESS' | 'POLICY' | 'FIRST_POST'
  metrics?: {
    durationMs?: number
    iterationCount?: number
    revisionCount?: number
    itemsCount?: number
  }
  dimensions?: {
    channel?: 'INSTAGRAM' | 'THREADS' | 'DUAL'
    selectedStyleId?: string
    feedbackCategory?: 'TONE' | 'LENGTH' | 'PRICE' | 'VISUAL' | 'RESTRICTION' | 'OTHER'
    success?: boolean
    errorCode?: string
  }
  // Content bodies and sensitive freeform text are explicitly omitted by design.
}

const SECRET_OR_PII_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /bearer/i,
  /apikey/i,
  /auth_code/i,
  /\d{6}-[1-4]\d{6}/, // Resident registration number
  /\d{4}-\d{4}-\d{4}-\d{4}/, // Credit card
]

/**
 * Strips any freeform text or sensitive PII from telemetry dimensions
 */
export function sanitizeTutorialDimensions(
  dimensions: Record<string, any>
): Record<string, any> {
  const clean: Record<string, any> = {}

  for (const [key, value] of Object.entries(dimensions)) {
    if (value === null || value === undefined) continue

    // Reject any secret/PII keys
    if (SECRET_OR_PII_PATTERNS.some((p) => p.test(key))) {
      continue
    }

    if (typeof value === 'string') {
      // Check for secret values
      if (SECRET_OR_PII_PATTERNS.some((p) => p.test(value))) {
        clean[key] = '[REDACTED_SECRET]'
        continue
      }
      // Truncate non-category strings if too long (max 64 chars) to prevent freeform prompt bleed
      if (value.length > 64) {
        clean[key] = value.slice(0, 64) + '...'
      } else {
        clean[key] = value
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value
    }
  }

  return clean
}

/**
 * Creates a structured, privacy-safe learning signal
 */
export function createTutorialLearningSignal(params: {
  workspaceId: string
  sessionId: string
  eventType: TutorialLearningEventType
  stage: TutorialLearningSignal['stage']
  metrics?: TutorialLearningSignal['metrics']
  dimensions?: Record<string, any>
}): TutorialLearningSignal {
  const signalId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const sanitizedDims = params.dimensions
    ? (sanitizeTutorialDimensions(params.dimensions) as TutorialLearningSignal['dimensions'])
    : undefined

  return Object.freeze({
    id: signalId,
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    eventType: params.eventType,
    timestamp: new Date().toISOString(),
    stage: params.stage,
    metrics: params.metrics ? Object.freeze({ ...params.metrics }) : undefined,
    dimensions: sanitizedDims ? Object.freeze({ ...sanitizedDims }) : undefined,
  })
}

export interface TutorialLearningFunnelMetrics {
  workspaceId: string
  totalStarted: number
  totalCompleted: number
  completionRatePct: number
  avgTextRegenerations: number
  avgImageRegenerations: number
  avgFirstPostRevisions: number
  verifiedChannelsBreakdown: {
    instagram: number
    threads: number
    both: number
  }
}

/**
 * Aggregates tutorial learning signals to evaluate learning iterations & completion
 */
export function calculateTutorialLearningMetrics(
  signals: TutorialLearningSignal[]
): TutorialLearningFunnelMetrics {
  const workspaceId = signals[0]?.workspaceId || 'unknown'
  const startedSessions = new Set<string>()
  const completedSessions = new Set<string>()

  let totalTextRegens = 0
  let totalImageRegens = 0
  let totalPostRevisions = 0
  let igVerifiedCount = 0
  let thVerifiedCount = 0
  let dualVerifiedCount = 0

  for (const s of signals) {
    if (s.eventType === 'tutorial_started') {
      startedSessions.add(s.sessionId)
    }
    if (s.eventType === 'tutorial_completed') {
      completedSessions.add(s.sessionId)
    }
    if (s.eventType === 'text_calibration_regenerated' || s.eventType === 'text_calibration_feedback') {
      totalTextRegens += s.metrics?.iterationCount ?? 1
    }
    if (s.eventType === 'image_calibration_regenerated' || s.eventType === 'image_calibration_feedback') {
      totalImageRegens += s.metrics?.iterationCount ?? 1
    }
    if (s.eventType === 'first_post_revision_count') {
      totalPostRevisions += s.metrics?.revisionCount ?? 1
    }
    if (s.eventType === 'publish_channel_external_verified') {
      if (s.dimensions?.channel === 'INSTAGRAM') igVerifiedCount++
      if (s.dimensions?.channel === 'THREADS') thVerifiedCount++
      if (s.dimensions?.channel === 'DUAL') dualVerifiedCount++
    }
  }

  const started = startedSessions.size || (signals.length > 0 ? 1 : 0)
  const completed = completedSessions.size

  return {
    workspaceId,
    totalStarted: started,
    totalCompleted: completed,
    completionRatePct: started > 0 ? Math.round((completed / started) * 100) : 0,
    avgTextRegenerations: started > 0 ? Number((totalTextRegens / started).toFixed(1)) : 0,
    avgImageRegenerations: started > 0 ? Number((totalImageRegens / started).toFixed(1)) : 0,
    avgFirstPostRevisions: started > 0 ? Number((totalPostRevisions / started).toFixed(1)) : 0,
    verifiedChannelsBreakdown: {
      instagram: igVerifiedCount,
      threads: thVerifiedCount,
      both: dualVerifiedCount,
    },
  }
}
