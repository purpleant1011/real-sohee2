'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { auditInstagramProviderRejectedRetry } from '../instagram-retry-preparation'
import { executeLivePublishRetry, type LivePublishOutcome } from './live-publish'
import { getAuthorizedOwner, getAuthorizedPublisher } from './publishing-authorization'

const schema = z.object({
  workspaceId: z.string().uuid(),
  failedAttemptId: z.string().uuid(),
}).strict()

const FINAL_INSTAGRAM_ATTEMPT_ID = 'ac1f35cb-43a4-4acc-99e7-e6d94b641d7e'

const fail = (message: string): ActionResult<LivePublishOutcome> => ({
  error: { message, requestId: 'live-publish' },
})

export async function retryPublishAction(input: unknown): Promise<ActionResult<LivePublishOutcome>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return fail('재시도할 게시 기록을 확인해 주세요.')
  try {
    const isExactFinalInstagramRecovery = parsed.data.failedAttemptId === FINAL_INSTAGRAM_ATTEMPT_ID
    const actorUserId = isExactFinalInstagramRecovery
      ? await getAuthorizedOwner(parsed.data.workspaceId)
      : await getAuthorizedPublisher(parsed.data.workspaceId)
    if (actorUserId === null) return fail('실제 게시 재시도는 작업공간 소유자와 관리자만 할 수 있습니다.')
    if (isExactFinalInstagramRecovery) {
      await auditInstagramProviderRejectedRetry({
        ...parsed.data,
        expectedAccountLabel: '@sohee.ai',
      })
    }
    // 화면에서 소유자·관리자가 직접 누른 재시도다. 자율근무 일시정지와 별개로 실행한다.
    return await executeLivePublishRetry({ ...parsed.data, actorUserId, trigger: 'user' })
  } catch (error) {
    if (
      parsed.data.failedAttemptId === FINAL_INSTAGRAM_ATTEMPT_ID
      && error instanceof Error
      && /^INSTAGRAM_READINESS_[A-Z_]+$/u.test(error.message)
    ) return fail(`Instagram 복구 사전검증이 중단됐어요. (${error.message})`)
    return fail('게시 재시도를 시작하지 못했어요. 실패 원인과 최근 기록을 확인해 주세요.')
  }
}
