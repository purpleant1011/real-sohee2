import { INTERVIEW_QUESTIONS, getNextInterviewQuestion } from './questions'
import type { InterviewProgressResult } from './types'

export interface ProgressClientDeps {
  from(table: string): any
}

/**
 * 워크스페이스의 인터뷰 진행 상태 조회
 */
export async function getInterviewProgress(
  workspaceId: string,
  client?: ProgressClientDeps,
): Promise<InterviewProgressResult> {
  if (!workspaceId || typeof workspaceId !== 'string' || !workspaceId.trim()) {
    throw new Error('workspaceId is required')
  }

  const supabase =
    client ??
    ((await import('@/lib/supabase/admin')).createAdminSupabaseClient() as any)

  const { data: factsData, error } = await supabase
    .from('knowledge_facts')
    .select('id, source_candidate_id')
    .eq('workspace_id', workspaceId.trim())
    .eq('status', 'active')

  if (error) {
    throw new Error(
      `getInterviewProgress failed: ${error.message || 'unknown error'}`,
    )
  }

  const candidateIds = (factsData ?? [])
    .map((f: any) => f.source_candidate_id)
    .filter(Boolean)

  const answeredSet = new Set<string>()

  if (candidateIds.length > 0) {
    try {
      const { data: candRows } = await supabase
        .from('knowledge_candidates')
        .select('id, source_location')
        .eq('workspace_id', workspaceId.trim())
        .in('id', candidateIds)

      if (Array.isArray(candRows)) {
        for (const cand of candRows) {
          const loc = cand?.source_location
          if (typeof loc === 'string') {
            const match = loc.match(/interview:([a-zA-Z0-9_-]+)/)
            if (match?.[1]) {
              answeredSet.add(match[1])
            }
          }
        }
      }
    } catch {
      // safe fallback
    }
  }

  const totalQuestions = INTERVIEW_QUESTIONS.length
  const answeredQuestionIds = INTERVIEW_QUESTIONS
    .filter((q) => answeredSet.has(q.id))
    .map((q) => q.id)

  const nextQuestion = getNextInterviewQuestion(answeredQuestionIds)
  const isCompleted = answeredQuestionIds.length === totalQuestions
  const progressPercent = Math.round(
    (answeredQuestionIds.length / totalQuestions) * 100,
  )

  return {
    totalQuestions,
    answeredQuestionIds,
    nextQuestionId: nextQuestion?.id ?? null,
    progressPercent,
    isCompleted,
  }
}
