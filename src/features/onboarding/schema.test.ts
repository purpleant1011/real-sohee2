import { describe, expect, it } from 'vitest'
import {
  onboardingAnswerSchema,
  onboardingCompletionSchema,
  profileCandidateReviewSchema,
} from './schema'

const sessionId = '10000000-0000-4000-8000-000000000001'
const workspaceId = '20000000-0000-4000-8000-000000000001'
const candidateId = '30000000-0000-4000-8000-000000000001'
const clientRequestId = '40000000-0000-4000-8000-000000000001'

describe('V0.8 onboarding schemas', () => {
  it('accepts one trimmed bounded answer for the active profile step', () => {
    expect(onboardingAnswerSchema.parse({
      sessionId,
      step: 'business_identity',
      content: '  청라에서 자연눈썹 시술을 운영해요.  ',
      clientRequestId,
    })).toEqual({
      sessionId,
      step: 'business_identity',
      content: '청라에서 자연눈썹 시술을 운영해요.',
      clientRequestId,
    })
  })

  it.each([
    { name: '빈 답변', value: { sessionId, step: 'business_identity', content: ' ', clientRequestId } },
    { name: '4,000자 초과', value: { sessionId, step: 'business_identity', content: 'a'.repeat(4_001), clientRequestId } },
    { name: '프로필 단계가 아닌 값', value: { sessionId, step: 'summary', content: '답변', clientRequestId } },
    { name: '올바르지 않은 요청 식별자', value: { sessionId, step: 'business_identity', content: '답변', clientRequestId: 'unsafe' } },
    { name: '알 수 없는 필드', value: { sessionId, step: 'business_identity', content: '답변', clientRequestId, provider: 'openai' } },
  ])('$name을 거절한다', ({ value }) => {
    expect(onboardingAnswerSchema.safeParse(value).success).toBe(false)
  })

  it('rejects activating a candidate without a confirmed value', () => {
    expect(profileCandidateReviewSchema.safeParse({
      workspaceId,
      candidateId,
      decision: 'approved',
      expectedVersion: 0,
      confirmedValue: '',
    }).success).toBe(false)
  })

  it.each([
    { name: '음수 버전', expectedVersion: -1 },
    { name: '정수가 아닌 버전', expectedVersion: 1.5 },
  ])('$name을 거절한다', ({ expectedVersion }) => {
    expect(profileCandidateReviewSchema.safeParse({
      workspaceId,
      candidateId,
      decision: 'revised',
      expectedVersion,
      confirmedValue: '청라 지역 자연눈썹 시술 서비스',
    }).success).toBe(false)
  })

  it('accepts completion only for the workspace and current session', () => {
    expect(onboardingCompletionSchema.parse({ workspaceId, sessionId })).toEqual({
      workspaceId,
      sessionId,
    })
  })
})
