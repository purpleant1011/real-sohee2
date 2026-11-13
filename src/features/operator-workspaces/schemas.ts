import { z } from 'zod'

export const workspaceIdSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
export const workspaceKindSchema = z.enum(['pilot', 'production', 'demo', 'integration'])
export const lifecycleStatusSchema = z.enum(['applied','information_pending','contract_review','consent_pending','channel_pending','payment_pending','ready_for_activation','active','paused','terminated'])
export const agreementStatusSchema = z.enum(['accepted', 'partial', 'missing', 'unknown'])
export const memberStatusSchema = z.enum(['FORMAL', 'APPLICANT'])
export const memberFilterSchema = z.enum(['formal', 'applicant', 'all'])

export const operatorWorkspaceItemSchema = z.object({
  workspace_id: workspaceIdSchema,
  workspace_name: z.string().min(1).max(200),
  timezone: z.string().min(1).max(80),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  workspace_kind: workspaceKindSchema,
  business_name: z.string().max(240).nullable(),
  lifecycle_status: lifecycleStatusSchema.nullable(),
  agreement_status: agreementStatusSchema,
  plan_code: z.string().min(1).max(80).nullable(),
  member_count: z.number().int().nonnegative(),
  available_credits: z.number().int().nullable(),
  instagram_status: z.string().min(1).max(80),
  threads_status: z.string().min(1).max(80),
  published_this_month: z.number().int().nonnegative(),
  failed_this_month: z.number().int().nonnegative(),
  last_activity_at: timestampSchema.nullable(),
  data_freshness: z.enum(['fresh', 'stale', 'unknown']),
  member_status: memberStatusSchema.default('APPLICANT'),
  source_timestamps: z.object({
    workspace: timestampSchema.nullable(),
    business: timestampSchema.nullable(),
    instagram: timestampSchema.nullable(),
    threads: timestampSchema.nullable(),
    publish: timestampSchema.nullable(),
  }).strict(),
}).strict()

export const memberAggregateSchema = z.object({
  role: z.string().min(1).max(80),
  status: z.string().min(1).max(80),
  count: z.number().int().nonnegative(),
  created_at: timestampSchema.nullable(),
  updated_at: timestampSchema.nullable(),
}).strict()

export const detailChannelSchema = z.object({
  workspace_id: workspaceIdSchema,
  channel: z.string().min(1).max(80),
  status: z.string().min(1).max(80),
  webhook_status: z.string().min(1).max(80),
  token_expires_at: timestampSchema.nullable(),
  last_webhook_at: timestampSchema.nullable(),
  last_provider_event_at: timestampSchema.nullable(),
  last_error_code: z.string().max(120).nullable(),
  updated_at: timestampSchema,
}).strict()

export const knowledgeReadinessSchema = z.object({
  factsConfirmedCount: z.number().int().min(0).nullable(),
  factsPendingCount: z.number().int().min(0).nullable(),
  materialsExtractedCount: z.number().int().min(0).nullable(),
  materialsProcessingCount: z.number().int().min(0).nullable(),
  materialsFailedCount: z.number().int().min(0).nullable(),
  materialsTotalCount: z.number().int().min(0).nullable(),
  structuredFactsCount: z.number().int().min(0).nullable(),
  productsServicesStatus: z.enum(['not_supported', 'available', 'error']),
  telemetry: z.literal('not_collected'),
  lastUpdatedAt: z.string().nullable(),
  errors: z.array(z.string()).optional(),
}).strict()

export type KnowledgeReadiness = z.infer<typeof knowledgeReadinessSchema>

export const operatorWorkspaceKnowledgeSchema = z.object({
  placeUrl: z.string().nullable(),
  placeStatus: z.string().nullable(),
  businessName: z.string().nullable(),
  industry: z.string().nullable(),
  location: z.string().nullable(),
  summary: z.string().nullable(),
  updatedAt: z.string().nullable(),
  readiness: knowledgeReadinessSchema.nullable().optional(),
}).strict()

export type OperatorWorkspaceKnowledge = Readonly<{
  placeUrl: string | null
  placeStatus: string | null
  businessName: string | null
  industry: string | null
  location: string | null
  summary: string | null
  updatedAt: string | null
  readiness?: KnowledgeReadiness | null
}>

export const operatorWorkspaceDetailSchema = operatorWorkspaceItemSchema.extend({
  member_aggregates: z.array(memberAggregateSchema),
  channels: z.array(detailChannelSchema),
}).strict()

export const listInputSchema = z.object({
  cursor: z.string().nullable(),
  query: z.string().max(120).nullable(),
  status: lifecycleStatusSchema.nullable(),
  member: memberFilterSchema.nullable().optional(),
  limit: z.number().int().min(1).max(100),
}).strict()

const rpcCursorSchema = z.object({
  created_at: timestampSchema,
  id: workspaceIdSchema,
  cursor_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const listRpcResponseSchema = z.object({
  items: z.array(operatorWorkspaceItemSchema),
  next_cursor: rpcCursorSchema.nullable(),
}).strict()

export const clientCursorSchema = rpcCursorSchema.extend({
  query: z.string().nullable(),
  status: lifecycleStatusSchema.nullable(),
  member: memberFilterSchema.nullable().optional(),
}).strict()

export type OperatorWorkspaceSummary = Readonly<{
  workspaceId: string
  workspaceName: string
  timezone: string
  createdAt: string
  updatedAt: string
  workspaceKind: z.infer<typeof workspaceKindSchema>
  lifecycleStatus: z.infer<typeof lifecycleStatusSchema> | null
  businessName: string | null
  agreementStatus: z.infer<typeof agreementStatusSchema>
  planCode: string | null
  memberCount: number
  availableCredits: number | null
  instagramStatus: string
  threadsStatus: string
  publishedThisMonth: number
  failedThisMonth: number
  lastActivityAt: string | null
  dataFreshness: 'fresh' | 'stale' | 'unknown'
  memberStatus: z.infer<typeof memberStatusSchema>
}>

export type WorkspaceListResult = Readonly<{
  items: readonly OperatorWorkspaceSummary[]
  nextCursor: string | null
}>

export type WorkspaceErrorCode =
  | 'AUTH_REQUIRED'
  | 'MFA_REQUIRED'
  | 'OPERATOR_DISABLED'
  | 'PERMISSION_DENIED'
  | 'OPERATOR_SCOPE_DENIED'
  | 'WORKSPACE_INPUT_INVALID'
  | 'CURSOR_INVALID'
  | 'WORKSPACE_LIST_UNAVAILABLE'
  | 'WORKSPACE_DETAIL_UNAVAILABLE'

export type OperatorWorkspaceDetail = OperatorWorkspaceSummary & Readonly<{
  memberAggregates: readonly z.infer<typeof memberAggregateSchema>[]
  channels: readonly z.infer<typeof detailChannelSchema>[]
}>

export { timestampSchema }
