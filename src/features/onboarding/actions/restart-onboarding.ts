'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createOnboardingGateway, type OnboardingGateway } from '../repository'
import { profileKeys } from '../types'

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  clientRequestId: z.string().uuid(),
}).strict()
const resultSchema = z.object({
  sessionId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  threadId: z.string().uuid(),
  status: z.literal('in_progress'),
  activeStep: z.literal('business_identity'),
  approvedProfileKeys: z.array(z.enum(profileKeys)).max(profileKeys.length),
}).strict()
type RestartResult = z.infer<typeof resultSchema>

const failure = (): ActionResult<RestartResult> => ({
  error: {
    message: '가입 정보 재검토를 시작하지 못했어요. 기존 확정 정보는 변경되지 않았어요.',
    requestId: 'onboarding-restart',
  },
})

export async function restartOnboardingAction(
  input: unknown,
  provided?: Readonly<{ gateway: OnboardingGateway }>,
): Promise<ActionResult<RestartResult>> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return failure()

  try {
    const gateway = provided?.gateway ?? await createOnboardingGateway()
    const result = await gateway.restart(parsed.data)
    const data = resultSchema.safeParse(result.data)
    if (
      result.error
      || !data.success
      || data.data.workspaceId !== parsed.data.workspaceId
      || data.data.sessionId !== parsed.data.sessionId
    ) {
      return failure()
    }

    revalidatePath('/app/onboarding')
    return { data: Object.freeze(data.data) }
  } catch {
    return failure()
  }
}
