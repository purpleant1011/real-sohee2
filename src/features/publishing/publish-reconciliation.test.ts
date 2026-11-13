import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const workspaceId = '10000000-0000-4000-8000-000000000001'
const attemptId = '20000000-0000-4000-8000-000000000001'
const scheduleId = '30000000-0000-4000-8000-000000000001'
const actorUserId = '40000000-0000-4000-8000-000000000001'
const connectionId = '50000000-0000-4000-8000-000000000001'

import { reconcileUnknownPublish } from './publish-reconciliation'

const context = [{
  attempt_id: attemptId,
  schedule_id: scheduleId,
  channel_connection_id: connectionId,
  channel: 'instagram',
  provider_request_id: null,
  started_at: '2026-08-14T01:00:00.000Z',
  finished_at: '2026-08-14T01:05:00.000Z',
}]
const material = {
  payload: {
    workspaceId,
    scheduleId,
    channel: 'instagram' as const,
    externalAccountId: 'ig-account-1',
    text: '승인된 본문',
  },
  mediaUrls: ['https://media.example.test/one.jpg'],
}

function dependencies(posts: Array<{ id: string; text: string; timestamp: string }>) {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: context, error: null })
    .mockResolvedValueOnce({ data: attemptId, error: null })
  return {
    rpc,
    loadMaterial: vi.fn().mockResolvedValue(material),
    loadCredential: vi.fn().mockResolvedValue({
      provider: 'instagram', externalAccountId: 'ig-account-1', accessToken: 'secret-token', expiresAt: null,
    }),
    listPosts: vi.fn().mockResolvedValue(posts),
    now: () => new Date('2026-08-14T01:20:00.000Z'),
  }
}

describe('unknown Meta publish reconciliation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks the exact approved post published when the official account contains one match', async () => {
    const deps = dependencies([
      { id: 'ig-post-1', text: '승인된 본문', timestamp: '2026-08-14T01:06:00.000Z' },
      { id: 'ig-post-old', text: '다른 본문', timestamp: '2026-08-13T01:06:00.000Z' },
    ])

    await expect(reconcileUnknownPublish({ workspaceId, attemptId, actorUserId }, deps))
      .resolves.toEqual({ attemptId, status: 'published', providerPostId: 'ig-post-1', errorCode: null })
    expect(deps.rpc.mock.calls[1]).toEqual(['resolve_reconciled_publish', expect.objectContaining({
      p_status: 'succeeded', p_provider_reference: 'ig-post-1', p_error_code: null,
    })])
  })

  it('preserves unknown after the old safety window without resolving failure', async () => {
    const deps = dependencies([])

    await expect(reconcileUnknownPublish({ workspaceId, attemptId, actorUserId }, deps))
      .resolves.toEqual({ attemptId, status: 'unknown', providerPostId: null, errorCode: 'RESULT_UNKNOWN' })
    expect(deps.rpc).toHaveBeenCalledOnce()
  })

  it('keeps the result unknown when the official channel may still be converging', async () => {
    const deps = dependencies([])
    deps.now = () => new Date('2026-08-14T01:10:00.000Z')

    await expect(reconcileUnknownPublish({ workspaceId, attemptId, actorUserId }, deps))
      .resolves.toEqual({ attemptId, status: 'unknown', providerPostId: null, errorCode: 'RESULT_UNKNOWN' })
    expect(deps.rpc).toHaveBeenCalledOnce()
  })

  it('recovers Threads with account-bound evidence and not the container request ID', async () => {
    const deps = dependencies([{ id: 'threads-post', text: '승인된 본문', timestamp: '2026-08-14T01:06:00.000Z' }])
    deps.rpc.mockReset().mockResolvedValueOnce({ data: [{ ...context[0], channel: 'threads', provider_request_id: 'container-only' }], error: null })
      .mockResolvedValueOnce({ data: attemptId, error: null })
    deps.loadMaterial.mockResolvedValue({ ...material, payload: { ...material.payload, channel: 'threads' } })
    deps.loadCredential.mockResolvedValue({ provider: 'threads', externalAccountId: 'ig-account-1', accessToken: 'token', expiresAt: null })
    await expect(reconcileUnknownPublish({ workspaceId, attemptId, actorUserId }, deps))
      .resolves.toMatchObject({ status: 'published', providerPostId: 'threads-post' })
    expect(deps.listPosts).toHaveBeenCalledWith({ channel: 'threads', accountId: 'ig-account-1', accessToken: 'token' })
  })

  it.each(['', 'unknown'])('does not resolve incomplete post ID %j', async (id) => {
    const deps = dependencies([{ id, text: '승인된 본문', timestamp: '2026-08-14T01:06:00.000Z' }])
    await expect(reconcileUnknownPublish({ workspaceId, attemptId, actorUserId }, deps)).resolves.toMatchObject({ status: 'unknown' })
    expect(deps.rpc).toHaveBeenCalledOnce()
  })

  it('rejects stale material, mismatched account and a different attempt before recording', async () => {
    const deps = dependencies([])
    deps.loadMaterial.mockResolvedValueOnce({ ...material, payload: { ...material.payload, workspaceId: actorUserId } })
    await expect(reconcileUnknownPublish({ workspaceId, attemptId, actorUserId }, deps)).rejects.toThrow('STALE')
    expect(deps.listPosts).not.toHaveBeenCalled()
    const wrongAccount = dependencies([])
    wrongAccount.loadCredential.mockResolvedValueOnce({ provider: 'instagram', externalAccountId: 'other', accessToken: 'token', expiresAt: null })
    await expect(reconcileUnknownPublish({ workspaceId, attemptId, actorUserId }, wrongAccount)).rejects.toThrow('CONNECTION_INVALID')
    expect(wrongAccount.listPosts).not.toHaveBeenCalled()
    const wrongAttempt = dependencies([])
    wrongAttempt.rpc.mockReset().mockResolvedValueOnce({ data: [{ ...context[0], attempt_id: scheduleId }], error: null })
    await expect(reconcileUnknownPublish({ workspaceId, attemptId, actorUserId }, wrongAttempt)).rejects.toThrow('STALE')
    expect(wrongAttempt.loadMaterial).not.toHaveBeenCalled()
  })

  it('does not accept an old post or resolve after a lookup outage', async () => {
    const deps = dependencies([{ id: 'old', text: '승인된 본문', timestamp: '2026-08-13T01:06:00.000Z' }])
    await expect(reconcileUnknownPublish({ workspaceId, attemptId, actorUserId }, deps)).resolves.toMatchObject({ status: 'unknown' })
    expect(deps.rpc).toHaveBeenCalledOnce()
    const outage = dependencies([])
    outage.listPosts.mockRejectedValueOnce(new Error('unavailable'))
    await expect(reconcileUnknownPublish({ workspaceId, attemptId, actorUserId }, outage)).rejects.toThrow('unavailable')
    expect(outage.rpc).toHaveBeenCalledOnce()
  })

  it('does not guess when more than one exact recent post matches', async () => {
    const deps = dependencies([
      { id: 'ig-post-1', text: '승인된 본문', timestamp: '2026-08-14T01:06:00.000Z' },
      { id: 'ig-post-2', text: '승인된 본문', timestamp: '2026-08-14T01:07:00.000Z' },
    ])

    await expect(reconcileUnknownPublish({ workspaceId, attemptId, actorUserId }, deps))
      .resolves.toEqual({ attemptId, status: 'unknown', providerPostId: null, errorCode: 'RESULT_UNKNOWN' })
    expect(deps.rpc).toHaveBeenCalledOnce()
  })
})
