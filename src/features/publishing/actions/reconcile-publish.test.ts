import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), reconcile: vi.fn() }))
vi.mock('./publishing-authorization', () => ({ getAuthorizedPublisher: mocks.authorize }))
vi.mock('../publish-reconciliation', () => ({ reconcileUnknownPublish: mocks.reconcile }))

import { reconcilePublishAction } from './reconcile-publish'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const attemptId = '20000000-0000-4000-8000-000000000001'
const actorUserId = '30000000-0000-4000-8000-000000000001'

describe('reconcile publish action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue(actorUserId)
    mocks.reconcile.mockResolvedValue({
      attemptId, status: 'unknown', providerPostId: null, errorCode: 'RESULT_UNKNOWN',
    })
  })

  it('authorizes an operator and reconciles only the bound workspace attempt', async () => {
    await expect(reconcilePublishAction({ workspaceId, attemptId })).resolves.toEqual({ data: {
      attemptId, status: 'unknown', providerPostId: null, errorCode: 'RESULT_UNKNOWN',
      nextAction: 'CHECK_CHANNEL_OR_CONTACT_OPERATOR',
      message: expect.stringMatching(/다시 게시하지 말고 공식 채널 기록을 조회하거나 운영 담당자/u),
    } })
    expect(mocks.reconcile).toHaveBeenCalledWith({ workspaceId, attemptId, actorUserId })
  })

  it('returns view-only guidance for a recovered success', async () => {
    mocks.reconcile.mockResolvedValueOnce({ attemptId, status: 'published', providerPostId: 'post-1', errorCode: null })
    await expect(reconcilePublishAction({ workspaceId, attemptId })).resolves.toMatchObject({ data: {
      status: 'published', providerPostId: 'post-1', nextAction: 'VIEW_RESULT', message: expect.stringContaining('게시 완료'),
    } })
  })

  it('fails closed for a non-operator or malformed request', async () => {
    mocks.authorize.mockResolvedValueOnce(null)
    await expect(reconcilePublishAction({ workspaceId, attemptId })).resolves.toMatchObject({ error: {} })
    await expect(reconcilePublishAction({ workspaceId, attemptId: 'unsafe' })).resolves.toMatchObject({ error: {} })
    expect(mocks.reconcile).not.toHaveBeenCalled()
  })
})
