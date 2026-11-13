import { z } from 'zod'
import { profileKeys } from './types'

const profileKeySchema = z.enum(profileKeys)
const boundedContentSchema = z.string().trim().min(1).max(4_000)

export const onboardingStartSchema = z
  .object({
    clientRequestId: z.string().uuid(),
  })
  .strict()

export const onboardingAnswerSchema = z
  .object({
    sessionId: z.string().uuid(),
    step: profileKeySchema,
    content: boundedContentSchema,
    clientRequestId: z.string().uuid(),
  })
  .strict()

export const profileCandidateReviewSchema = z
  .object({
    workspaceId: z.string().uuid(),
    candidateId: z.string().uuid(),
    decision: z.enum(['approved', 'revised', 'rejected']),
    expectedVersion: z.number().int().nonnegative(),
    confirmedValue: boundedContentSchema,
  })
  .strict()

export const onboardingCompletionSchema = z
  .object({
    workspaceId: z.string().uuid(),
    sessionId: z.string().uuid(),
  })
  .strict()

export type OnboardingStartInput = z.infer<typeof onboardingStartSchema>
export type OnboardingAnswerInput = z.infer<typeof onboardingAnswerSchema>
export type ProfileCandidateReviewInput = z.infer<typeof profileCandidateReviewSchema>
export type OnboardingCompletionInput = z.infer<typeof onboardingCompletionSchema>
