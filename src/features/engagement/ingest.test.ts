import { describe, expect, it, vi } from 'vitest'
import { ingestChannelComments, ingestWebhookComment, isSelfComment } from './ingest'
import type { EngagementRepository } from './repository'
import type { SocialComment } from './types'
import type { MetaFetch } from '@/lib/providers/meta-api'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ingestChannelComments for Instagram', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const channelConnectionId = 'conn-ig-1'
  const accessToken = 'valid-ig-access-token-longer-than-eight-chars'

  it('fetches recent media and comments, upserting them as status RECEIVED', async () => {
    const upserted: any[] = []
    const mockRepo = {
      upsertComment: vi.fn().mockImplementation((input: any) => {
        const comment: SocialComment = {
          ...input,
          id: `comment-db-${upserted.length + 1}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        upserted.push(comment)
        return Promise.resolve(comment)
      }),
    } as unknown as EngagementRepository

    const recentDate = new Date(Date.now() - 3600 * 1000).toISOString() // 1 hour ago

    const fetcher: MetaFetch = vi.fn<MetaFetch>().mockImplementation((url) => {
      const urlStr = String(url)
      if (urlStr.includes('/media?') || urlStr.includes('/media&')) {
        return Promise.resolve(jsonResponse({
          data: [
            { id: '18609864865065836', caption: '새 피드 게시물입니다', timestamp: recentDate },
          ],
        }))
      }
      if (urlStr.includes('/18609864865065836/comments')) {
        return Promise.resolve(jsonResponse({
          data: [
            { id: 'ig-comment-1', text: '카톡으로 연락드리고 싶은뎅..', timestamp: recentDate, username: 'purpleant4855' },
            { id: 'ig-comment-2', text: '저 관심있어요🔥', timestamp: recentDate, username: 'purpleant4855' },
          ],
        }))
      }
      return Promise.resolve(jsonResponse({ data: [] }))
    })

    const result = await ingestChannelComments({
      workspaceId,
      channelConnectionId,
      channel: 'instagram',
      accessToken,
      accountId: '17841441250302004',
      repo: mockRepo,
      fetcher,
      mediaLimit: 10,
    })

    expect(result.ingestedCount).toBe(2)
    expect(mockRepo.upsertComment).toHaveBeenCalledTimes(2)
    expect(upserted[0]).toMatchObject({
      workspace_id: workspaceId,
      channel_connection_id: channelConnectionId,
      channel: 'instagram',
      provider_comment_id: 'ig-comment-1',
      provider_media_id: '18609864865065836',
      author_handle: 'purpleant4855',
      comment_text: '카톡으로 연락드리고 싶은뎅..',
      status: 'RECEIVED',
    })
    expect(upserted[1]).toMatchObject({
      workspace_id: workspaceId,
      channel_connection_id: channelConnectionId,
      channel: 'instagram',
      provider_comment_id: 'ig-comment-2',
      provider_media_id: '18609864865065836',
      author_handle: 'purpleant4855',
      comment_text: '저 관심있어요🔥',
      status: 'RECEIVED',
    })
  })

  it('filters out comments older than maxCommentAgeDays (default 7 days)', async () => {
    const upserted: any[] = []
    const mockRepo = {
      upsertComment: vi.fn().mockImplementation((input: any) => {
        const comment = { ...input, id: 'db-id' }
        upserted.push(comment)
        return Promise.resolve(comment)
      }),
    } as unknown as EngagementRepository

    const newDate = new Date(Date.now() - 2 * 86_400_000).toISOString() // 2 days ago
    const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString() // 10 days ago

    const fetcher: MetaFetch = vi.fn<MetaFetch>().mockImplementation((url) => {
      const urlStr = String(url)
      if (urlStr.includes('/media?') || urlStr.includes('/media&')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'media-old-and-new', caption: '포스트', timestamp: newDate }],
        }))
      }
      if (urlStr.includes('/comments')) {
        return Promise.resolve(jsonResponse({
          data: [
            { id: 'comment-new', text: '새 댓글', timestamp: newDate, username: 'user_new' },
            { id: 'comment-old', text: '오래된 댓글', timestamp: oldDate, username: 'user_old' },
          ],
        }))
      }
      return Promise.resolve(jsonResponse({ data: [] }))
    })

    const result = await ingestChannelComments({
      workspaceId,
      channelConnectionId,
      channel: 'instagram',
      accessToken,
      accountId: '17841441250302004',
      repo: mockRepo,
      fetcher,
      maxCommentAgeDays: 7,
    })

    expect(result.ingestedCount).toBe(1)
    expect(upserted[0]?.provider_comment_id).toBe('comment-new')
    expect(mockRepo.upsertComment).toHaveBeenCalledTimes(1)
  })

  it('falls back to me when accountId is empty string, avoiding PROVIDER_REJECTED exception', async () => {
    const mockRepo = {
      upsertComment: vi.fn().mockResolvedValue({ id: 'c1' }),
    } as unknown as EngagementRepository

    const fetcher: MetaFetch = vi.fn<MetaFetch>().mockImplementation((url) => {
      const urlStr = String(url)
      if (urlStr.includes('/media')) {
        expect(urlStr).toContain('/me/media')
        return Promise.resolve(jsonResponse({ data: [] }))
      }
      return Promise.resolve(jsonResponse({ data: [] }))
    })

    const result = await ingestChannelComments({
      workspaceId,
      channelConnectionId,
      channel: 'instagram',
      accessToken,
      accountId: '', // empty account ID passed
      repo: mockRepo,
      fetcher,
    })

    expect(fetcher).toHaveBeenCalled()
    expect(result.ingestedCount).toBe(0)
  })

  it('handles API errors without crashing the cycle', async () => {
    const mockRepo = {
      upsertComment: vi.fn(),
    } as unknown as EngagementRepository

    const fetcher: MetaFetch = vi.fn<MetaFetch>().mockRejectedValue(new Error('Network failure'))

    const result = await ingestChannelComments({
      workspaceId,
      channelConnectionId,
      channel: 'instagram',
      accessToken,
      accountId: '17841441250302004',
      repo: mockRepo,
      fetcher,
    })

    expect(result.ingestedCount).toBe(0)
    expect(result.comments).toEqual([])
  })

  it('proves idempotency when a comment is ingested via webhook then via 15-minute polling', async () => {
    // In-memory store simulating the unique constraint on (workspace_id, channel, provider_comment_id)
    const store = new Map<string, SocialComment>()

    const repo: EngagementRepository = {
      upsertComment: vi.fn().mockImplementation((input: any) => {
        const key = `${input.workspace_id}:${input.channel}:${input.provider_comment_id}`
        const existing = store.get(key)
        if (existing) {
          // Idempotent: on conflict ignoreDuplicates or preserve existing row
          return Promise.resolve(existing)
        }
        const created: SocialComment = {
          ...input,
          id: `comment-${store.size + 1}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        store.set(key, created)
        return Promise.resolve(created)
      }),
    } as unknown as EngagementRepository

    const commentTimestamp = new Date().toISOString()
    const providerCommentId = 'comment-shared-123'
    const providerMediaId = 'media-shared-456'

    // Step 1: Webhook arrives immediately and ingests the comment
    const webhookResult = await ingestWebhookComment({
      workspaceId,
      channelConnectionId,
      channel: 'instagram',
      providerCommentId,
      providerMediaId,
      authorHandle: 'some_user',
      authorId: 'user-789',
      commentText: '안녕하세요 문의드립니다',
      commentCreatedAt: commentTimestamp,
      repo,
    })

    expect(webhookResult).not.toBeNull()
    if (!webhookResult) throw new Error('webhookResult must not be null')
    expect(webhookResult.provider_comment_id).toBe(providerCommentId)
    expect(store.size).toBe(1)

    // Step 2: 15 minutes later, regular polling cycle fetches recent media & comments
    const fetcher: MetaFetch = vi.fn<MetaFetch>().mockImplementation((url) => {
      const urlStr = String(url)
      if (urlStr.includes('/media?') || urlStr.includes('/media&')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: providerMediaId, caption: '포스트', timestamp: commentTimestamp }],
        }))
      }
      if (urlStr.includes(`/${providerMediaId}/comments`)) {
        return Promise.resolve(jsonResponse({
          data: [
            {
              id: providerCommentId,
              text: '안녕하세요 문의드립니다',
              timestamp: commentTimestamp,
              username: 'some_user',
            },
          ],
        }))
      }
      return Promise.resolve(jsonResponse({ data: [] }))
    })

    const pollResult = await ingestChannelComments({
      workspaceId,
      channelConnectionId,
      channel: 'instagram',
      accessToken,
      accountId: '17841441250302004',
      repo,
      fetcher,
    })

    // Both steps called upsertComment with the exact same (workspace_id, channel, provider_comment_id)
    expect(repo.upsertComment).toHaveBeenCalledTimes(2)
    // But the unique constraint ensures only exactly 1 record exists in the store!
    expect(store.size).toBe(1)
    const storedComment = store.get(`${workspaceId}:instagram:${providerCommentId}`)
    expect(storedComment).toBeDefined()
    expect(storedComment?.id).toBe(webhookResult!.id)
    expect(pollResult.comments[0]?.id).toBe(webhookResult!.id)
  })

  it('skips webhook comment authored by connected account itself and returns null without saving', async () => {
    const upsertCommentSpy = vi.fn()
    const mockRepo = {
      upsertComment: upsertCommentSpy,
    } as unknown as EngagementRepository

    const result = await ingestWebhookComment({
      workspaceId,
      channelConnectionId,
      channel: 'instagram',
      providerCommentId: 'webhook-self-comment-1',
      providerMediaId: 'media-1',
      authorHandle: 'sohee.ai',
      authorId: '17841441250302004',
      commentText: '안녕하세요! 소중한 댓글 감사드립니다. 문의사항은 DM...',
      commentCreatedAt: new Date().toISOString(),
      repo: mockRepo,
      selfAccountId: '17841441250302004',
      selfAccountHandle: '@sohee.ai',
    })

    expect(result).toBeNull()
    expect(upsertCommentSpy).not.toHaveBeenCalled()
  })

  it('skips comments authored by the connected account itself (by accountId matching authorId) and reports skippedCount', async () => {
    const upserted: any[] = []
    const mockRepo = {
      upsertComment: vi.fn().mockImplementation((input: any) => {
        const comment = { ...input, id: 'db-comment' }
        upserted.push(comment)
        return Promise.resolve(comment)
      }),
    } as unknown as EngagementRepository

    const recentDate = new Date(Date.now() - 3600 * 1000).toISOString()
    const selfAccountId = '17841441250302004'

    const fetcher: MetaFetch = vi.fn<MetaFetch>().mockImplementation((url) => {
      const urlStr = String(url)
      if (urlStr.includes('/media?') || urlStr.includes('/media&')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'media-self-test', caption: '게시물', timestamp: recentDate }],
        }))
      }
      if (urlStr.includes('/comments')) {
        return Promise.resolve(jsonResponse({
          data: [
            {
              id: 'comment-self',
              text: '사장님 본인이 남긴 댓글입니다',
              timestamp: recentDate,
              username: 'sohee.ai',
              from: { id: selfAccountId, username: 'sohee.ai' },
            },
            {
              id: 'comment-customer',
              text: '고객 문의 댓글입니다',
              timestamp: recentDate,
              username: 'customer_user',
              from: { id: '99999999', username: 'customer_user' },
            },
          ],
        }))
      }
      return Promise.resolve(jsonResponse({ data: [] }))
    })

    const result = await ingestChannelComments({
      workspaceId,
      channelConnectionId,
      channel: 'instagram',
      accessToken,
      accountId: selfAccountId,
      repo: mockRepo,
      fetcher,
    })

    expect(result.ingestedCount).toBe(1)
    expect(result.skippedCount).toBe(1)
    expect(mockRepo.upsertComment).toHaveBeenCalledTimes(1)
    expect(upserted[0]?.provider_comment_id).toBe('comment-customer')
  })

  it('skips comments authored by connected account matching username case-insensitively with @ prefix ignored', async () => {
    const upserted: any[] = []
    const mockRepo = {
      upsertComment: vi.fn().mockImplementation((input: any) => {
        const comment = { ...input, id: 'db-comment' }
        upserted.push(comment)
        return Promise.resolve(comment)
      }),
    } as unknown as EngagementRepository

    const recentDate = new Date(Date.now() - 3600 * 1000).toISOString()

    const fetcher: MetaFetch = vi.fn<MetaFetch>().mockImplementation((url) => {
      const urlStr = String(url)
      if (urlStr.includes('/media?') || urlStr.includes('/media&')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'media-username-test', caption: '게시물', timestamp: recentDate }],
        }))
      }
      if (urlStr.includes('/comments')) {
        return Promise.resolve(jsonResponse({
          data: [
            {
              id: 'comment-self-upper',
              text: 'SOHEE 본인 댓글',
              timestamp: recentDate,
              username: 'SoHee.Ai',
            },
            {
              id: 'comment-customer-2',
              text: '궁금한 점이 있어요',
              timestamp: recentDate,
              username: 'someone_else',
            },
          ],
        }))
      }
      return Promise.resolve(jsonResponse({ data: [] }))
    })

    const result = await ingestChannelComments({
      workspaceId,
      channelConnectionId,
      channel: 'instagram',
      accessToken,
      accountId: '17841441250302004',
      accountHandle: '@sohee.ai',
      repo: mockRepo,
      fetcher,
    })

    expect(result.ingestedCount).toBe(1)
    expect(result.skippedCount).toBe(1)
    expect(mockRepo.upsertComment).toHaveBeenCalledTimes(1)
    expect(upserted[0]?.provider_comment_id).toBe('comment-customer-2')
  })

  it('skips self comments on Threads matching accountId as username case-insensitively', async () => {
    const upserted: any[] = []
    const mockRepo = {
      upsertComment: vi.fn().mockImplementation((input: any) => {
        const comment = { ...input, id: 'db-threads-comment' }
        upserted.push(comment)
        return Promise.resolve(comment)
      }),
    } as unknown as EngagementRepository

    const recentDate = new Date(Date.now() - 3600 * 1000).toISOString()

    const fetcher: MetaFetch = vi.fn<MetaFetch>().mockImplementation((url) => {
      const urlStr = String(url)
      if (urlStr.includes('/threads?') || urlStr.includes('/threads&')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'threads-media-1', text: '스레드 본문', timestamp: recentDate }],
        }))
      }
      if (urlStr.includes('/replies')) {
        return Promise.resolve(jsonResponse({
          data: [
            {
              id: 'threads-reply-self',
              text: '스레드 본인 답글입니다',
              timestamp: recentDate,
              username: 'sohee.ai',
            },
            {
              id: 'threads-reply-customer',
              text: '스레드 고객 질문입니다',
              timestamp: recentDate,
              username: 'threads_user_99',
            },
          ],
        }))
      }
      return Promise.resolve(jsonResponse({ data: [] }))
    })

    const result = await ingestChannelComments({
      workspaceId,
      channelConnectionId,
      channel: 'threads',
      accessToken,
      accountId: 'SOHEE.AI',
      repo: mockRepo,
      fetcher,
    })

    expect(result.ingestedCount).toBe(1)
    expect(result.skippedCount).toBe(1)
    expect(mockRepo.upsertComment).toHaveBeenCalledTimes(1)
    expect(upserted[0]?.provider_comment_id).toBe('threads-reply-customer')
  })

  it('does not log comment text or author handle when skipping self comments', async () => {
    const mockRepo = {
      upsertComment: vi.fn().mockResolvedValue({ id: 'dummy' }),
    } as unknown as EngagementRepository

    const consoleWarnSpy = vi.spyOn(console, 'warn')
    const consoleLogSpy = vi.spyOn(console, 'log')
    const consoleInfoSpy = vi.spyOn(console, 'info')

    const recentDate = new Date(Date.now() - 3600 * 1000).toISOString()
    const sensitiveHandle = 'secret_boss_handle'
    const sensitiveText = '사적인 비밀 댓글 본문'

    const fetcher: MetaFetch = vi.fn<MetaFetch>().mockImplementation((url) => {
      const urlStr = String(url)
      if (urlStr.includes('/media')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'media-privacy', caption: '게시물', timestamp: recentDate }],
        }))
      }
      if (urlStr.includes('/comments')) {
        return Promise.resolve(jsonResponse({
          data: [
            {
              id: 'comment-self-private',
              text: sensitiveText,
              timestamp: recentDate,
              username: sensitiveHandle,
            },
          ],
        }))
      }
      return Promise.resolve(jsonResponse({ data: [] }))
    })

    await ingestChannelComments({
      workspaceId,
      channelConnectionId,
      channel: 'instagram',
      accessToken,
      accountId: sensitiveHandle,
      repo: mockRepo,
      fetcher,
    })

    const allLogged = [
      ...consoleWarnSpy.mock.calls.flat(),
      ...consoleLogSpy.mock.calls.flat(),
      ...consoleInfoSpy.mock.calls.flat(),
    ].join(' ')

    expect(allLogged).not.toContain(sensitiveText)
    expect(allLogged).not.toContain(sensitiveHandle)

    consoleWarnSpy.mockRestore()
    consoleLogSpy.mockRestore()
    consoleInfoSpy.mockRestore()
  })

  it('skips boss comments even if they are replies with a parentId, preserving customer replies', async () => {
    const upserted: any[] = []
    const mockRepo = {
      upsertComment: vi.fn().mockImplementation((input: any) => {
        const comment = { ...input, id: `db-${upserted.length + 1}` }
        upserted.push(comment)
        return Promise.resolve(comment)
      }),
    } as unknown as EngagementRepository

    const recentDate = new Date(Date.now() - 3600 * 1000).toISOString()
    const selfId = '17841441250302004'

    const fetcher: MetaFetch = vi.fn<MetaFetch>().mockImplementation((url) => {
      const urlStr = String(url)
      if (urlStr.includes('/media?') || urlStr.includes('/media&')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'media-nested', caption: '게시물', timestamp: recentDate }],
        }))
      }
      if (urlStr.includes('/comments')) {
        return Promise.resolve(jsonResponse({
          data: [
            {
              id: 'comment-parent',
              text: '상품 가격이 어떻게 되나요?',
              timestamp: recentDate,
              username: 'customer_1',
              from: { id: 'cust-id-1', username: 'customer_1' },
            },
            {
              id: 'comment-boss-reply',
              text: '안녕하세요 디엠으로 안내드렸습니다!',
              timestamp: recentDate,
              username: 'sohee.ai',
              from: { id: selfId, username: 'sohee.ai' },
              parent_id: 'comment-parent',
            },
            {
              id: 'comment-other-reply',
              text: '저도 궁금해요',
              timestamp: recentDate,
              username: 'customer_2',
              from: { id: 'cust-id-2', username: 'customer_2' },
              parent_id: 'comment-parent',
            },
          ],
        }))
      }
      return Promise.resolve(jsonResponse({ data: [] }))
    })

    const result = await ingestChannelComments({
      workspaceId,
      channelConnectionId,
      channel: 'instagram',
      accessToken,
      accountId: selfId,
      accountHandle: '@sohee.ai',
      repo: mockRepo,
      fetcher,
    })

    expect(result.ingestedCount).toBe(2)
    expect(result.skippedCount).toBe(1)
    expect(mockRepo.upsertComment).toHaveBeenCalledTimes(2)
    expect(upserted.map((c) => c.provider_comment_id)).toEqual(['comment-parent', 'comment-other-reply'])
  })
})

