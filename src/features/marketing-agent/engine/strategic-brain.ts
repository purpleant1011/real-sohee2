/**
 * Sohee V0.8.8 Strategic Marketing Employee Brain
 * Governs StrategicBrief, CustomerLifecycle, MarketSignal & Next Best Action
 */

export type CustomerLifecycleStage =
  | 'lead'
  | 'inquiry'
  | 'qualified'
  | 'booked'
  | 'visited_paid'
  | 'repeat_due'
  | 'reactivated'
  | 'churned'

export interface StrategicBrief {
  id: string
  workspaceId: string
  title: string
  objective: string
  capacity: {
    totalSlotsPerWeek: number
    availableSlotsThisWeek: number
    targetOccupancyRate: number
    currentOccupancyRate: number
  }
  targetSegment: {
    id: string
    name: string
    description: string
    criteria: string[]
    estimatedSize: number
  }
  primaryOffer: {
    id: string
    name: string
    regularPrice: number
    promotionalPrice?: number
    benefitDescription: string
    validUntil?: string
  }
  marketSignals: {
    id: string
    source: 'local_event' | 'seasonality' | 'competitor' | 'customer_trend' | 'weather'
    fact: string
    inference: string
    confidence: number
    observedAt: string
    expiresAt: string
  }[]
  constraints: {
    quietHoursStart: string
    quietHoursEnd: string
    maxActionsPerDay: number
    requireApprovalForPublicPost: boolean
    requireApprovalForPriceChange: boolean
  }
  priority: 'low' | 'medium' | 'high' | 'urgent'
  validFrom: string
  validTo: string
  reasoning: string
  alternativesConsidered: string[]
  expectedOutcomes: {
    metric: string
    targetValue: string | number
  }[]
  status: 'active' | 'archived' | 'superseded'
  createdAt: string
  updatedAt: string
}

export interface CustomerLifecycleRecord {
  customerId: string
  workspaceId: string
  name: string
  channel: 'instagram' | 'threads' | 'naver' | 'daangn' | 'phone' | 'walk_in'
  channelHandle?: string
  currentStage: CustomerLifecycleStage
  stageHistory: {
    stage: CustomerLifecycleStage
    changedAt: string
    reason: string
    triggerEventId?: string
  }[]
  inquiryCount: number
  bookingCount: number
  totalRevenue: number
  lastContactAt: string
  lastVisitAt?: string
  nextBestAction?: {
    actionType: 'reply_inquiry' | 'send_offer' | 'request_review' | 'reactivate_reminder' | 'handoff_owner'
    reason: string
    urgency: 'low' | 'medium' | 'high'
    suggestedPayload?: Record<string, unknown>
    requiresApproval: boolean
  }
  consentGiven: boolean
  cooldownUntil?: string
}

export interface MarketSignalRecord {
  id: string
  workspaceId: string
  source: 'local_event' | 'seasonality' | 'competitor' | 'customer_trend' | 'weather'
  title: string
  fact: string
  inference: string
  confidence: number // 0.0 ~ 1.0
  relevanceScore: number // 0.0 ~ 1.0
  observedAt: string
  expiresAt: string
  isDecayed: boolean
}

/**
 * Calculates current customer lifecycle stage based on chronological events
 */
export function deriveCustomerStage(events: {
  hasInquiry: boolean
  hasBooking: boolean
  hasPayment: boolean
  daysSinceLastVisit?: number
  isReactivated?: boolean
}): CustomerLifecycleStage {
  if (events.isReactivated) return 'reactivated'
  if (events.hasPayment && events.daysSinceLastVisit !== undefined && events.daysSinceLastVisit > 60) {
    return 'repeat_due'
  }
  if (events.hasPayment) return 'visited_paid'
  if (events.hasBooking) return 'booked'
  if (events.hasInquiry) return 'inquiry'
  return 'lead'
}

/**
 * Evaluates MarketSignal freshness & auto-decay
 */
export function evaluateSignalFreshness(signal: MarketSignalRecord, currentTime = new Date()): {
  isDecayed: boolean
  effectiveConfidence: number
} {
  const expires = new Date(signal.expiresAt).getTime()
  const now = currentTime.getTime()
  const observed = new Date(signal.observedAt).getTime()

  if (now >= expires) {
    return { isDecayed: true, effectiveConfidence: Math.max(0.1, signal.confidence * 0.3) }
  }

  // Linear decay over lifespan
  const totalLifespan = expires - observed
  const elapsed = now - observed
  const decayRatio = totalLifespan > 0 ? Math.max(0, 1 - (elapsed / totalLifespan) * 0.4) : 1

  return {
    isDecayed: false,
    effectiveConfidence: Number((signal.confidence * decayRatio).toFixed(2))
  }
}
