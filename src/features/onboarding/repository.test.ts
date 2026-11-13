import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { getOnboardingSnapshot, type OnboardingGateway } from './repository'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const sessionId = '20000000-0000-4000-8000-000000000001'
const threadId = '30000000-0000-4000-8000-000000000001'
const answerId = '40000000-0000-4000-8000-000000000001'
const candidateId = '50000000-0000-4000-8000-000000000001'
const timestamp = '2026-08-19T00:00:00.000Z'

function gateway(overrides: Partial<OnboardingGateway> = {}): OnboardingGateway {
  return {
    readSession: vi.fn().mockResolvedValue({
      data: {
        id: sessionId,
        workspace_id: workspaceId,
        thread_id: threadId,
        status: 'review_required',
        active_step: 'business_identity',
        created_at: timestamp,
        updated_at: timestamp,
      },
      error: null,
    }),
    listAnswers: vi.fn().mockResolvedValue({
      data: [{
        id: answerId,
        workspace_id: workspaceId,
        session_id: sessionId,
        profile_key: 'business_identity',
        content: '청라에서 자연눈썹 시술을 운영해요.',
        created_at: timestamp,
      }],
      error: null,
    }),
    listCandidates: vi.fn().mockResolvedValue({
      data: [{
        id: candidateId,
        workspace_id: workspaceId,
        session_id: sessionId,
        answer_id: answerId,
        profile_key: 'business_identity',
        original_value: '청라에서 자연눈썹 시술을 운영해요.',
        proposed_value: '청라 지역 자연눈썹 시술 서비스',
        confirmed_value: null,
        confidence: 0.92,
        evidence_quote: '청라에서 자연눈썹 시술을 운영해요.',
        source: 'onboarding_answer',
        status: 'review_required',
        version: 0,
        reviewed_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      }],
      error: null,
    }),
    start: vi.fn(),
    saveAnswer: vi.fn(),
    createCandidate: vi.fn(),
    listApprovedFacts: vi.fn().mockResolvedValue({ data: [], error: null }),
    reviewCandidate: vi.fn(),
    restart: vi.fn(),
    ...overrides,
  }
}

describe('getOnboardingSnapshot', () => {
  it('returns a validated transcript and review candidate for the workspace', async () => {
    await expect(getOnboardingSnapshot(workspaceId, gateway())).resolves.toMatchObject({
      data: {
        workspaceId,
        sessionId,
        threadId,
        status: 'review_required',
        activeStep: 'business_identity',
        approvedProfileKeys: [],
        approvedFacts: [],
        answers: [{ id: answerId, step: 'business_identity' }],
        candidates: [{ id: candidateId, status: 'review_required', version: 0 }],
      },
    })
  })

  it('rejects rows returned from another workspace', async () => {
    const foreignWorkspace = '90000000-0000-4000-8000-000000000001'
    const result = await getOnboardingSnapshot(workspaceId, gateway({
      readSession: vi.fn().mockResolvedValue({
        data: {
          id: sessionId,
          workspace_id: foreignWorkspace,
          thread_id: threadId,
          status: 'in_progress',
          active_step: 'business_identity',
          created_at: timestamp,
          updated_at: timestamp,
        },
        error: null,
      }),
    }))

    expect(result).toEqual({
      error: {
        message: '가입 준비 상태를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
        requestId: 'onboarding-snapshot',
      },
    })
  })
})
