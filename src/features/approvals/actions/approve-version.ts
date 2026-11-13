'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const inputSchema = z.object({
  workspaceId: z.string().uuid(), contentId: z.string().uuid(), versionId: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(1).max(500),
  confirmations: z.object({
    content: z.literal(true),
    mediaOrder: z.literal(true),
    altText: z.literal(true),
    provenance: z.literal(true),
    unresolved: z.literal(true),
  }).strict(),
}).strict()
const uuidSchema = z.string().uuid()
const rejectionSchema = z.object({
  workspaceId: z.string().uuid(), contentId: z.string().uuid(), versionId: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(1).max(500),
}).strict()
type ApprovalData = Readonly<{ approvalId: string }>
const fail = (message: string): ActionResult<ApprovalData> => ({ error: { message, requestId: 'content-approval' } })

export async function approveVersionAction(input: unknown): Promise<ActionResult<ApprovalData>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return fail('승인 확인 내용을 모두 입력해 주세요.')
  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string') return fail('로그인 후 다시 시도해 주세요.')
    const { data: membership, error: membershipError } = await supabase.from('workspace_members')
      .select('role, status').eq('workspace_id', parsed.data.workspaceId).eq('user_id', userId).maybeSingle()
    if (membershipError || membership?.status !== 'active' || !['owner','manager','reviewer'].includes(membership.role)) {
      return fail('이 작업공간에서는 콘텐츠를 승인할 수 없습니다.')
    }
    const { data, error } = await supabase.rpc('approve_content_version', {
      p_workspace_id: parsed.data.workspaceId, p_content_id: parsed.data.contentId,
      p_version_id: parsed.data.versionId, p_expected_fingerprint: parsed.data.fingerprint,
      p_disclosure_confirmed: true, p_rights_confirmed: true, p_reason: parsed.data.reason,
    })
    const approvalId = uuidSchema.safeParse(data)
    if (error || !approvalId.success) return fail('승인을 완료하지 못했습니다. 최신 버전과 근거를 다시 확인해 주세요.')
    revalidatePath('/app/work'); revalidatePath(`/app/work/${parsed.data.contentId}`)
    return { data: { approvalId: approvalId.data } }
  } catch { return fail('승인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.') }
}

export async function rejectVersionAction(input: unknown): Promise<ActionResult<ApprovalData>> {
  const parsed = rejectionSchema.safeParse(input)
  if (!parsed.success) return fail('거절 사유를 500자 이내로 입력해 주세요.')
  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string') return fail('로그인 후 다시 시도해 주세요.')
    const { data: membership, error: membershipError } = await supabase.from('workspace_members')
      .select('role, status').eq('workspace_id', parsed.data.workspaceId).eq('user_id', userId).maybeSingle()
    if (membershipError || membership?.status !== 'active' || !['owner','manager','reviewer'].includes(membership.role)) {
      return fail('이 작업공간에서는 콘텐츠를 검토할 수 없습니다.')
    }
    const { data, error } = await supabase.rpc('reject_content_version', {
      p_workspace_id: parsed.data.workspaceId,
      p_content_id: parsed.data.contentId,
      p_version_id: parsed.data.versionId,
      p_expected_fingerprint: parsed.data.fingerprint,
      p_reason: parsed.data.reason,
    })
    const approvalId = uuidSchema.safeParse(data)
    if (error || !approvalId.success) return fail('거절을 기록하지 못했습니다. 최신 버전을 다시 확인해 주세요.')
    revalidatePath('/app/work'); revalidatePath(`/app/work/${parsed.data.contentId}`)
    return { data: { approvalId: approvalId.data } }
  } catch { return fail('거절을 기록하지 못했습니다. 잠시 후 다시 시도해 주세요.') }
}
