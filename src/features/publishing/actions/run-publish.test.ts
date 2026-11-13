import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), maybeSingle: vi.fn(), live: vi.fn(), retry: vi.fn(), audit: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn(() => { const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: mocks.maybeSingle }; return query }),
  })),
}))
vi.mock('./live-publish', () => ({
  executeLivePublishSchedule: mocks.live,
  executeLivePublishRetry: mocks.retry,
}))
vi.mock('../instagram-retry-preparation', () => ({
  auditInstagramProviderRejectedRetry: mocks.audit,
}))

import { runPublishAction } from './run-publish'
import { retryPublishAction } from './retry-publish'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const scheduleId = '30000000-0000-4000-8000-000000000001'
const attemptId = '40000000-0000-4000-8000-000000000001'
const finalInstagramAttemptId = 'ac1f35cb-43a4-4acc-99e7-e6d94b641d7e'
const userId = '10000000-0000-4000-8000-000000000001'

describe('publishing actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'manager', status: 'active' }, error: null })
    mocks.live.mockResolvedValue({ data: { attemptId, status: 'published', providerPostId: 'ig-post-1', errorCode: null } })
    mocks.retry.mockResolvedValue({ data: { attemptId, status: 'published', providerPostId: 'ig-post-1', errorCode: null } })
    mocks.audit.mockResolvedValue({ accountLabel: '@sohee.ai', jpegVerified: true })
  })

  it('routes a due schedule only through the live provider service', async () => {
    await expect(runPublishAction({ workspaceId, scheduleId })).resolves.toMatchObject({
      data: { attemptId, status: 'published', providerPostId: 'ig-post-1' },
    })
    expect(mocks.live).toHaveBeenCalledWith({ workspaceId, scheduleId, actorUserId: userId, trigger: 'user' })
  })

  it('routes a retry through the live provider retry claim', async () => {
    await expect(retryPublishAction({ workspaceId, failedAttemptId: attemptId })).resolves.toMatchObject({
      data: { status: 'published', providerPostId: 'ig-post-1' },
    })
    expect(mocks.retry).toHaveBeenCalledWith({ workspaceId, failedAttemptId: attemptId, actorUserId: userId, trigger: 'user' })
  })

  it('audits the official Instagram account and JPEG before the exact final recovery retry', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'owner', status: 'active' }, error: null })
    await expect(retryPublishAction({
      workspaceId,
      failedAttemptId: finalInstagramAttemptId,
    })).resolves.toMatchObject({ data: { status: 'published' } })

    expect(mocks.audit).toHaveBeenCalledWith({
      workspaceId,
      failedAttemptId: finalInstagramAttemptId,
      expectedAccountLabel: '@sohee.ai',
    })
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.retry.mock.invocationCallOrder[0]!)
  })

  it('keeps the exact final Instagram recovery owner-only', async () => {
    await expect(retryPublishAction({
      workspaceId,
      failedAttemptId: finalInstagramAttemptId,
    })).resolves.toMatchObject({ error: { requestId: 'live-publish' } })

    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.retry).not.toHaveBeenCalled()
  })

  it('returns the exact safe readiness code without starting a provider retry', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'owner', status: 'active' }, error: null })
    mocks.audit.mockRejectedValue(new Error('INSTAGRAM_READINESS_MEDIA_UNAVAILABLE'))

    await expect(retryPublishAction({
      workspaceId,
      failedAttemptId: finalInstagramAttemptId,
    })).resolves.toMatchObject({
      error: { message: expect.stringContaining('INSTAGRAM_READINESS_MEDIA_UNAVAILABLE') },
    })
    expect(mocks.retry).not.toHaveBeenCalled()
  })

  it('blocks reviewers before either provider service', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'reviewer', status: 'active' }, error: null })
    await expect(runPublishAction({ workspaceId, scheduleId })).resolves.toMatchObject({ error: { requestId: 'live-publish' } })
    expect(mocks.live).not.toHaveBeenCalled()
    expect(mocks.retry).not.toHaveBeenCalled()
  })

  it('rejects the removed simulation field instead of preserving a mock bypass', async () => {
    await expect(runPublishAction({ workspaceId, scheduleId, simulation: 'success' })).resolves.toMatchObject({ error: { requestId: 'live-publish' } })
    expect(mocks.live).not.toHaveBeenCalled()
  })
})