describe('isSelfComment identity matching', () => {
  it('matches authorId with accountId exactly or case-insensitively', () => {
    expect(isSelfComment({ authorId: '17841441250302004' }, { accountId: '17841441250302004' })).toBe(true)
    expect(isSelfComment({ authorId: 'USER_ID_1' }, { accountId: 'user_id_1' })).toBe(true)
    expect(isSelfComment({ authorId: '999' }, { accountId: '888' })).toBe(false)
  })

  it('matches authorHandle with accountHandle or accountUsername ignoring @ and case', () => {
    expect(isSelfComment({ authorHandle: 'sohee.ai' }, { accountId: '123', accountHandle: '@sohee.ai' })).toBe(true)
    expect(isSelfComment({ authorHandle: '@SOHEE.AI' }, { accountId: '123', accountUsername: 'sohee.ai' })).toBe(true)
    expect(isSelfComment({ authorHandle: 'SOHEE.ai' }, { accountId: '@sohee.ai' })).toBe(true)
    expect(isSelfComment({ authorHandle: 'customer' }, { accountId: '123', accountHandle: '@sohee.ai' })).toBe(false)
  })

  it('matches authorHandle even when accountHandle has trailing label or display text like "sohee.ai (Official)"', () => {
    expect(isSelfComment({ authorHandle: 'sohee.ai' }, { accountHandle: 'sohee.ai (Official)' })).toBe(true)
    expect(isSelfComment({ authorHandle: 'sohee.ai' }, { accountHandle: '@sohee.ai / 소희 공식' })).toBe(true)
  })

  it('handles empty or missing identities safely without throwing', () => {
    expect(isSelfComment({}, { accountId: '' })).toBe(false)
    expect(isSelfComment({ authorId: null, authorHandle: null }, { accountId: '123' })).toBe(false)
    expect(isSelfComment({ authorId: '123' }, { accountId: '', accountHandle: undefined })).toBe(false)
  })
})

