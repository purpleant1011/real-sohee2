import 'server-only'

import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { supportSessionListSchema, supportSessionResponseSchema, type SupportSession, type SupportSessionErrorCode } from './support-session-schemas'

type RpcResult = Readonly<{ data: unknown; error: unknown }>
export type OperatorSupportSessionGateway = Readonly<{
  rpc(name: 'list_operator_support_sessions_v2', args: Readonly<{ p_workspace_id: string | null; p_limit: number }>): Promise<RpcResult>
}>
type Dependencies = Readonly<{ gateway: OperatorSupportSessionGateway }>
type Result = Readonly<{ data: readonly SupportSession[] | null; sourceState?: 'ready' | 'empty' | 'not_connected' | 'unavailable'; error: SupportSessionErrorCode | null }>

const inputSchema = z.object({ workspaceId: z.string().uuid().nullable(), limit: z.number().int().min(1).max(100) }).strict()
const safeErrors = new Set<SupportSessionErrorCode>(['SUPPORT_SESSION_INPUT_INVALID', 'SUPPORT_SESSION_READ_UNAVAILABLE', 'OPERATOR_UNAUTHENTICATED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'OPERATOR_SCOPE_DENIED'])

function safeError(error: unknown): SupportSessionErrorCode {
  const value = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  return safeErrors.has(value as SupportSessionErrorCode) ? value as SupportSessionErrorCode : 'SUPPORT_SESSION_READ_UNAVAILABLE'
}

async function productionGateway(): Promise<OperatorSupportSessionGateway> {
  const supabase = await createServerSupabaseClient()
  return { rpc: (name, args) => supabase.rpc(name as never, args as never) as unknown as Promise<RpcResult> }
}

export async function listOperatorSupportSessions(workspaceId?: string, dependencies?: Dependencies): Promise<Result> {
  const parsed = inputSchema.safeParse({ workspaceId: workspaceId ?? null, limit: 50 })
  if (!parsed.success) return { data: null, sourceState: 'unavailable', error: 'SUPPORT_SESSION_INPUT_INVALID' }
  let result: RpcResult
  try {
    result = await (dependencies?.gateway ?? await productionGateway()).rpc('list_operator_support_sessions_v2', { p_workspace_id: parsed.data.workspaceId, p_limit: parsed.data.limit })
  } catch (error) {
    return { data: null, sourceState: 'unavailable', error: safeError(error) }
  }
  if (result.error) return { data: null, sourceState: 'unavailable', error: safeError(result.error) }
  const wrapped = supportSessionResponseSchema.safeParse(result.data)
  const legacy = wrapped.success ? null : supportSessionListSchema.safeParse(result.data)
  const items = wrapped.success ? wrapped.data.items : legacy?.success ? legacy.data : null
  if (!items || (parsed.data.workspaceId !== null && items.some((item) => item.workspace_id !== parsed.data.workspaceId))) return { data: null, sourceState: 'unavailable', error: 'SUPPORT_SESSION_READ_UNAVAILABLE' }
  return {
    data: items.map((item) => ({ sessionId: item.session_id, workspaceId: item.workspace_id, operatorUserId: item.operator_user_id, mode: item.mode, status: item.status, reason: item.reason, closeReason: item.close_reason, startedAt: item.started_at, expiresAt: item.expires_at, closedAt: item.closed_at })),
    sourceState: wrapped.success ? wrapped.data.source_state ?? (items.length === 0 ? 'empty' : 'ready') : (items.length === 0 ? 'empty' : 'ready'), error: null,
  }
}
