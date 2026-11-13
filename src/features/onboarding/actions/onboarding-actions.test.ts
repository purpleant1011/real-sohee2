import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const onboardingMocks = vi.hoisted(() => ({
  createProductionTextClient: vi.fn(() => ({ responses: { create: vi.fn() } })),
  createOpenAIOnboardingExtractionProvider: vi.fn(() => ({
    extract: vi.fn().mockResolvedValue({
      key: 'business_identity',
      value: '기본 추출 값',
      confidence: 0.95,
      evidenceQuote: '답변 인용',
      source: 'onboarding_answer',
    }),
  })),
  createOnboardingGateway: vi.fn(),
  openAIConstructor: vi.fn(),
}))

vi.mock('@/lib/ai/gemini-responses-adapter', () => ({
  createProductionTextClient: onboardingMocks.createProductionTextClient,
}))
vi.mock('../extraction-provider', () => ({
  createOpenAIOnboardingExtractionProvider: onboardingMocks.createOpenAIOnboardingExtractionProvider,
}))
vi.mock('../repository', () => ({
  createOnboardingGateway: onboardingMocks.createOnboardingGateway,
}))
vi.mock('openai', () => ({
  default: onboardingMocks.openAIConstructor,
}))

import { reviewProfileCandidateAction } from './review-profile-candidate'
import { restartOnboardingAction } from './restart-onboarding'
import { saveOnboardingAnswerAction } from './save-onboarding-answer'
import { startOnboardingAction } from './start-onboarding'
import type { OnboardingGateway } from '../repository'
import { profileKeys } from '../types'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const sessionId = '20000000-0000-4000-8000-000000000001'
const threadId = '30000000-0000-4000-8000-000000000001'
const answerId = '40000000-0000-4000-8000-000000000001'
const candidateId = '50000000-0000-4000-8000-000000000001'
const clientRequestId = '60000000-0000-4000-8000-000000000001'

const savedAnswer = {
  sessionId,
  workspaceId,
  answerId,
  candidateId: null,
  status: 'in_progress',
  activeStep: 'business_identity',
}

function gateway(overrides: Partial<OnboardingGateway> = {}): OnboardingGateway {
  return {
    readSession: vi.fn(),
    listAnswers: vi.fn(),
    listCandidates: vi.fn(),
    start: vi.fn().mockResolvedValue({
      data: {
        sessionId,
        workspaceId,
        threadId,
        status: 'in_progress',
        activeStep: 'business_identity',
        approvedProfileKeys: [],
      },
      error: null,
    }),
    saveAnswer: vi.fn().mockResolvedValue({ data: savedAnswer, error: null }),
    createCandidate: vi.fn().mockResolvedValue({
      data: {
        ...savedAnswer,
        candidateId,
        status: 'review_required',
      },
      error: null,
    }),
    listApprovedFacts: vi.fn().mockResolvedValue({ data: [], error: null }),
    reviewCandidate: vi.fn().mockResolvedValue({
      data: {
        sessionId,
        workspaceId,
        candidateId,
        candidateStatus: 'active',
        version: 1,
        status: 'in_progress',
        activeStep: 'primary_offering',
      },
      error: null,
    }),
    restart: vi.fn().mockResolvedValue({
      data: {
        sessionId,
        workspaceId,
        threadId,
        status: 'in_progress',
        activeStep: 'business_identity',
        approvedProfileKeys: [
          'business_identity', 'primary_offering', 'primary_audience',
          'marketing_goal', 'approval_policy', 'channel_presence',
        ],
      },
      error: null,
    }),
    ...overrides,
  }
}

describe('V0.8 onboarding actions', () => {
  it('starts one resumable onboarding session', async () => {
    await expect(startOnboardingAction({ clientRequestId }, { gateway: gateway() })).resolves.toMatchObject({
      data: { sessionId, workspaceId, threadId, status: 'in_progress' },
    })
  })

  it('stores the answer before creating a review candidate', async () => {
    const calls: string[] = []
    const providedGateway = gateway({
      saveAnswer: vi.fn().mockImplementation(async () => {
        calls.push('save_answer')
        return { data: savedAnswer, error: null }
      }),
      createCandidate: vi.fn().mockImplementation(async () => {
        calls.push('create_candidate')
        return {
          data: { ...savedAnswer, candidateId, status: 'review_required' },
          error: null,
        }
      }),
    })
    const extractor = {
      extract: vi.fn().mockResolvedValue({
        key: 'business_identity',
        value: '청라 지역 자연눈썹 시술 서비스',
        confidence: 0.92,
        evidenceQuote: '청라에서 자연눈썹 시술을 운영해요.',
        source: 'onboarding_answer' as const,
      }),
    }

    const result = await saveOnboardingAnswerAction({
      workspaceId,
      sessionId,
      step: 'business_identity',
      content: '청라에서 자연눈썹 시술을 운영해요.',
      clientRequestId,
    }, { gateway: providedGateway, extractor })

    expect(calls).toEqual(['save_answer', 'create_candidate'])
    expect(result).toMatchObject({ data: { status: 'review_required', candidateId } })
  })

  it('does not expose provider text when extraction fails after saving', async () => {
    const extractor = {
      extract: vi.fn().mockRejectedValue(new Error('secret provider body')),
    }

    const result = await saveOnboardingAnswerAction({
      workspaceId,
      sessionId,
      step: 'business_identity',
      content: '청라에서 자연눈썹 시술을 운영해요.',
      clientRequestId,
    }, { gateway: gateway(), extractor })

    expect(result).toEqual({
      error: {
        message: '답변은 저장했지만 정보를 정리하지 못했어요. 다시 검토해 주세요.',
        requestId: 'onboarding-answer',
      },
    })
  })

  it('returns the next step after an owner review', async () => {
    await expect(reviewProfileCandidateAction({
      workspaceId,
      candidateId,
      decision: 'approved',
      expectedVersion: 0,
      confirmedValue: '청라 지역 자연눈썹 시술 서비스',
    }, { gateway: gateway() })).resolves.toMatchObject({
      data: { candidateStatus: 'active', activeStep: 'primary_offering', version: 1 },
    })
  })

  it('uses Gemini production text client and does not construct OpenAI in production dependencies', async () => {
    const gw = gateway({
      listApprovedFacts: vi.fn().mockResolvedValue({
        data: [{ workspace_id: workspaceId, category: 'business_identity', content: '기존 사실', status: 'active' }],
        error: null,
      }),
    })
    onboardingMocks.createOnboardingGateway.mockResolvedValue(gw)

    const result = await saveOnboardingAnswerAction({
      workspaceId,
      sessionId,
      step: 'business_identity',
      content: '청라에서 자연눈썹 시술을 운영해요.',
      clientRequestId,
    })

    expect(onboardingMocks.createProductionTextClient).toHaveBeenCalled()
    expect(onboardingMocks.createOpenAIOnboardingExtractionProvider).toHaveBeenCalledWith(
      expect.anything(),
      'gemini',
    )
    expect(onboardingMocks.openAIConstructor).not.toHaveBeenCalled()
    expect(result).toMatchObject({ data: { status: 'review_required', candidateId } })
  })

  it('restarts from the first question while retaining approved profile keys', async () => {
    await expect(restartOnboardingAction({
      workspaceId,
      sessionId,
      clientRequestId,
    }, { gateway: gateway() })).resolves.toMatchObject({
      data: {
        status: 'in_progress',
        activeStep: 'business_identity',
        approvedProfileKeys: profileKeys,
      },
    })
  })
})
