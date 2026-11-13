'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import {
  reconcileUnknownPublish,
  type ReconciledPublishOutcome,
} from '../publish-reconciliation'
import { getAuthorizedPublisher } from './publishing-authorization'

const schema = z.object({
  workspaceId: z.string().uuid(),
  attemptId: z.string().uuid(),
}).strict()

type ReconciliationResult = ReconciledPublishOutcome & Readonly<{
  message: string
  nextAction: 'VIEW_RESULT' | 'CHECK_CHANNEL_OR_CONTACT_OPERATOR'
}>

const fail = (message: string): ActionResult<ReconciliationResult> => ({
  error: { message, requestId: 'publish-reconciliation' },
})

export async function reconcilePublishAction(
  input: unknown,
): Promise<ActionResult<ReconciliationResult>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return fail('확인할 게시 기록을 다시 선택해 주세요.')
  try {
    const actorUserId = await getAuthorizedPublisher(parsed.data.workspaceId)
    if (actorUserId === null) {
      return fail('공식 채널 결과 확인은 작업공간 소유자와 관리자만 할 수 있습니다.')
    }
    const outcome = await reconcileUnknownPublish({ ...parsed.data, actorUserId })
    return { data: {
      ...outcome,
      nextAction: outcome.status === 'published' ? 'VIEW_RESULT' : 'CHECK_CHANNEL_OR_CONTACT_OPERATOR',
      message: outcome.status === 'published'
        ? '공식 계정의 같은 게시물을 찾아 게시 완료로 기록했습니다.'
        : '게시 결과를 아직 확정하지 못했어요. 다시 게시하지 말고 공식 채널 기록을 조회하거나 운영 담당자에게 확인을 요청해 주세요. 자동 재시도는 계속 멈춘 상태입니다.',
    } }
  } catch (error) {
    console.error(
      '[publish-reconciliation]',
      error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    )
    return fail('공식 채널 결과를 확인하지 못했어요. 연결 상태와 최근 기록을 확인해 주세요.')
  }
}
