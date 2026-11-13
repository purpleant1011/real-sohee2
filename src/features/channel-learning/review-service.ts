import {
  LearningError,
  type ReviewLearningCandidatesInput,
  reviewLearningCandidatesSchema,
} from './contracts'
import type { LearningRepository } from './repository'

export type ReviewServiceDependencies = Readonly<{
  repository: LearningRepository
}>

export async function reviewLearningCandidates(
  actor: { userId: string; workspaceId: string; role: string },
  input: ReviewLearningCandidatesInput,
  deps: ReviewServiceDependencies,
): Promise<void> {
  if (actor.role !== 'owner' && actor.role !== 'manager') {
    throw new LearningError('FORBIDDEN', '지식을 검토할 권한이 없습니다.')
  }

  const parsed = reviewLearningCandidatesSchema.safeParse(input)
  if (!parsed.success) {
    throw new LearningError('INVALID_INPUT', '검토 요청 정보가 올바르지 않습니다.')
  }

  if (actor.workspaceId !== parsed.data.source.workspaceId) {
    throw new LearningError('FORBIDDEN', '타 테넌트 지식을 검토할 수 없습니다.')
  }

  await deps.repository.reviewCandidates(
    { userId: actor.userId, workspaceId: actor.workspaceId },
    parsed.data,
  )
}
