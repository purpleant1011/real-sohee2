'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const inputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    knowledgeId: z.string().uuid(),
    decision: z.enum(['review_required', 'approved', 'rejected', 'disabled']),
  })
  .strict()
const uuidSchema = z.string().uuid()
type ReviewResult = Readonly<{
  knowledgeId: string
  status: 'review_required' | 'approved' | 'rejected' | 'disabled'
}>

function failure(message: string): ActionResult<ReviewResult> {
  return { error: { message, requestId: 'knowledge-review' } }
}

export async function reviewKnowledgeAction(input: unknown): Promise<ActionResult<ReviewResult>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure('지식 자료 검토 요청을 확인해 주세요.')

  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string') return failure('로그인 후 다시 시도해 주세요.')

    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('user_id', userId)
      .maybeSingle()
    if (
      membershipError ||
      membership?.status !== 'active' ||
      (membership.role !== 'owner' && membership.role !== 'manager')
    ) {
      return failure('지식 자료를 검토할 권한이 없습니다.')
    }

    const { data, error } = await supabase.rpc('review_knowledge_item', {
      p_workspace_id: parsed.data.workspaceId,
      p_knowledge_id: parsed.data.knowledgeId,
      p_decision: parsed.data.decision,
    })
    const reviewedId = uuidSchema.safeParse(data)
    if (error || !reviewedId.success || reviewedId.data !== parsed.data.knowledgeId) {
      return failure('지식 자료 상태를 변경하지 못했습니다. 현재 상태를 다시 확인해 주세요.')
    }

    revalidatePath('/app/account')
    revalidatePath('/app/account/knowledge')
    return {
      data: {
        knowledgeId: reviewedId.data,
        status: parsed.data.decision,
      },
    }
  } catch {
    return failure('지식 자료 상태를 변경하지 못했습니다. 현재 상태를 다시 확인해 주세요.')
  }
}
