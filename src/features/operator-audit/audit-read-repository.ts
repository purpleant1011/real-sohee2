import 'server-only'

import { requireOperatorAnyScope, type OperatorAuthGateway } from '@/features/operator-auth/require-operator'
import { z } from 'zod'
import { redactAuditValue } from './redact-audit-value'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const action = z.string().min(1).max(120)
const rowSchema = z.object({
  id: uuid, workspace_id: uuid.nullable(), workspace_name: z.string().min(1).max(200).nullable(), action,
  target_type: z.string().min(1).max(80), target_label: z.string().max(120).nullable(),
  result: z.enum(['succeeded', 'failed', 'denied']), fact_kind: z.enum(['observed', 'user_claim', 'inference', 'unknown']),
  reason: z.string().min(1).max(2000), approval_request_id: uuid.nullable(), approval_status: z.enum(['none', 'pending', 'approved', 'rejected', 'applied', 'cancelled', 'expired', 'unknown']),
  before: z.record(z.string(), z.unknown()), after: z.record(z.string(), z.unknown()), created_at: timestamp,
  freshness: z.enum(['fresh', 'stale', 'unknown', 'empty', 'error']), linked_event_count: z.number().int().nonnegative(),
}).strict()
const responseSchema = z.object({ items: z.array(rowSchema), next_cursor: z.nullable(z.object({ created_at: timestamp, id: uuid }).strict()) }).strict()
const detailSchema = rowSchema.extend({ linked_events: z.array(z.object({ id: uuid, action, result: z.enum(['succeeded', 'failed', 'denied']), created_at: timestamp }).strict()) }).strict()
const filterSchema = z.object({
  from: timestamp.optional(), to: timestamp.optional(), workspaceId: uuid.optional(), actorId: uuid.optional(),
  action: action.optional(), result: z.enum(['succeeded', 'failed', 'denied']).optional(), factKind: z.enum(['observed', 'user_claim', 'inference', 'unknown']).optional(),
  targetType: z.string().min(1).max(80).optional(), cursor: z.string().max(1024).optional(), limit: z.number().int().min(1).max(100).default(50),
}).strict()

export type OperatorAuditReadRpcGateway = Readonly<{ rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> }>
export type OperatorAuditReadFilters = z.input<typeof filterSchema>
export type OperatorAuditReadEvent = Readonly<{
  id: string; workspaceId: string | null; workspaceName: string | null; action: string; targetType: string; targetLabel: string | null
  result: 'succeeded' | 'failed' | 'denied'; factKind: 'observed' | 'user_claim' | 'inference' | 'unknown'; reason: string
  approvalRequestId: string | null; approvalStatus: 'none' | 'pending' | 'approved' | 'rejected' | 'applied' | 'cancelled' | 'expired' | 'unknown'
  before: unknown; after: unknown; createdAt: string; freshness: 'fresh' | 'stale' | 'unknown' | 'empty' | 'error'; linkedEventCount: number
}>
export type OperatorAuditReadDetail = OperatorAuditReadEvent & Readonly<{ linkedEvents: readonly { id: string; action: string; result: 'succeeded' | 'failed' | 'denied'; createdAt: string }[] }>
type Result<T> = Readonly<{ data: T | null; error: 'AUDIT_INPUT_INVALID' | 'AUTH_REQUIRED' | 'MFA_REQUIRED' | 'OPERATOR_DISABLED' | 'PERMISSION_DENIED' | 'OPERATOR_SCOPE_DENIED' | 'AUDIT_READ_UNAVAILABLE' | null }>
type Dependencies = Readonly<{ gateway?: OperatorAuditReadRpcGateway; operatorGateway?: OperatorAuthGateway }>

