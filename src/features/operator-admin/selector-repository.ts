import 'server-only'

import { z } from 'zod'
import { requireOperatorAnyScope } from '@/features/operator-auth/require-operator'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const assignmentSchema = z.object({ assignment_id: z.string().uuid(), role_key: z.string(), role_label: z.string(), scope_label: z.string(), version: z.number().int().positive() }).strict()
const rowSchema = z.object({ user_id: z.string().uuid(), email_label: z.string(), status: z.enum(['invited', 'active', 'disabled']), version: z.number().int().positive(), assignments: z.array(assignmentSchema) }).strict()
export type AdminSelector = Readonly<{ userId: string; emailLabel: string; status: 'invited' | 'active' | 'disabled'; version: number; assignments: readonly { assignmentId: string; roleKey: string; roleLabel: string; scopeLabel: string; version: number }[] }>

export async function listOperatorAdminSelectors(): Promise<Readonly<{ data: readonly AdminSelector[] | null; error: string | null }>> {
  try {
    await requireOperatorAnyScope('admin.read')
    const client = await createServerSupabaseClient() as unknown as { rpc: (name: string) => Promise<{ data: unknown; error: unknown }> }
    const { data, error } = await client.rpc('list_operator_admin_selector_options')
    const parsed = z.array(rowSchema).safeParse(data)
    if (error || !parsed.success) return { data: null, error: '관리자 선택 자료를 불러오지 못했습니다.' }
    return { data: parsed.data.map((row) => ({ userId: row.user_id, emailLabel: row.email_label, status: row.status, version: row.version, assignments: row.assignments.map((item) => ({ assignmentId: item.assignment_id, roleKey: item.role_key, roleLabel: item.role_label, scopeLabel: item.scope_label, version: item.version })) })), error: null }
  } catch { return { data: null, error: '관리자 선택 자료를 불러오지 못했습니다.' } }
}
