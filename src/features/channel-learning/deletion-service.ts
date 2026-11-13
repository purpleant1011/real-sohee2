import {
  LearningError,
  type SourceRef,
  sourceRefSchema,
} from './contracts'
import type { LearningRepository } from './repository'

export type DeletionServiceDependencies = Readonly<{
  repository: LearningRepository
}>

function validateActorAndSource(
  actor: { userId: string; workspaceId: string; role: string },
  source: SourceRef,
): SourceRef {
  if (actor.role !== 'owner' && actor.role !== 'manager') {
    throw new LearningError('FORBIDDEN', '채널을 관리할 권한이 없습니다.')
  }

  const parsed = sourceRefSchema.safeParse(source)
  if (!parsed.success) {
    throw new LearningError('INVALID_INPUT', '유효하지 않은 출처 참조입니다.')
  }

  if (actor.workspaceId !== parsed.data.workspaceId) {
    throw new LearningError('FORBIDDEN', '타 테넌트 채널에 접근할 수 없습니다.')
  }

  return parsed.data
}

export async function revokeLearningSource(
  actor: { userId: string; workspaceId: string; role: string },
  source: SourceRef,
  deps: DeletionServiceDependencies,
): Promise<void> {
  const validSource = validateActorAndSource(actor, source)
  await deps.repository.revokeSource(
    { userId: actor.userId, workspaceId: actor.workspaceId },
    validSource,
  )
}

export async function deleteLearningSource(
  actor: { userId: string; workspaceId: string; role: string },
  source: SourceRef,
  deps: DeletionServiceDependencies,
): Promise<{ deletionJobId: string; status: 'pending' | 'complete' }> {
  const validSource = validateActorAndSource(actor, source)
  return deps.repository.markSourceDeleted(
    { userId: actor.userId, workspaceId: actor.workspaceId },
    validSource,
  )
}
