'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { executeLivePublishSchedule, type LivePublishOutcome } from './live-publish'
import { getAuthorizedPublisher } from './publishing-authorization'

const schema = z.object({
  workspaceId: z.string().uuid(),
  scheduleId: z.string().uuid(),
}).strict()

const fail = (message: string): ActionResult<LivePublishOutcome> => ({
  error: { message, requestId: 'live-publish' },
})

export async function runPublishAction(input: unknown): Promise<ActionResult<LivePublishOutcome>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return fail('게시 요청을 확인해 주세요.')
  try {
    const actorUserId = await getAuthorizedPublisher(parsed.data.workspaceId)
    if (actorUserId === null) return fail('실제 게시는 작업공간 소유자와 관리자만 실행할 수 있습니다.')
    // 화면에서 소유자·관리자가 직접 누른 발행이다. 자율근무 일시정지와 별개로 실행한다.
    return await executeLivePublishSchedule({ ...parsed.data, actorUserId, trigger: 'user' })
  } catch {
    return fail('게시를 실행하지 못했어요. 연결 상태와 최근 기록을 확인해 주세요.')
  }
}
