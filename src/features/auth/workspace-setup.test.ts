import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({ startOnboardingAction: vi.fn() }))
vi.mock('@/features/onboarding/actions/start-onboarding', () => ({
  startOnboardingAction: mocks.startOnboardingAction,
}))

import { createInitialWorkspaceAction } from './workspace-setup'

const clientRequestId = '10000000-0000-4000-8000-000000000001'
const workspaceId = '20000000-0000-4000-8000-000000000001'

describe('createInitialWorkspaceAction compatibility delegate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delegates legacy callers to the atomic onboarding start contract', async () => {
    mocks.startOnboardingAction.mockResolvedValue({ data: {
      sessionId: '30000000-0000-4000-8000-000000000001',
      workspaceId,
      threadId: '40000000-0000-4000-8000-000000000001',
      status: 'in_progress',
      activeStep: 'business_identity',
      approvedProfileKeys: [],
    } })

    await expect(createInitialWorkspaceAction({ clientRequestId })).resolves.toEqual({
      data: { workspaceId, next: '/start' },
    })
    expect(mocks.startOnboardingAction).toHaveBeenCalledWith({ clientRequestId })
  })

  it('rejects the removed two-field form contract', async () => {
    await expect(createInitialWorkspaceAction({
      displayName: '소희 운영자',
      workspaceName: '빌더스 길드',
    })).resolves.toEqual({
      error: {
        message: '가입 대화 시작 요청을 확인해 주세요.',
        requestId: 'workspace-setup',
      },
    })
    expect(mocks.startOnboardingAction).not.toHaveBeenCalled()
  })
})
