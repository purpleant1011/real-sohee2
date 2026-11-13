import { z } from 'zod'
import { parseNaverBlogPostUrl } from '@/features/naver-publish/blog-url'

const uuid = z.string().uuid()
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
const targetExternalId = z.string().regex(/^[A-Za-z0-9_.-]{2,80}$/)

export const executionScopeRefSchema = z.object({ scopeId: uuid, actionId: uuid }).strict()
export type ExecutionScopeRef = Readonly<z.infer<typeof executionScopeRefSchema>>

export const connectorClaimBodySchema = z.union([executionScopeRefSchema, z.object({}).strict()])
export const executionScopeSelectionSchema = z.object({ actionId: uuid, connectionId: uuid, fingerprint, requestId: uuid }).strict()
export const executionCandidateQuerySchema = z.object({ contentId: uuid, versionId: uuid, connectionId: uuid, fingerprint }).strict()

export const executionScopeAuthorizationSchema = executionScopeRefSchema.extend({
  deviceId: uuid,
  targetExternalId,
  expiresAt: z.string().datetime({ offset: true }),
}).strict()

export const deviceExecutionScopeSchema = z.union([
  z.null(),
  z.object({ mode: z.literal('recovery_required') }).strict(),
  executionScopeRefSchema.extend({ mode: z.literal('targeted'), targetExternalId }).strict(),
])
export type DeviceExecutionScope = Readonly<z.infer<typeof deviceExecutionScopeSchema>>

export const checkpointRecoveryRequestSchema = z.object({ leaseId: uuid, mayHaveSubmitted: z.boolean() }).strict()
export const checkpointRecoverySchema = z.object({
  state: z.enum(['recovered_before_submit', 'terminal', 'reconcile_required', 'blocked']),
}).strict()
export type CheckpointRecovery = Readonly<z.infer<typeof checkpointRecoverySchema>>

const observedNaverUrl = z.string().url().max(2_048).refine((value) => parseNaverBlogPostUrl(value) !== null)
export const executionCandidateSchema = z.object({
  actionId: uuid,
  status: z.enum(['ready', 'prepared', 'executing', 'submitted', 'succeeded', 'failed', 'unknown_result', 'reconfirmation_required']),
  targetExternalId,
  resultUrl: observedNaverUrl.nullable(),
}).strict().superRefine((value, context) => {
  const result = value.resultUrl ? parseNaverBlogPostUrl(value.resultUrl) : null
  if (result && result.blogId.toLowerCase() !== value.targetExternalId.toLowerCase()) {
    context.addIssue({ code: 'custom', path: ['resultUrl'], message: 'result target mismatch' })
  }
})
export type ExecutionCandidate = Readonly<z.infer<typeof executionCandidateSchema>>
