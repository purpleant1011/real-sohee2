import { z } from 'zod'

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const safeCodeSchema = z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/)

export const operationEventTypeSchema = z.enum([
  'content.plan.created',
  'content.version.created',
  'content.review.requested',
  'content.approved',
  'content.approval.invalidated',
  'schedule.suggested',
  'schedule.confirmed',
  'publish.succeeded',
  'publish.failed',
  'publish.unknown',
  'report.snapshot.ready',
  'customer.conversation.needs_attention',
  'knowledge.conflict.detected',
  'harness.rule.candidate_created',
])

const commonEventShape = {
  id: uuidSchema,
  workspaceId: uuidSchema,
  eventKey: z.string().min(2).max(200).regex(/^[a-z0-9][a-z0-9:._/-]*$/),
  subjectType: z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/),
  subjectId: uuidSchema,
  occurredAt: timestampSchema,
} as const

function eventSchema<TType extends z.infer<typeof operationEventTypeSchema>, TShape extends z.ZodRawShape>(
  type: TType,
  payloadShape: TShape,
) {
  return z
    .object({
      ...commonEventShape,
      type: z.literal(type),
      payload: z.object(payloadShape).strict(),
    })
    .strict()
}

export const operationEventSchema = z.discriminatedUnion('type', [
  eventSchema('content.plan.created', {
    workItemId: uuidSchema,
  }),
  eventSchema('content.version.created', {
    contentItemId: uuidSchema,
    versionNumber: z.number().int().positive(),
  }),
  eventSchema('content.review.requested', {
    contentItemId: uuidSchema,
    contentVersionId: uuidSchema,
  }),
  eventSchema('content.approved', {
    contentItemId: uuidSchema,
    contentVersionId: uuidSchema,
    approvalId: uuidSchema,
  }),
  eventSchema('content.approval.invalidated', {
    contentItemId: uuidSchema,
    contentVersionId: uuidSchema,
    reasonCode: z.enum(['current_version_changed', 'approval_revoked']),
  }),
  eventSchema('schedule.suggested', {
    workItemId: uuidSchema,
    startsAt: timestampSchema,
  }),
  eventSchema('schedule.confirmed', {
    scheduleId: uuidSchema,
    contentVersionId: uuidSchema.nullable(),
  }),
  eventSchema('publish.succeeded', {
    attemptId: uuidSchema,
    contentVersionId: uuidSchema,
    providerMode: z.enum(['mock', 'live']),
  }),
  eventSchema('publish.failed', {
    attemptId: uuidSchema,
    contentVersionId: uuidSchema,
    errorCode: safeCodeSchema,
  }),
  eventSchema('publish.unknown', {
    attemptId: uuidSchema,
    contentVersionId: uuidSchema,
    errorCode: safeCodeSchema,
    recoveryStatus: z.literal('reconcile_required'),
  }),
  eventSchema('report.snapshot.ready', {
    snapshotId: uuidSchema,
    sourceType: z.enum(['real', 'partial', 'mock']),
  }),
  eventSchema('customer.conversation.needs_attention', {
    customerConversationId: uuidSchema,
    reasonCode: z.enum(['unanswered', 'high_risk', 'manual_review']),
  }),
  eventSchema('knowledge.conflict.detected', {
    candidateId: uuidSchema,
    conflictingFactId: uuidSchema,
  }),
  eventSchema('harness.rule.candidate_created', {
    ruleId: uuidSchema,
    sourceMessageId: uuidSchema.nullable(),
  }),
])

export type OperationEventType = z.infer<typeof operationEventTypeSchema>
export type OperationEvent = Readonly<z.infer<typeof operationEventSchema>>
