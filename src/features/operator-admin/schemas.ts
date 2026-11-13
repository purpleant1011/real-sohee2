import { z } from 'zod'

const uuid = z.string().uuid()

export const operatorAdminFiltersSchema = z.object({
  status: z.enum(['invited', 'active', 'disabled']).optional(),
  roleKey: z.string().min(1).max(80).optional(),
  mfaState: z.enum(['required', 'enrolled', 'missing', 'unknown']).optional(),
  cursor: z.string().max(2048).optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict()

const scopeSummarySchema = z.object({
  kind: z.enum(['global', 'workspace', 'unknown']),
  workspace_count: z.number().int().nonnegative(),
}).strict()

export const operatorAdminRowSchema = z.object({
  user_id: uuid,
  email: z.string().max(320).nullable(),
  status: z.enum(['invited', 'active', 'disabled']),
  role_keys: z.array(z.string().min(1).max(80)),
  role_display_names: z.array(z.string().min(1).max(80)),
  scope_summary: scopeSummarySchema,
  mfa_required: z.boolean(),
  mfa_enrolled: z.boolean(),
  mfa_exception_state: z.enum(['none', 'active', 'expired', 'unknown']),
  mfa_exception_until: z.string().datetime({ offset: true }).nullable(),
  password_set_at: z.string().datetime({ offset: true }).nullable(),
  activated_at: z.string().datetime({ offset: true }).nullable(),
  last_reviewed_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  data_freshness: z.enum(['fresh', 'stale', 'unknown']),
  session_state: z.literal('unknown'),
  last_login_at: z.null(),
}).strict()

export const operatorAdminResponseSchema = z.object({
  items: z.array(operatorAdminRowSchema),
  next_cursor: z.object({
    created_at: z.string().datetime({ offset: true }),
    id: uuid,
  }).strict().nullable(),
}).strict()

export type OperatorAdminFilters = Readonly<z.input<typeof operatorAdminFiltersSchema>>
export type OperatorAdmin = Readonly<{
  userId: string
  email: string | null
  status: 'invited' | 'active' | 'disabled'
  roleKeys: readonly string[]
  roleDisplayNames: readonly string[]
  scopeSummary: Readonly<{ kind: 'global' | 'workspace' | 'unknown'; workspaceCount: number }>
  mfaRequired: boolean
  mfaEnrolled: boolean
  mfaExceptionState: 'none' | 'active' | 'expired' | 'unknown'
  mfaExceptionUntil: string | null
  passwordSetAt: string | null
  activatedAt: string | null
  lastReviewedAt: string | null
  createdAt: string
  updatedAt: string
  dataFreshness: 'fresh' | 'stale' | 'unknown'
  sessionState: 'unknown'
  lastLoginAt: null
}>
