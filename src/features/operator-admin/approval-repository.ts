import 'server-only'

import { z } from 'zod'
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const rowSchema = z.object({ id: z.string().uuid(), action_type: z.string(), status: z.enum(['pending', 'approved', 'applied']), target_label: z.string(), requested_by: z.string().uuid(), approved_by: z.string().uuid().nullable(), requested_at: z.string(), approved_at: z.string().nullable(), expires_at: z.string(), expected_version: z.number().nullable(), apply_ready: z.boolean() }).strict()
export type OperatorAdminApproval = Readonly<{ id: string; actionType: string; status: 'pending' | 'approved' | 'applied'; targetLabel: string; requestedBy: string; approvedBy: string | null; requestedAt: string; approvedAt: string | null; expiresAt: string; expectedVersion: number | null; applyReady: boolean }>

export async function listOperatorAdminApprovals(): Promise<Readonly<{ data: readonly OperatorAdminApproval[] | null; error: string | null }>> {
  try {
    await requireOperatorAnyScope('admin.read')
    const client = await createServerSupabaseClient()
    const { data, error } = await (client as unknown as { rpc: (name: string) => Promise<{ data: unknown; error: unknown }> }).rpc('list_operator_admin_approval_requests')
    if (error) return { data: null, error: '승인 목록을 불러오지 못했습니다.' }
    const parsed = z.array(rowSchema).safeParse(data)
    if (!parsed.success) return { data: null, error: '승인 목록 자료를 확인하지 못했습니다.' }
    return { data: parsed.data.map((row) => ({ id: row.id, actionType: row.action_type, status: row.status, targetLabel: row.target_label, requestedBy: row.requested_by, approvedBy: row.approved_by, requestedAt: row.requested_at, approvedAt: row.approved_at, expiresAt: row.expires_at, expectedVersion: row.expected_version, applyReady: row.apply_ready })), error: null }
  } catch { return { data: null, error: '승인 목록을 불러오지 못했습니다.' } }
}
