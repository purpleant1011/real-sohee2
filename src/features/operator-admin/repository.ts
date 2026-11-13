import 'server-only'

import { z } from 'zod'
import { requireOperatorAnyScope, type OperatorAuthGateway } from '@/features/operator-auth/require-operator'
import {
  operatorAdminFiltersSchema,
  operatorAdminResponseSchema,
  type OperatorAdmin,
  type OperatorAdminFilters,
} from './schemas'

export type { OperatorAdmin } from './schemas'

type RpcResult = Readonly<{ data: unknown; error: unknown }>
type Gateway = Readonly<{ rpc(name: 'list_operator_admins', args: Readonly<Record<string, unknown>>): Promise<RpcResult> }>
type Dependencies = Readonly<{ gateway?: Gateway; operatorGateway?: OperatorAuthGateway }>
type Cursor = Readonly<{ created_at: string; id: string }>

export type OperatorAdminError =
  | 'ADMIN_INPUT_INVALID'
  | 'AUTH_REQUIRED'
  | 'MFA_REQUIRED'
  | 'OPERATOR_DISABLED'
  | 'PERMISSION_DENIED'
  | 'WORKSPACE_SCOPE_DENIED'
  | 'ADMIN_CURSOR_INVALID'
  | 'ADMIN_LIST_UNAVAILABLE'

export type OperatorAdminPage = Readonly<{ items: readonly OperatorAdmin[]; nextCursor: string | null }>
type Result = Readonly<{ data: OperatorAdminPage | null; error: OperatorAdminError | null }>

const cursorSchema = z.object({
  created_at: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
}).strict()

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(value: string): Cursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new Error('ADMIN_CURSOR_INVALID')
  }
  const result = cursorSchema.safeParse(parsed)
  if (!result.success) throw new Error('ADMIN_CURSOR_INVALID')
  return result.data
}

async function productionGateway(): Promise<Gateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  return {
    rpc: (name, args) => (supabase as unknown as { rpc(rpcName: string, rpcArgs: Record<string, unknown>): Promise<RpcResult> }).rpc(name, args),
  }
}

function mapError(error: unknown): OperatorAdminError {
  const message = error instanceof Error ? error.message : ''
  if (message === 'AUTH_REQUIRED') return 'AUTH_REQUIRED'
  if (message === 'MFA_REQUIRED') return 'MFA_REQUIRED'
  if (message === 'OPERATOR_DISABLED') return 'OPERATOR_DISABLED'
  if (message === 'PERMISSION_DENIED') return 'PERMISSION_DENIED'
  if (message === 'WORKSPACE_SCOPE_DENIED') return 'WORKSPACE_SCOPE_DENIED'
  if (message === 'ADMIN_CURSOR_INVALID') return 'ADMIN_CURSOR_INVALID'
  return 'ADMIN_LIST_UNAVAILABLE'
}

function normalize(row: z.infer<typeof operatorAdminResponseSchema>['items'][number]): OperatorAdmin {
  return {
    userId: row.user_id,
    email: row.email,
    status: row.status,
    roleKeys: row.role_keys,
    roleDisplayNames: row.role_display_names,
    scopeSummary: { kind: row.scope_summary.kind, workspaceCount: row.scope_summary.workspace_count },
    mfaRequired: row.mfa_required,
    mfaEnrolled: row.mfa_enrolled,
    mfaExceptionState: row.mfa_exception_state,
    mfaExceptionUntil: row.mfa_exception_until,
    passwordSetAt: row.password_set_at,
    activatedAt: row.activated_at,
    lastReviewedAt: row.last_reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dataFreshness: row.data_freshness,
    sessionState: row.session_state,
    lastLoginAt: row.last_login_at,
  }
}

export async function listOperatorAdmins(filters: OperatorAdminFilters = {}, dependencies: Dependencies = {}): Promise<Result> {
  const parsed = operatorAdminFiltersSchema.safeParse(filters)
  if (!parsed.success) return { data: null, error: 'ADMIN_INPUT_INVALID' }

  try {
    await requireOperatorAnyScope('admin.read', dependencies.operatorGateway)
    const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null
    const gateway = dependencies.gateway ?? await productionGateway()
    const result = await gateway.rpc('list_operator_admins', {
      p_status: parsed.data.status ?? null,
      p_role_key: parsed.data.roleKey ?? null,
      p_mfa_state: parsed.data.mfaState ?? null,
      p_cursor_created_at: cursor?.created_at ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_limit: parsed.data.limit,
    })
    if (result.error) return { data: null, error: 'ADMIN_LIST_UNAVAILABLE' }
    const wire = operatorAdminResponseSchema.safeParse(result.data)
    if (!wire.success) return { data: null, error: 'ADMIN_LIST_UNAVAILABLE' }
    return {
      data: {
        items: wire.data.items.map(normalize),
        nextCursor: wire.data.next_cursor ? encodeCursor(wire.data.next_cursor) : null,
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}
