'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ruleSchema } from '../rule-schema'

const uuidSchema = z.string().uuid()
const saveInputSchema = z.object({
  workspaceId: uuidSchema,
  ruleId: uuidSchema.nullable(),
  kind: z.unknown(),
  active: z.unknown(),
  approvalRequired: z.unknown(),
}).strict()
const runInputSchema = z.object({
  workspaceId: uuidSchema,
  ruleId: uuidSchema,
  outcome: z.enum(['success', 'failure']),
}).strict()
const runResultSchema = z.object({
  runId: uuidSchema,
  status: z.enum(['awaiting_approval', 'succeeded', 'failed']),
  errorCode: z.string().max(120).nullable(),
}).strict()

async function managerClient(workspaceId: string) {
  const supabase = await createServerSupabaseClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  const userId = userData?.user?.id
  if (userError || typeof userId !== 'string') return null
  const { data: membership, error } = await supabase.from('workspace_members')
    .select('role, status')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (
    error || membership?.status !== 'active' ||
    (membership.role !== 'owner' && membership.role !== 'manager')
  ) return null
  return supabase
}

export async function saveAutomationRuleAction(
  input: unknown,
): Promise<ActionResult<Readonly<{ ruleId: string }>>> {
  const parsedInput = saveInputSchema.safeParse(input)
  if (!parsedInput.success) {
    return { error: { message: '자동화 규칙 입력을 확인해 주세요.', requestId: 'automation-save' } }
  }
  const parsedRule = ruleSchema.safeParse({
    kind: parsedInput.data.kind,
    active: parsedInput.data.active,
    approvalRequired: parsedInput.data.approvalRequired,
  })
  if (!parsedRule.success) {
    return { error: { message: parsedRule.error.issues[0]?.message ?? '자동화 규칙을 저장하지 못했습니다.', requestId: 'automation-save' } }
  }

  try {
    const supabase = await managerClient(parsedInput.data.workspaceId)
    if (!supabase) return { error: { message: '소유자와 관리자만 자동화 규칙을 변경할 수 있습니다.', requestId: 'automation-save' } }
    const { data, error } = await supabase.rpc('save_automation_rule', {
      p_workspace_id: parsedInput.data.workspaceId,
      // PostgREST generated types do not express nullable RPC parameters; the
      // SQL function intentionally treats null as "create a new rule".
      p_rule_id: parsedInput.data.ruleId!,
      p_kind: parsedRule.data.kind,
      p_active: parsedRule.data.active,
      p_approval_required: parsedRule.data.approvalRequired,
    })
    const ruleId = uuidSchema.safeParse(data)
    if (error || !ruleId.success) return { error: { message: '자동화 규칙을 저장하지 못했습니다.', requestId: 'automation-save' } }
    revalidatePath('/app/account')
    revalidatePath('/app/account/automation')
    return { data: { ruleId: ruleId.data } }
  } catch {
    return { error: { message: '자동화 규칙을 저장하지 못했습니다.', requestId: 'automation-save' } }
  }
}

export async function runMockAutomationAction(
  input: unknown,
): Promise<ActionResult<z.infer<typeof runResultSchema>>> {
  const parsed = runInputSchema.safeParse(input)
  if (!parsed.success) return { error: { message: '모의 실행 요청을 확인해 주세요.', requestId: 'automation-run' } }
  try {
    const supabase = await managerClient(parsed.data.workspaceId)
    if (!supabase) return { error: { message: '소유자와 관리자만 모의 실행을 기록할 수 있습니다.', requestId: 'automation-run' } }
    const { data, error } = await supabase.rpc('run_mock_automation', {
      p_workspace_id: parsed.data.workspaceId,
      p_rule_id: parsed.data.ruleId,
      p_outcome: parsed.data.outcome,
    })
    const run = runResultSchema.safeParse(data)
    if (error || !run.success) return { error: { message: '모의 실행 결과를 기록하지 못했습니다.', requestId: 'automation-run' } }
    revalidatePath('/app/account/automation')
    return { data: run.data }
  } catch {
    return { error: { message: '모의 실행 결과를 기록하지 못했습니다.', requestId: 'automation-run' } }
  }
}
