'use server'

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { ActionResult } from '@/lib/errors/result'

const requestSchema = z.object({ actionType: z.enum(['admin.invite', 'admin.deactivate', 'admin.role.change.workspace', 'admin.role.change.global']), targetId: z.string().min(1).max(120), reason: z.string().trim().min(1).max(2000), expectedVersion: z.coerce.number().int().positive().nullable().optional(), nextRoleKey: z.enum(['platform_owner', 'operations_admin', 'customer_support', 'content_operator', 'billing_admin', 'system_admin', 'audit_viewer']).optional() }).strict()
const result = <T = { approvalRequestId: string }>(message: string): ActionResult<T> => ({ error: { message, requestId: 'admin-approval-request' } })

export async function requestAdminApproval(input: unknown): Promise<ActionResult<{ approvalRequestId: string }>> {
  if (input instanceof FormData) {
    const values = Object.fromEntries(input.entries())
    input = { ...values, expectedVersion: values.expectedVersion === '' ? null : values.expectedVersion }
  }
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) return result('관리자 승인 요청 내용을 확인해 주세요.')
  if (parsed.data.actionType.startsWith('admin.role.change') && !parsed.data.nextRoleKey) return result('변경할 역할을 선택해 주세요.')
  if (parsed.data.actionType === 'admin.invite' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(parsed.data.targetId)) return result('초대 이메일을 확인해 주세요.')
  try {
    const client = await createServerSupabaseClient() as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }
    const isInvite = parsed.data.actionType === 'admin.invite'
    const targetId = isInvite ? createHash('sha256').update(parsed.data.targetId.trim().toLowerCase()).digest('hex') : parsed.data.targetId
    const payload = isInvite ? { email_hash: targetId } : parsed.data.actionType.startsWith('admin.role.change') ? { next_role_key: parsed.data.nextRoleKey } : {}
    const rpcName = parsed.data.actionType.startsWith('admin.role.change') ? 'request_admin_approval' : 'request_admin_account_approval'
    const args = parsed.data.actionType.startsWith('admin.role.change')
      ? { p_workspace_id: null, p_action_type: parsed.data.actionType, p_target_type: 'platform_admin_role_assignment', p_target_id: targetId, p_reason: parsed.data.reason, p_idempotency_key: randomBytes(32).toString('hex'), p_expected_version: parsed.data.expectedVersion ?? null, p_request_payload: payload }
      : { p_action_type: parsed.data.actionType, p_target_id: targetId, p_reason: parsed.data.reason, p_idempotency_key: randomBytes(32).toString('hex'), p_expected_version: parsed.data.expectedVersion ?? null, p_request_payload: payload }
    const { data, error } = await client.rpc(rpcName, args)
    if (error || !data || typeof data !== 'object' || typeof (data as { approval_request_id?: unknown }).approval_request_id !== 'string') return result('관리자 승인 요청을 만들지 못했습니다.')
    return { data: { approvalRequestId: (data as { approval_request_id: string }).approval_request_id } }
  } catch { return result('관리자 승인 요청을 만들지 못했습니다.') }
}

export async function requestAdminApprovalAction(_previous: ActionResult<{ approvalRequestId: string }> | null, formData: FormData): Promise<ActionResult<{ approvalRequestId: string }>> {
  return requestAdminApproval(formData)
}

export async function approveAdminApprovalAction(approvalRequestId: string): Promise<ActionResult<{ status: string }>> {
  if (!/^[0-9a-f-]{36}$/u.test(approvalRequestId)) return result<{ status: string }>('승인 요청 식별자를 확인해 주세요.')
  try {
    const client = await createServerSupabaseClient() as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }
    const { data, error } = await client.rpc('approve_admin_account_approval', { p_approval_request_id: approvalRequestId })
    if (error || !data || typeof data !== 'object') return result<{ status: string }>('승인을 완료하지 못했습니다.')
    return { data: { status: 'approved' } }
  } catch { return result<{ status: string }>('승인을 완료하지 못했습니다.') }
}

export async function applyAdminApprovalAction(input: { approvalRequestId: string; actionType: string }): Promise<ActionResult<{ status: string }>> {
  if (!/^[0-9a-f-]{36}$/u.test(input.approvalRequestId)) return result<{ status: string }>('적용 요청 식별자를 확인해 주세요.')
  const rpcName = input.actionType === 'admin.invite' ? 'apply_approved_admin_invite' : input.actionType === 'admin.deactivate' ? 'apply_approved_admin_deactivate' : 'apply_approved_admin_role_change'
  try {
    const client = await createServerSupabaseClient() as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }
    const { data, error } = await client.rpc(rpcName, { p_approval_request_id: input.approvalRequestId })
    if (error || !data || typeof data !== 'object') return result<{ status: string }>('적용을 완료하지 못했습니다.')
    return { data: { status: 'applied' } }
  } catch { return result<{ status: string }>('적용을 완료하지 못했습니다.') }
}

export async function approveAdminApprovalFormAction(formData: FormData): Promise<void> {
  const result = await approveAdminApprovalAction(String(formData.get('approvalRequestId') ?? ''))
  if (result.data) revalidatePath('/admin/admins')
}

export async function applyAdminApprovalFormAction(formData: FormData): Promise<void> {
  const result = await applyAdminApprovalAction({ approvalRequestId: String(formData.get('approvalRequestId') ?? ''), actionType: String(formData.get('actionType') ?? '') })
  if (result.data) revalidatePath('/admin/admins')
}
