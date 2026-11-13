import { z } from 'zod'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true }).nullable()
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u).nullable()

export const publishDisplayStateSchema = z.enum(['pending', 'publishing', 'success', 'failure', 'unknown'])
export const publishFreshnessSchema = z.enum(['fresh', 'stale', 'unknown'])

export const publishOperationWireSchema = z.object({
  workspace_id: uuid,
  workspace_name: z.string().min(1).max(200),
  content_id: uuid,
  content_title: z.string().min(1).max(200),
  channel: z.string().min(1).max(80),
  current_version_id: uuid.nullable(),
  current_version_number: z.number().int().positive().nullable(),
  current_fingerprint: fingerprint,
  approval_id: uuid.nullable(),
  approved_version_id: uuid.nullable(),
  approved_version_number: z.number().int().positive().nullable(),
  approval_fingerprint: fingerprint,
  approval_status: z.enum(['approved', 'rejected']).nullable(),
  approval_decided_at: timestamp,
  fingerprint_match: z.boolean(),
  schedule_id: uuid.nullable(),
  publish_at: timestamp,
  timezone: z.string().min(1).max(64).nullable(),
  schedule_status: z.enum(['scheduled', 'publishing', 'published', 'failed', 'unknown', 'cancelled']).nullable(),
  display_state: publishDisplayStateSchema,
  attempt_number: z.number().int().positive().nullable(),
  attempt_status: z.enum(['pending', 'succeeded', 'failed', 'unknown']).nullable(),
  provider_reference_present: z.boolean(),
  provider_request_id_present: z.boolean(),
  failure_code: z.enum(['TEMPORARY_NETWORK', 'RATE_LIMITED', 'TOKEN_EXPIRED', 'APPROVAL_STALE', 'PROVIDER_REJECTED', 'RESULT_UNKNOWN', 'LEASE_EXPIRED']).nullable(),
  recovery_status: z.enum(['reconcile_required', 'retry_ready']).nullable(),
  idempotency_result: z.enum(['recorded', 'not_recorded']),
  destination_url_present: z.boolean(),
  published_at: timestamp,
  freshness: publishFreshnessSchema,
}).strict()

export const publishReadResponseSchema = z.object({
  items: z.array(publishOperationWireSchema),
  next_cursor: z.object({ created_at: z.string().datetime({ offset: true }), id: uuid, cursor_fingerprint: z.string().regex(/^[a-f0-9]{64}$/u) }).nullable(),
}).strict()

export type PublishOperationWire = z.infer<typeof publishOperationWireSchema>
export type PublishDisplayState = z.infer<typeof publishDisplayStateSchema>
export type PublishFreshness = z.infer<typeof publishFreshnessSchema>

export type PublishOperation = Readonly<{
  workspaceId: string
  workspaceName: string
  contentId: string
  contentTitle: string
  channel: string
  currentVersionId: string | null
  currentVersionNumber: number | null
  currentFingerprint: string | null
  approvalId: string | null
  approvedVersionId: string | null
  approvedVersionNumber: number | null
  approvalFingerprint: string | null
  approvalStatus: 'approved' | 'rejected' | null
  approvalDecidedAt: string | null
  fingerprintMatch: boolean
  scheduleId: string | null
  publishAt: string | null
  timezone: string | null
  scheduleStatus: PublishOperationWire['schedule_status']
  displayState: PublishDisplayState
  attemptNumber: number | null
  attemptStatus: PublishOperationWire['attempt_status']
  providerReferencePresent: boolean
  providerRequestIdPresent: boolean
  failureCode: PublishOperationWire['failure_code']
  recoveryStatus: PublishOperationWire['recovery_status']
  idempotencyResult: 'recorded' | 'not_recorded'
  destinationUrlPresent: boolean
  publishedAt: string | null
  freshness: PublishFreshness
}>

export function normalizePublishOperation(row: PublishOperationWire): PublishOperation {
  return Object.freeze({
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    contentId: row.content_id,
    contentTitle: row.content_title,
    channel: row.channel,
    currentVersionId: row.current_version_id,
    currentVersionNumber: row.current_version_number,
    currentFingerprint: row.current_fingerprint,
    approvalId: row.approval_id,
    approvedVersionId: row.approved_version_id,
    approvedVersionNumber: row.approved_version_number,
    approvalFingerprint: row.approval_fingerprint,
    approvalStatus: row.approval_status,
    approvalDecidedAt: row.approval_decided_at,
    fingerprintMatch: row.fingerprint_match,
    scheduleId: row.schedule_id,
    publishAt: row.publish_at,
    timezone: row.timezone,
    scheduleStatus: row.schedule_status,
    displayState: row.display_state,
    attemptNumber: row.attempt_number,
    attemptStatus: row.attempt_status,
    providerReferencePresent: row.provider_reference_present,
    providerRequestIdPresent: row.provider_request_id_present,
    failureCode: row.failure_code,
    recoveryStatus: row.recovery_status,
    idempotencyResult: row.idempotency_result,
    destinationUrlPresent: row.destination_url_present,
    publishedAt: row.published_at,
    freshness: row.freshness,
  })
}
