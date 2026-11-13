import { z } from 'zod'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const supportStatus = z.enum(['active', 'ended', 'expired', 'revoked'])

export const supportSessionWireSchema = z.object({
  session_id: uuid,
  workspace_id: uuid,
  operator_user_id: uuid,
  mode: z.literal('view_only'),
  status: supportStatus,
  reason: z.string().min(1).max(2000),
  close_reason: z.string().min(1).max(2000).nullable(),
  started_at: timestamp,
  expires_at: timestamp,
  closed_at: timestamp.nullable(),
}).strict()

export const supportSessionListSchema = z.array(supportSessionWireSchema)
export const supportSessionResponseSchema = z.object({ items: z.array(supportSessionWireSchema), source_state: z.enum(['ready', 'empty', 'not_connected']).optional() }).strict()

export type SupportSession = Readonly<{
  sessionId: string
  workspaceId: string
  operatorUserId: string
  mode: 'view_only'
  status: z.infer<typeof supportStatus>
  reason: string
  closeReason: string | null
  startedAt: string
  expiresAt: string
  closedAt: string | null
}>
export type SupportSessionErrorCode = 'SUPPORT_SESSION_INPUT_INVALID' | 'SUPPORT_SESSION_READ_UNAVAILABLE' | 'OPERATOR_UNAUTHENTICATED' | 'MFA_REQUIRED' | 'OPERATOR_DISABLED' | 'OPERATOR_SCOPE_DENIED'
