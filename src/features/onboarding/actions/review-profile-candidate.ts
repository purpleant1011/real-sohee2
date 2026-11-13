'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import { createOnboardingGateway, type OnboardingGateway } from '../repository'
import { profileCandidateReviewSchema } from '../schema'
import { profileKeys } from '../types'

const resultSchema = z.object({
  sessionId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  candidateId: z.string().uuid(),
  candidateStatus: z.enum(['active', 'rejected']),
  version: z.number().int().positive(),
  status: z.enum(['in_progress', 'review_required', 'completed']),
  activeStep: z.enum([...profileKeys, 'summary', 'completed']),
}).strict()
type ReviewResult = z.infer<typeof resultSchema>

const failure = (message: string): ActionResult<ReviewResult> => ({
  error: { message, requestId: 'onboarding-profile-review' },
})

export async function reviewProfileCandidateAction(
  input: unknown,
  provided?: Readonly<{ gateway: OnboardingGateway }>,
): Promise<ActionResult<ReviewResult>> {
  const parsed = profileCandidateReviewSchema.safeParse(input)
  if (!parsed.success) return failure('확인할 사업 정보와 현재 버전을 다시 확인해 주세요.')

  try {
    const gateway = provided?.gateway ?? await createOnboardingGateway()
    const result = await gateway.reviewCandidate({
      workspaceId: parsed.data.workspaceId,
      candidateId: parsed.data.candidateId,
      decision: parsed.data.decision,
      confirmedValue: parsed.data.confirmedValue,
      expectedVersion: parsed.data.expectedVersion,
    })
    const data = resultSchema.safeParse(result.data)
    if (
      result.error
      || !data.success
      || data.data.workspaceId !== parsed.data.workspaceId
      || data.data.candidateId !== parsed.data.candidateId
    ) {
      return failure('사업 정보를 확정하지 못했어요. 현재 상태를 다시 확인해 주세요.')
    }

    revalidatePath('/app/onboarding')
    revalidatePath('/app/account')
    return { data: Object.freeze(data.data) }
  } catch {
    return failure('사업 정보를 확정하지 못했어요. 현재 상태를 다시 확인해 주세요.')
  }
}