async function productionGateway(): Promise<OperatorAuditReadRpcGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  return { rpc: (name, args) => (supabase as unknown as { rpc(n: string, a: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> }).rpc(name, args) }
}
function mapError(error: unknown): NonNullable<Result<unknown>['error']> {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  return ['AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'OPERATOR_SCOPE_DENIED'].includes(message) ? message as NonNullable<Result<unknown>['error']> : 'AUDIT_READ_UNAVAILABLE'
}
function mapRow(row: z.infer<typeof rowSchema>): OperatorAuditReadEvent {
  return { id: row.id, workspaceId: row.workspace_id, workspaceName: row.workspace_name, action: row.action, targetType: row.target_type, targetLabel: row.target_label, result: row.result, factKind: row.fact_kind, reason: row.reason, approvalRequestId: row.approval_request_id, approvalStatus: row.approval_status, before: redactAuditValue(row.before), after: redactAuditValue(row.after), createdAt: row.created_at, freshness: row.freshness, linkedEventCount: row.linked_event_count }
}

export async function listOperatorAuditEvents(filters: OperatorAuditReadFilters = {}, dependencies: Dependencies = {}): Promise<Result<Readonly<{ items: readonly OperatorAuditReadEvent[]; nextCursor: string | null }>>> {
  const parsed = filterSchema.safeParse(filters)
  if (!parsed.success || (parsed.data.from && parsed.data.to && Date.parse(parsed.data.from) > Date.parse(parsed.data.to))) return { data: null, error: 'AUDIT_INPUT_INVALID' }
  try {
    await requireOperatorAnyScope('audit.read', dependencies.operatorGateway)
    const cursor = parsed.data.cursor ? JSON.parse(Buffer.from(parsed.data.cursor, 'base64url').toString('utf8')) as { created_at?: string; id?: string } : null
    if (cursor && (!cursor.created_at || !uuid.safeParse(cursor.id).success)) return { data: null, error: 'AUDIT_INPUT_INVALID' }
    const result = await (dependencies.gateway ?? await productionGateway()).rpc('list_operator_audit_events', {
      p_from: parsed.data.from ?? null, p_to: parsed.data.to ?? null, p_workspace_id: parsed.data.workspaceId ?? null, p_actor_user_id: parsed.data.actorId ?? null,
      p_action: parsed.data.action ?? null, p_result: parsed.data.result ?? null, p_fact_kind: parsed.data.factKind ?? null, p_target_type: parsed.data.targetType ?? null,
      p_cursor_created_at: cursor?.created_at ?? null, p_cursor_id: cursor?.id ?? null, p_limit: parsed.data.limit,
    })
    if (result.error) return { data: null, error: mapError(result.error) }
    const wire = responseSchema.safeParse(result.data)
    if (!wire.success || wire.data.items.some((item) => parsed.data.workspaceId !== undefined && item.workspace_id !== parsed.data.workspaceId)) return { data: null, error: 'AUDIT_READ_UNAVAILABLE' }
    return { data: { items: wire.data.items.map(mapRow), nextCursor: wire.data.next_cursor ? Buffer.from(JSON.stringify(wire.data.next_cursor), 'utf8').toString('base64url') : null }, error: null }
  } catch (error) { return { data: null, error: mapError(error) }
  }
}

export async function getOperatorAuditEvent(eventId: string, dependencies: Dependencies = {}): Promise<Result<OperatorAuditReadDetail>> {
  if (!uuid.safeParse(eventId).success) return { data: null, error: 'AUDIT_INPUT_INVALID' }
  try {
    await requireOperatorAnyScope('audit.read', dependencies.operatorGateway)
    const result = await (dependencies.gateway ?? await productionGateway()).rpc('get_operator_audit_event_detail', { p_event_id: eventId })
    if (result.error) return { data: null, error: mapError(result.error) }
    const wire = detailSchema.safeParse(result.data)
    if (!wire.success) return { data: null, error: 'AUDIT_READ_UNAVAILABLE' }
    return { data: { ...mapRow(wire.data), linkedEvents: wire.data.linked_events.map((event) => ({ id: event.id, action: event.action, result: event.result, createdAt: event.created_at })) }, error: null }
  } catch (error) { return { data: null, error: mapError(error) }
  }
}
