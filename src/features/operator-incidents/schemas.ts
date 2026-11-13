import { z } from 'zod'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const safeCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
const safeEvidence = z.string().min(1).max(500)
const source = z.enum(['conversation_jobs', 'provider_webhooks', 'operation_events', 'cloudflare', 'queue', 'cron', 'release'])
const factKind = z.enum(['observed', 'user_claim', 'inference', 'unknown'])
const timelineEvent = z.object({
  id: uuid,
  event_type: z.enum(['opened', 'acknowledged', 'resolved', 'reopened', 'rollback_candidate_identified', 'recovery_verification_recorded']),
  fact_kind: factKind,
  reason: z.string().min(1).max(2000),
  version: z.number().int().positive(),
  resulting_status: z.enum(['open', 'acknowledged', 'resolved']),
  resulting_recovery_state: z.enum(['unknown', 'pending', 'verified', 'failed']),
  occurred_at: timestamp,
}).strict()

export const incidentWireSchema = z.object({
  id: uuid,
  source,
  source_state: z.enum(['healthy', 'degraded', 'error', 'empty', 'unknown']),
  source_freshness: z.enum(['fresh', 'stale', 'empty', 'unknown', 'error']),
  source_observed_at: timestamp.nullable(),
  title: z.string().min(1).max(200),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['open', 'acknowledged', 'resolved']),
  version: z.number().int().positive(),
  reason: z.string().min(1).max(2000),
  fact_kind: factKind,
  rollback_candidate_code: safeCode.nullable(),
  assignee_user_id: uuid.nullable(),
  assignee_display: z.string().max(320).nullable(),
  impact_scope: safeCode.nullable(),
  recovery_verified_at: timestamp.nullable(),
  recovery_evidence_summary: safeEvidence.nullable(),
  remediation_kind: z.enum(['rollback', 'prevention']).nullable(),
  remediation_result: safeEvidence.nullable(),
  recovery_state: z.enum(['unknown', 'pending', 'verified', 'failed']),
  opened_at: timestamp,
  updated_at: timestamp,
  freshness: z.enum(['fresh', 'stale', 'unknown', 'empty', 'error']),
  timeline: z.array(timelineEvent),
}).strict()

export const incidentResponseSchema = z.object({ items: z.array(incidentWireSchema) }).strict()
export type IncidentWire = z.infer<typeof incidentWireSchema>
export type OperatorIncident = Readonly<{
  id: string
  source: z.infer<typeof source>
  sourceState: IncidentWire['source_state']
  sourceFreshness: IncidentWire['source_freshness']
  sourceObservedAt: string | null
  title: string
  severity: IncidentWire['severity']
  status: IncidentWire['status']
  version: number
  reason: string
  factKind: z.infer<typeof factKind>
  rollbackCandidateCode: string | null
  assigneeUserId: string | null
  assigneeDisplay: string | null
  impactScope: string | null
  recoveryVerifiedAt: string | null
  recoveryEvidenceSummary: string | null
  remediationKind: 'rollback' | 'prevention' | null
  remediationResult: string | null
  recoveryState: IncidentWire['recovery_state']
  openedAt: string
  updatedAt: string
  freshness: IncidentWire['freshness']
  timeline: readonly Readonly<{ id: string; eventType: IncidentWire['timeline'][number]['event_type']; factKind: z.infer<typeof factKind>; reason: string; version: number; resultingStatus: 'open' | 'acknowledged' | 'resolved'; resultingRecoveryState: 'unknown' | 'pending' | 'verified' | 'failed'; occurredAt: string }>[]
}>
