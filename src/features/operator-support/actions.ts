'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const uuid = z.string().uuid()
const startInput = z.object({ workspaceId: uuid, reason: z.string().trim().min(1).max(2000), idempotencyKey: uuid }).strict()
const sessionInput = z.object({ sessionId: uuid, idempotencyKey: uuid }).strict()
const revokeInput = sessionInput.extend({ reason: z.string().trim().min(1).max(2000) }).strict()
type SupportActionData = Readonly<{ sessionId: string; status: 'active' | 'ended' | 'expired' | 'revoked'; replayed: boolean }>
type SupportActionResult = ActionResult<SupportActionData>

function failure(requestId: string): SupportActionResult { return { error: { requestId, message: '지원 세션 처리를 완료하지 못했습니다. 다시 시도해 주세요.' } } }

async function call(requestId: string, name: string, args: Record<string, unknown>): Promise<SupportActionResult> {
  try {
    const supabase = await createServerSupabaseClient()
    const result = await supabase.rpc(name as never, args as never) as unknown as { data: unknown; error: unknown }
    if (result.error || !result.data || typeof result.data !== 'object' || !('session_id' in result.data) || !('status' in result.data) || !('replayed' in result.data)) return failure(requestId)
    const data = result.data as { session_id: unknown; status: unknown; replayed: unknown }
    if (typeof data.session_id !== 'string' || !['active', 'ended', 'expired', 'revoked'].includes(String(data.status)) || typeof data.replayed !== 'boolean') return failure(requestId)
    return { data: { sessionId: data.session_id, status: data.status as SupportActionData['status'], replayed: data.replayed } }
  } catch { return failure(requestId) }
}

export async function startOperatorSupportSessionAction(input: unknown): Promise<SupportActionResult> {
  const parsed = startInput.safeParse(input)
  if (!parsed.success) return failure('support-session-start')
  return call('support-session-start', 'start_operator_support_session', { p_workspace_id: parsed.data.workspaceId, p_reason: parsed.data.reason, p_idempotency_key: parsed.data.idempotencyKey })
}

export async function endOperatorSupportSessionAction(input: unknown): Promise<SupportActionResult> {
  const parsed = sessionInput.safeParse(input)
  if (!parsed.success) return failure('support-session-end')
  return call('support-session-end', 'end_operator_support_session', { p_session_id: parsed.data.sessionId, p_idempotency_key: parsed.data.idempotencyKey })
}

export async function revokeOperatorSupportSessionAction(input: unknown): Promise<SupportActionResult> {
  const parsed = revokeInput.safeParse(input)
  if (!parsed.success) return failure('support-session-revoke')
  return call('support-session-revoke', 'revoke_operator_support_session', { p_session_id: parsed.data.sessionId, p_reason: parsed.data.reason, p_idempotency_key: parsed.data.idempotencyKey })
}

export async function expireOperatorSupportSessionAction(input: unknown): Promise<SupportActionResult> {
  const parsed = sessionInput.safeParse(input)
  if (!parsed.success) return failure('support-session-expire')
  return call('support-session-expire', 'expire_operator_support_session', { p_session_id: parsed.data.sessionId, p_idempotency_key: parsed.data.idempotencyKey })
}
