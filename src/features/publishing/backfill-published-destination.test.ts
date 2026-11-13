import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { backfillPublishedDestination } from './backfill-published-destination'

const input = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  channelConnectionId: '20000000-0000-4000-8000-000000000001',
  channel: 'threads' as const,
  attemptId: '30000000-0000-4000-8000-000000000001',
  providerPostId: 'threads-post-1',
}

describe('backfillPublishedDestination', () => {
  it('loads the scoped credential and records only the recovered public URL', async () => {
    const loadCredential = vi.fn().mockResolvedValue({
      accessToken: 'secret-token',
      provider: 'threads',
      externalAccountId: 'threads-user-1',
      expiresAt: null,
    })
    const lookupPermalink = vi.fn().mockResolvedValue('https://www.threads.com/@sohee/post/THREAD1')
    const recordDestination = vi.fn().mockResolvedValue({ error: null })

    await expect(backfillPublishedDestination(input, {
      loadCredential,
      lookupPermalink,
      recordDestination,
    })).resolves.toBe('https://www.threads.com/@sohee/post/THREAD1')

    expect(loadCredential).toHaveBeenCalledWith(
      input.workspaceId,
      input.channelConnectionId,
      'threads',
    )
    expect(lookupPermalink).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'threads',
      providerPostId: 'threads-post-1',
      accessToken: 'secret-token',
    }))
    expect(recordDestination).toHaveBeenCalledWith({
      workspaceId: input.workspaceId,
      attemptId: input.attemptId,
      destinationUrl: 'https://www.threads.com/@sohee/post/THREAD1',
    })
  })

  it('does not write when the provider has no valid permalink', async () => {
    const recordDestination = vi.fn()
    await expect(backfillPublishedDestination(input, {
      loadCredential: vi.fn().mockResolvedValue({
        accessToken: 'secret-token', provider: 'threads', externalAccountId: 'threads-user-1', expiresAt: null,
      }),
      lookupPermalink: vi.fn().mockResolvedValue(null),
      recordDestination,
    })).resolves.toBeNull()
    expect(recordDestination).not.toHaveBeenCalled()
  })
})
