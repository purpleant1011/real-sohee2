'use server'

import { z } from 'zod'
import type { ActionResult } from '../../lib/errors/result'
import { startOnboardingAction } from '@/features/onboarding/actions/start-onboarding'

const requestId = 'workspace-setup'

const workspaceSetupSchema = z.object({ clientRequestId: z.string().uuid() }).strict()

function failure<T>(message: string): ActionResult<T> {
  return { error: { message, requestId } }
}

export async function createInitialWorkspaceAction(
  input: unknown,
): Promise<ActionResult<{ workspaceId: string; next: '/start' }>> {
  const parsed = workspaceSetupSchema.safeParse(input)
  if (!parsed.success) {
    return failure('가입 대화 시작 요청을 확인해 주세요.')
  }

  try {
    const result = await startOnboardingAction({ clientRequestId: parsed.data.clientRequestId })
    if (result.error) {
      return failure('작업공간을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }

    return { data: { workspaceId: result.data.workspaceId, next: '/start' } }
  } catch {
    return failure('작업공간을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
}
