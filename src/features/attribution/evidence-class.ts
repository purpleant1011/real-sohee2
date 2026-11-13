import 'server-only'

export type AttributionEvidenceClass = 'VERIFIED' | 'INFERRED' | 'UNKNOWN'

export type MetricType =
  | 'conversions'
  | 'reservations'
  | 'revenue_krw'
  | 'inbound_conversations'
  | 'engagement'

export type MetricSourceKind =
  | 'booking'
  | 'payment'
  | 'webhook_event'
  | 'platform_receipt'
  | 'estimated_trend'
  | 'unknown'

export interface AttributedMetric {
  metricId: string
  metricType: MetricType
  evidenceClass: AttributionEvidenceClass
  value: number
  sourceKind: MetricSourceKind
  sourceId?: string | null
  evidenceRefs: string[]
  timestamp: string
}

export interface AttributionLineage {
  workspaceId: string
  missionId: string
  traceId: string
  contentItemId?: string | null
  providerPostReference?: string | null
  externalActionReceiptId?: string | null
  customerId?: string | null
  bookingId?: string | null
}

export interface MetricAggregationResult {
  verifiedTotal: number
  inferredTotal: number
  unknownTotal: number
  hasVerifiedEvidence: boolean
  sourceEvidenceRefs: string[]
}

/**
 * Strict Law: Source-less ROAS/conversions/revenue must NEVER be counted as verified.
 * Calculates totals categorized strictly by evidence class.
 */
export function aggregateMetricsByEvidenceClass(
  metrics: readonly AttributedMetric[]
): MetricAggregationResult {
  let verifiedTotal = 0
  let inferredTotal = 0
  let unknownTotal = 0
  const evidenceRefsSet = new Set<string>()

  for (const m of metrics) {
    if (m.evidenceClass === 'VERIFIED') {
      verifiedTotal += m.value
      for (const ref of m.evidenceRefs) {
        if (ref) evidenceRefsSet.add(ref)
      }
    } else if (m.evidenceClass === 'INFERRED') {
      inferredTotal += m.value
    } else {
      unknownTotal += m.value
    }
  }

  return {
    verifiedTotal,
    inferredTotal,
    unknownTotal,
    hasVerifiedEvidence: verifiedTotal > 0,
    sourceEvidenceRefs: Array.from(evidenceRefsSet),
  }
}

/**
 * Evaluates whether a given metric record qualifies as VERIFIED evidence.
 * A metric is ONLY verified if it has a durable primary source (e.g. bookingId, receiptId).
 */
export function resolveEvidenceClass(input: {
  sourceKind: MetricSourceKind
  sourceId?: string | null
  evidenceRefs?: string[]
}): AttributionEvidenceClass {
  const { sourceKind, sourceId, evidenceRefs = [] } = input

  // If no source ID or source is purely estimated/unknown -> UNKNOWN or INFERRED
  if (!sourceId || sourceKind === 'unknown') {
    return 'UNKNOWN'
  }

  if (sourceKind === 'estimated_trend') {
    return 'INFERRED'
  }

  // Authoritative sources with concrete proof
  if (
    (sourceKind === 'booking' || sourceKind === 'payment' || sourceKind === 'platform_receipt' || sourceKind === 'webhook_event') &&
    sourceId &&
    evidenceRefs.length > 0
  ) {
    return 'VERIFIED'
  }

  // Has sourceId but lacks evidence refs -> INFERRED
  return 'INFERRED'
}
