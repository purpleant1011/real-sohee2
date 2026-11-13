import { z } from 'zod'
import { redactAuditValue } from './redact-audit-value'

export const adminApprovalActionTypes = [
  'agreement.verify',
  'channel.disconnect',
  'publish.retry',
  'credit.adjust',
  'admin.role.change.workspace',
  'admin.role.change.global',
  'audit.export.workspace',
  'audit.export.global',
] as const

export const adminApprovalAuditActions = adminApprovalActionTypes.flatMap((action) => [
  `${action}.requested`,
  `${action}.approved`,
]) as [`${typeof adminApprovalActionTypes[number]}.requested`, ...`${typeof adminApprovalActionTypes[number]}.${'requested' | 'approved'}`[]]

export const operatorAuditErrorCodes = [
  'AUTH_REQUIRED',
  'OPERATOR_DISABLED',
  'MFA_REQUIRED',
  'PERMISSION_DENIED',
  'WORKSPACE_SCOPE_DENIED',
  'OWNER_QUORUM_REQUIRED',
  'APPROVER_MUST_DIFFER',
  'PLATFORM_OWNER_REQUIRED',
  'APPROVAL_NOT_FOUND',
  'APPROVAL_STATE_CONFLICT',
  'APPROVAL_EXPIRED',
  'STALE_VERSION',
  'IDEMPOTENCY_CONFLICT',
  'AUDIT_INPUT_INVALID',
  'AUDIT_WRITE_UNAVAILABLE',
  'AUDIT_SOURCE_UNAVAILABLE',
] as const

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const safeJsonObjectSchema = z.record(z.string(), z.unknown())
const emptyJsonObjectSchema = z.object({}).strict()
const auditActionSchema = z.enum(adminApprovalAuditActions)
const approvalActionSchema = z.enum(adminApprovalActionTypes)

export const auditEventWireSchema = z.object({
  id: uuidSchema,
  actor_user_id: uuidSchema,
  workspace_id: uuidSchema.nullable(),
  action: auditActionSchema,
  target_type: z.string().min(1).max(80),
  target_id: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  request_id: z.string().min(1).max(128),
  result: z.enum(['succeeded', 'failed', 'denied']),
  fact_kind: z.enum(['observed', 'user_claim', 'inference', 'unknown']),
  before: safeJsonObjectSchema,
  after: safeJsonObjectSchema,
  idempotency_key: sha256Schema,
  approval_request_id: uuidSchema.nullable(),
  actor_role_snapshot: safeJsonObjectSchema.nullable(),
  created_at: timestampSchema,
}).strict()

export const adminApprovalRequestWireSchema = z.object({
  id: uuidSchema,
  workspace_id: uuidSchema.nullable(),
  action_type: approvalActionSchema,
  target_type: z.string().min(1).max(80),
  target_id: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  requested_by: uuidSchema,
  approved_by: uuidSchema.nullable(),
  status: z.enum(['pending', 'approved']),
  expected_version: z.number().int().nonnegative().nullable(),
  request_payload: safeJsonObjectSchema,
  result_summary: emptyJsonObjectSchema,
  semantic_fingerprint: sha256Schema,
  idempotency_key: sha256Schema,
  requested_at: timestampSchema,
  expires_at: timestampSchema,
  approved_at: timestampSchema.nullable(),
  applied_at: z.null(),
  rejected_at: z.null(),
  cancelled_at: z.null(),
}).strict().superRefine((value, context) => {
  const requestedAt = Date.parse(value.requested_at)
  const expiresAt = Date.parse(value.expires_at)
  if (!Number.isFinite(requestedAt) || !Number.isFinite(expiresAt) || expiresAt - requestedAt !== 86_400_000) {
    context.addIssue({ code: 'custom', path: ['expires_at'], message: 'expiry must be exactly 24 hours' })
  }
  const approvedFieldsMatch = value.status === 'approved'
    ? value.approved_by !== null && value.approved_at !== null
    : value.approved_by === null && value.approved_at === null
  if (!approvedFieldsMatch) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'approval status fields mismatch' })
  }
})

export type OperatorAuditErrorCode = typeof operatorAuditErrorCodes[number]
export type AuditEventWire = z.infer<typeof auditEventWireSchema>
export type AdminApprovalRequestWire = z.infer<typeof adminApprovalRequestWireSchema>
export type EffectiveApprovalStatus = AdminApprovalRequestWire['status'] | 'expired'

export function effectiveApprovalStatus(
  value: Pick<AdminApprovalRequestWire, 'status' | 'expires_at'>,
  now = new Date(),
): EffectiveApprovalStatus {
  return now.getTime() >= Date.parse(value.expires_at) ? 'expired' : value.status
}

export function normalizeAuditEvent(wire: AuditEventWire) {
  return Object.freeze({
    id: wire.id,
    actorUserId: wire.actor_user_id,
    workspaceId: wire.workspace_id,
    action: wire.action,
    targetType: wire.target_type,
    targetId: wire.target_id,
    reason: wire.reason,
    requestId: wire.request_id,
    result: wire.result,
    factKind: wire.fact_kind,
    before: redactAuditValue(wire.before),
    after: redactAuditValue(wire.after),
    idempotencyKey: wire.idempotency_key,
    approvalRequestId: wire.approval_request_id,
    actorRoleSnapshot: redactAuditValue(wire.actor_role_snapshot),
    createdAt: wire.created_at,
  })
}

export function normalizeApprovalRequest(wire: AdminApprovalRequestWire, now = new Date()) {
  return Object.freeze({
    id: wire.id,
    workspaceId: wire.workspace_id,
    actionType: wire.action_type,
    targetType: wire.target_type,
    targetId: wire.target_id,
    reason: wire.reason,
    requestedBy: wire.requested_by,
    approvedBy: wire.approved_by,
    status: wire.status,
    effectiveStatus: effectiveApprovalStatus(wire, now),
    expectedVersion: wire.expected_version,
    requestPayload: redactAuditValue(wire.request_payload),
    semanticFingerprint: wire.semantic_fingerprint,
    idempotencyKey: wire.idempotency_key,
    requestedAt: wire.requested_at,
    expiresAt: wire.expires_at,
    approvedAt: wire.approved_at,
  })
}
