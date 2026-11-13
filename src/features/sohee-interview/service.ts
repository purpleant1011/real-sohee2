import type { ConfirmInterviewFactInput, ConfirmInterviewFactResult } from './types'

export interface ConfirmInterviewFactDeps {
  client?: {
    rpc(fn: string, args: Record<string, any>): Promise<{ data: any; error: any }> | any
  }
}

/**
 * 사장님이 확인한 인터뷰 답변을 단일 DB 트랜잭션 RPC(confirm_interview_fact)로 원자적으로 영속화한다.
 */
export async function confirmInterviewFact(
  input: ConfirmInterviewFactInput & ConfirmInterviewFactDeps,
): Promise<ConfirmInterviewFactResult> {
  const { workspaceId, userId, questionId, category, summarizedContent, rawAnswer, key } = input

  if (!workspaceId?.trim()) {
    throw new Error('workspaceId is required')
  }
  if (!userId?.trim()) {
    throw new Error('userId is required')
  }
  if (!category?.trim()) {
    throw new Error('category is required')
  }
  if (!summarizedContent?.trim()) {
    throw new Error('summarizedContent is required')
  }

  const safeCategory = category.trim().slice(0, 120)
  const safeContent = summarizedContent.trim().slice(0, 12000)
  const safeRawAnswer = rawAnswer ? rawAnswer.trim().slice(0, 2000) : null
  const safeQuestionId = questionId?.trim() ?? ''
  const safeKey = key?.trim() ?? null

  const client =
    input.client ??
    ((await import('@/lib/supabase/admin')).createAdminSupabaseClient() as any)

  const { data, error } = await client.rpc('confirm_interview_fact', {
    p_workspace_id: workspaceId.trim(),
    p_user_id: userId.trim(),
    p_question_id: safeQuestionId,
    p_category: safeCategory,
    p_key: safeKey,
    p_raw_answer: safeRawAnswer,
    p_content: safeContent,
  })

  if (error || !data) {
    throw new Error(
      `confirm_interview_fact_failed: ${error?.message || 'unknown error'}`,
    )
  }

  return {
    factId: data,
    category: safeCategory,
    content: safeContent,
  }
}
