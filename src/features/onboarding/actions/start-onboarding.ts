'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { onboardingStartSchema } from '../schema'
import { createOnboardingGateway, type OnboardingGateway } from '../repository'

const resultSchema = z.object({
  sessionId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  threadId: z.string().uuid(),
  status: z.enum(['in_progress', 'review_required', 'completed']),
  activeStep: z.enum([
    'business_identity', 'primary_offering', 'primary_audience',
    'marketing_goal', 'approval_policy', 'channel_presence', 'summary', 'completed',
  ]),
  approvedProfileKeys: z.array(z.enum([
    'business_identity', 'primary_offering', 'primary_audience',
    'marketing_goal', 'approval_policy', 'channel_presence',
  ])).max(6),
}).strict()

type StartResult = z.infer<typeof resultSchema>

const failure = (): ActionResult<StartResult> => ({
  error: {
    message: '가입 대화를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
    requestId: 'onboarding-start',
  },
})

export async function startOnboardingAction(
  input: unknown,
  provided?: Readonly<{ gateway: OnboardingGateway }>,
): Promise<ActionResult<StartResult>> {
  const parsed = onboardingStartSchema.safeParse(input)
  if (!parsed.success) return failure()

  try {
    const gateway = provided?.gateway ?? await createOnboardingGateway()
    const result = await gateway.start(parsed.data.clientRequestId)
    const data = resultSchema.safeParse(result.data)
    if (result.error || !data.success) return failure()
    return { data: Object.freeze(data.data) }
  } catch {
    return failure()
  }
}
