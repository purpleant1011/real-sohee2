import { describe, expect, it, vi } from 'vitest'
import {
  createInstagramProvider,
  createThreadsProvider,
  listRecentPublishedMetaPosts,
  MetaProviderError,
  type MetaFetch,
} from './meta-api'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Meta server-only publishing adapters', () => {
  it('publishes an Instagram image container and then the exact container', async () => {
    const fetcher = vi.fn<MetaFetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'container-1' }))
      .mockResolvedValueOnce(jsonResponse({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'post-1' }))
      .mockResolvedValueOnce(jsonResponse({ permalink: 'https://www.instagram.com/p/POST1/' }))
    const provider = createInstagramProvider(fetcher)
    const onContainerCreated = vi.fn().mockResolvedValue(undefined)

    await expect(provider.publish({
      accountId: 'ig-account-1',
      accessToken: 'secret-token',
      caption: '승인된 본문 #소희',
      imageUrls: ['https://media.example.test/one.jpg'],
      isAiGenerated: true,
      onContainerCreated,
    })).resolves.toEqual({
      providerPostId: 'post-1',
      destinationUrl: 'https://www.instagram.com/p/POST1/',
    })

    expect(onContainerCreated).toHaveBeenCalledOnce()
    expect(onContainerCreated).toHaveBeenCalledWith('container-1')
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://graph.instagram.com/v26.0/ig-account-1/media')
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer secret-token')
    const createBody = fetcher.mock.calls[0]?.[1]?.body as URLSearchParams
    expect(createBody.get('image_url')).toBe('https://media.example.test/one.jpg')
    expect(createBody.get('caption')).toBe('승인된 본문 #소희')
    expect(createBody.get('is_ai_generated')).toBe('true')
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://graph.instagram.com/v26.0/container-1?fields=status_code')
    const publishBody = fetcher.mock.calls[2]?.[1]?.body as URLSearchParams
    expect(publishBody.get('creation_id')).toBe('container-1')
    expect(fetcher.mock.calls[3]?.[0]).toBe('https://graph.instagram.com/v26.0/post-1?fields=permalink')
  })

  it('publishes a Threads text post through create and publish', async () => {
    const fetcher = vi.fn<MetaFetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'thread-container-1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'thread-post-1' }))
      .mockResolvedValueOnce(jsonResponse({ permalink: 'https://www.threads.com/@sohee.ai/post/THREAD1' }))
    const provider = createThreadsProvider(fetcher)
    const onContainerCreated = vi.fn().mockResolvedValue(undefined)

    await expect(provider.publish({
      accountId: 'threads-user-1',
      accessToken: 'secret-token',
      text: '승인된 Threads 본문',
      imageUrls: [],
      onContainerCreated,
    })).resolves.toEqual({
      providerPostId: 'thread-post-1',
      destinationUrl: 'https://www.threads.com/@sohee.ai/post/THREAD1',
    })

    expect(onContainerCreated).toHaveBeenCalledWith('thread-container-1')
    const createBody = fetcher.mock.calls[0]?.[1]?.body as URLSearchParams
    expect(createBody.get('media_type')).toBe('TEXT')
    expect(createBody.get('text')).toBe('승인된 Threads 본문')
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://graph.threads.net/v1.0/thread-container-1?fields=status%2Cerror_message')
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      'https://graph.threads.net/v1.0/threads-user-1/threads_publish',
    )
    expect(fetcher.mock.calls[3]?.[0]).toBe('https://graph.threads.net/v1.0/thread-post-1?fields=permalink')
    expect(fetcher.mock.calls.every(([url]) => !url.includes('secret-token'))).toBe(true)
  })

  it('bounds every publishing request, including processing and permalink reads', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      const fetcher = vi.fn<MetaFetch>()
        .mockResolvedValueOnce(jsonResponse({ id: 'container-1' }))
        .mockResolvedValueOnce(jsonResponse({ status: 'FINISHED' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'post-1' }))
        .mockResolvedValueOnce(jsonResponse({ permalink: 'https://www.threads.com/@sohee/post/ONE' }))
      await createThreadsProvider(fetcher).publish({
        accountId: 'threads-user-1', accessToken: 'secret-token', text: '승인 본문', imageUrls: [],
      })
      expect(fetcher.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true)
      expect(timeout).toHaveBeenCalledTimes(4)
      expect(timeout.mock.calls.every(([milliseconds]) => milliseconds === 15_000)).toBe(true)
    } finally {
      timeout.mockRestore()
    }
  })

  it('keeps a successful publish when the optional permalink lookup fails', async () => {
    const fetcher = vi.fn<MetaFetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'container-1' }))
      .mockResolvedValueOnce(jsonResponse({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'post-1' }))
      .mockRejectedValueOnce(new Error('lookup unavailable'))
    const provider = createInstagramProvider(fetcher)

    await expect(provider.publish({
      accountId: 'ig-account-1',
      accessToken: 'secret-token',
      caption: '승인된 본문',
      imageUrls: ['https://media.example.test/one.jpg'],
      isAiGenerated: false,
    })).resolves.toEqual({ providerPostId: 'post-1', destinationUrl: null })
  })

  it('waits for asynchronous Threads media processing before the public publish call', async () => {
    const fetcher = vi.fn<MetaFetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'thread-container-2' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'thread-post-2' }))
    const delay = vi.fn().mockResolvedValue(undefined)
    const provider = createThreadsProvider(fetcher, delay)
    await expect(provider.publish({
      accountId: 'threads-user-1', accessToken: 'secret-token', text: '준비 대기', imageUrls: [],
    })).resolves.toEqual({ providerPostId: 'thread-post-2', destinationUrl: null })
    expect(delay).toHaveBeenCalledWith(1_000)
    expect(fetcher.mock.calls.at(-2)?.[0]).toContain('/threads_publish')
  })

  it('stops before publishing when the durable container checkpoint cannot be recorded', async () => {
    const fetcher = vi.fn<MetaFetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'container-unrecorded' }))
    const provider = createInstagramProvider(fetcher)

    await expect(provider.publish({
      accountId: 'ig-account-1',
      accessToken: 'secret-token',
      caption: '승인 본문',
      imageUrls: ['https://media.example.test/one.jpg'],
      isAiGenerated: false,
      onContainerCreated: vi.fn().mockRejectedValue(new Error('database unavailable')),
    })).rejects.toMatchObject({ code: 'RESULT_UNKNOWN' } satisfies Partial<MetaProviderError>)

    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each(['comment', 'dm'] as const)('keeps a lost %s acknowledgement unknown without retrying', async (kind) => {
    const fetcher = vi.fn<MetaFetch>().mockRejectedValue(new Error('socket closed'))
    const provider = createInstagramProvider(fetcher)
    const input = { accountId: 'account-1', targetId: 'comment-1', recipientId: 'recipient-1', accessToken: 'test-token', text: '승인 답변' }
    await expect(kind === 'comment' ? provider.sendCommentReply(input) : provider.sendDirectMessage(input))
      .rejects.toMatchObject({ code: 'RESULT_UNKNOWN' })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each(['comment', 'dm'] as const)('does not dispatch a pre-cancelled %s request', async (kind) => {
    const fetcher = vi.fn<MetaFetch>().mockResolvedValue(jsonResponse({ id: 'sent-1' }))
    const provider = createInstagramProvider(fetcher)
    const controller = new AbortController()
    controller.abort()
    const input = { accountId: 'account-1', targetId: 'comment-1', recipientId: 'recipient-1', accessToken: 'test-token', text: '승인 답변', signal: controller.signal }
    await expect(kind === 'comment' ? provider.sendCommentReply(input) : provider.sendDirectMessage(input))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('propagates in-flight cancellation while keeping a dispatched DM unknown', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<MetaFetch>().mockImplementation(async (_url, init) => {
      controller.abort()
      if (!init?.signal?.aborted) throw new Error('caller signal was not propagated')
      init.signal.throwIfAborted()
      return jsonResponse({ id: 'unreachable' })
    })
    await expect(createInstagramProvider(fetcher).sendDirectMessage({
      accountId: 'account-1', recipientId: 'recipient-1', accessToken: 'test-token', text: '승인 답변', signal: controller.signal,
    })).rejects.toMatchObject({ code: 'RESULT_UNKNOWN' })
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('blocks Threads publish after cancellation during container readiness', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<MetaFetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'container-1' }))
      .mockImplementationOnce(async () => {
        controller.abort()
        return jsonResponse({ status: 'FINISHED' })
      })
      .mockResolvedValue(jsonResponse({ id: 'must-not-publish' }))
    await expect(createThreadsProvider(fetcher).sendReply({
      accountId: 'account-1', targetId: 'comment-1', accessToken: 'test-token', text: '승인 답변', signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('preserves an acknowledged DM even if cancellation arrives with the acknowledgement', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn<MetaFetch>().mockImplementation(async () => {
      controller.abort()
      return jsonResponse({ message_id: 'acknowledged-1' })
    })
    await expect(createInstagramProvider(fetcher).sendDirectMessage({
      accountId: 'account-1', recipientId: 'recipient-1', accessToken: 'test-token', text: '승인 답변', signal: controller.signal,
    })).resolves.toEqual({ providerMessageId: 'acknowledged-1' })
  })

  it('does not retain sensitive transport error text in errors or logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn<MetaFetch>().mockRejectedValue(new Error('test-token private-request-payload'))
    try {
      const failure = await createInstagramProvider(fetcher).sendDirectMessage({
        accountId: 'account-1', recipientId: 'recipient-1', accessToken: 'test-token', text: '승인 답변',
      }).catch((error: unknown) => error)
      expect(String(failure)).not.toContain('test-token')
      expect(String(failure)).not.toContain('private-request-payload')
      expect(JSON.stringify(log.mock.calls)).not.toContain('test-token')
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-request-payload')
    } finally {
      log.mockRestore()
    }
  })

  it('creates outbound replies and Instagram DM without exposing a token in errors', async () => {
    const fetcher = vi.fn<MetaFetch>().mockResolvedValue(jsonResponse({
      error: { message: 'token secret-token rejected', code: 190 },
    }, 401))
    const instagram = createInstagramProvider(fetcher)

    await expect(instagram.sendDirectMessage({
      accountId: 'ig-account-1',
      recipientId: 'ig-scoped-user-1',
      accessToken: 'secret-token',
      text: '답변 초안',
    })).rejects.not.toThrow('secret-token')
  })

  it('classifies a lost final publish response as unknown so it cannot be retried blindly', async () => {
    const fetcher = vi.fn<MetaFetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'container-unknown' }))
      .mockResolvedValueOnce(jsonResponse({ status_code: 'FINISHED' }))
      .mockRejectedValueOnce(new Error('socket closed'))
    const provider = createInstagramProvider(fetcher)
    await expect(provider.publish({
      accountId: 'ig-account-1', accessToken: 'secret-token', caption: '승인 본문',
      imageUrls: ['https://media.example.test/one.jpg'], isAiGenerated: false,
    })).rejects.toMatchObject({ code: 'RESULT_UNKNOWN' } satisfies Partial<MetaProviderError>)
  })

  it.each(['malformed-json', 'missing-id', 'null', 'primitive'])('keeps an ambiguous successful publish response unknown: %s', async (kind) => {
    const fetcher = vi.fn<MetaFetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'container-unknown' }))
      .mockResolvedValueOnce(jsonResponse({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(kind === 'malformed-json'
        ? new Response('not-json', { status: 200 })
        : jsonResponse(kind === 'null' ? null : kind === 'primitive' ? 'accepted' : {}))
    await expect(createInstagramProvider(fetcher).publish({
      accountId: 'ig-account-1', accessToken: 'secret-token', caption: '승인 본문',
      imageUrls: ['https://media.example.test/one.jpg'], isAiGenerated: false,
    })).rejects.toMatchObject({ code: 'RESULT_UNKNOWN' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('retains only opaque Meta code, subcode, and category for a rejected Instagram request', async () => {
    const sensitiveMessage = 'signed media URL https://media.example.test/one.jpg?token=must-not-survive'
    const fetcher = vi.fn<MetaFetch>().mockResolvedValue(jsonResponse({
      error: {
        message: sensitiveMessage,
        type: 'InstagramApiException',
        code: 36003,
        error_subcode: 2207009,
        fbtrace_id: 'must-not-survive',
      },
    }, 400))
    const provider = createInstagramProvider(fetcher)

    let rejected: unknown
    try {
      await provider.publish({
        accountId: 'ig-account-1',
        accessToken: 'secret-token',
        caption: '승인 본문',
        imageUrls: ['https://media.example.test/one.jpg'],
        isAiGenerated: false,
      })
    } catch (error) {
      rejected = error
    }

    expect(rejected).toMatchObject({
      code: 'PROVIDER_REJECTED',
      diagnosticCode: 'META_C36003_S2207009_VALIDATION',
    } satisfies Partial<MetaProviderError>)
    expect(JSON.stringify(rejected)).not.toContain(sensitiveMessage)
    expect(JSON.stringify(rejected)).not.toContain('must-not-survive')
    expect(JSON.stringify(rejected)).not.toContain('secret-token')
  })

  it('loads only bounded public post facts for official reconciliation', async () => {
    const fetcher = vi.fn<MetaFetch>().mockResolvedValue(jsonResponse({ data: [
      { id: 'post-1', caption: '승인된 본문', timestamp: '2026-08-14T01:20:00+0000' },
      { id: 'post-2', caption: '이전 본문', timestamp: '2026-08-13T01:20:00+0000' },
      { id: 'post-3', timestamp: '2026-08-12T01:20:00+0000' },
    ] }))

    await expect(listRecentPublishedMetaPosts({
      channel: 'instagram', accountId: 'ig-account-1', accessToken: 'secret-token', fetcher,
    })).resolves.toEqual([
      { id: 'post-1', text: '승인된 본문', timestamp: '2026-08-14T01:20:00+0000' },
      { id: 'post-2', text: '이전 본문', timestamp: '2026-08-13T01:20:00+0000' },
      { id: 'post-3', text: '', timestamp: '2026-08-12T01:20:00+0000' },
    ])

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://graph.instagram.com/v26.0/ig-account-1/media?fields=id%2Ccaption%2Ctimestamp&limit=50',
    )
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer secret-token')
    expect(fetcher.mock.calls[0]?.[0]).not.toContain('secret-token')
  })

  it('lists comments on an Instagram media item and performs reply readback', async () => {
    const fetcher = vi.fn<MetaFetch>()
      .mockResolvedValueOnce(jsonResponse({
        data: [
          { id: 'comment-1', text: '좋은 상품이네요', timestamp: '2026-10-01T10:00:00+0000', username: 'cust1' },
          { id: 'comment-2', text: '문의합니다', timestamp: '2026-10-01T11:00:00+0000', from: { id: 'u2', username: 'cust2' }, parent_id: 'comment-1' },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'reply-1',
        text: '감사합니다!',
        timestamp: '2026-10-01T12:00:00+0000',
        username: 'our_shop',
      }))

    const provider = createInstagramProvider(fetcher)
    const comments = await provider.listComments({ mediaId: 'media-1', accessToken: 'secret-token' })
    expect(comments).toHaveLength(2)
    expect(comments[0]?.authorHandle).toBe('cust1')
    expect(comments[1]?.authorHandle).toBe('cust2')
    expect(comments[1]?.authorId).toBe('u2')
    expect(comments[1]?.parentId).toBe('comment-1')

    const readback = await provider.getCommentReplyReadback({ replyId: 'reply-1', accessToken: 'secret-token' })
    expect(readback.isLive).toBe(true)
    expect(readback.replyId).toBe('reply-1')
    expect(readback.text).toBe('감사합니다!')
  })

  it('lists replies on a Threads post and performs reply readback', async () => {
    const fetcher = vi.fn<MetaFetch>()
      .mockResolvedValueOnce(jsonResponse({
        data: [
          { id: 'reply-t-1', text: '스레드 댓글입니다', timestamp: '2026-10-01T10:00:00+0000', username: 'threads_user', from: { id: 'th-u1' }, parent_id: 'parent-th-post' },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'reply-t-2',
        text: '스레드 답변입니다',
        timestamp: '2026-10-01T12:00:00+0000',
        username: 'our_threads',
      }))

    const provider = createThreadsProvider(fetcher)
    const replies = await provider.listReplies({ mediaId: 'th-media-1', accessToken: 'secret-token' })
    expect(replies).toHaveLength(1)
    expect(replies[0]?.id).toBe('reply-t-1')
    expect(replies[0]?.authorId).toBe('th-u1')
    expect(replies[0]?.parentId).toBe('parent-th-post')

    const readback = await provider.getReplyReadback({ replyId: 'reply-t-2', accessToken: 'secret-token' })
    expect(readback.isLive).toBe(true)
    expect(readback.replyId).toBe('reply-t-2')
  })
})
