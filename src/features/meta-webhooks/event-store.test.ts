import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { commentParamsFromEvent, createMetaWebhookEventStore } from './event-store'

describe('Meta webhook event store', () => {
  beforeEach(() => {
    process.env.ENGAGEMENT_CYCLE_ENABLED = '1'
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'
  })

  it('stores the normalized root post reference for later work attribution', async () => {
    const gateway = {
      findConnection: vi.fn().mockResolvedValue({
        data: {
          id: '20000000-0000-4000-8000-000000000001',
          workspace_id: '10000000-0000-4000-8000-000000000001',
        },
        error: null,
      }),
      insertEvent: vi.fn().mockResolvedValue({ data: null, error: null }),
      updateHealth: vi.fn().mockResolvedValue({ data: true, error: null }),
    }
    const store = await createMetaWebhookEventStore(gateway)

    await store.record([{
      eventKey: 'threads:reply:reply-1',
      provider: 'threads',
      category: 'reply',
      providerEventId: 'reply-1',
      instagramAccountId: null,
      externalAccountId: 'threads-account-1',
      externalSubjectId: 'customer-1',
      providerPostReference: 'threads-post-1',
      occurredAt: '2026-08-08T01:00:00.000Z',
      payload: { id: 'reply-1', text: '문의', targetId: 'threads-post-1' },
      payloadSha256: 'a'.repeat(64),
    }])

    expect(gateway.insertEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_key: 'threads:reply:reply-1',
      provider_post_reference: 'threads-post-1',
      payload: { id: 'reply-1', text: '문의', targetId: 'threads-post-1' },
      occurred_at: '2026-08-08T01:00:00.000Z',
    }))
    expect(gateway.updateHealth).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '2026-08-08T01:00:00.000Z',
    )
  })

  it('forwards instagram comment to commentSink with parsed fields', async () => {
    const commentSink = vi.fn().mockResolvedValue({ id: 'saved-c1' })
    const gateway = {
      findConnection: vi.fn().mockResolvedValue({
        data: {
          id: 'conn-ig-1',
          workspace_id: '10000000-0000-4000-8000-000000000001',
        },
        error: null,
      }),
      insertEvent: vi.fn().mockResolvedValue({ data: { id: 'evt-1' }, error: null }),
      updateHealth: vi.fn().mockResolvedValue({ data: true, error: null }),
      insertResponseJob: vi.fn().mockResolvedValue({ data: {}, error: null }),
    }
    const store = await createMetaWebhookEventStore(gateway as any, { commentSink })

    await store.record([{
      eventKey: 'instagram:comment:comment-123',
      provider: 'instagram',
      category: 'comment',
      providerEventId: 'comment-123',
      instagramAccountId: 'ig-biz-acc',
      externalAccountId: 'ig-biz-acc',
      externalSubjectId: 'user-456',
      providerPostReference: 'post-789',
      occurredAt: '2026-10-15T09:00:00.000Z',
      payload: {
        id: 'comment-123',
        text: '가격 얼마인가요?',
        targetId: 'post-789',
        from: { username: 'testuser', id: 'user-456' },
      },
      payloadSha256: 'b'.repeat(64),
    }])

    expect(commentSink).toHaveBeenCalledTimes(1)
    expect(commentSink).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: '10000000-0000-4000-8000-000000000001',
      channelConnectionId: 'conn-ig-1',
      channel: 'instagram',
      providerCommentId: 'comment-123',
      providerMediaId: 'post-789',
      authorHandle: 'testuser',
      authorId: 'user-456',
      commentText: '가격 얼마인가요?',
      commentCreatedAt: '2026-10-15T09:00:00.000Z',
    }))
  })

  it('excludes self/echo comments from commentSink', async () => {
    const commentSink = vi.fn().mockResolvedValue({})
    const gateway = {
      findConnection: vi.fn().mockResolvedValue({
        data: { id: 'conn-ig-1', workspace_id: '10000000-0000-4000-8000-000000000001' },
        error: null,
      }),
      insertEvent: vi.fn().mockResolvedValue({ data: { id: 'evt-1' }, error: null }),
      updateHealth: vi.fn().mockResolvedValue({ data: true, error: null }),
      insertResponseJob: vi.fn().mockResolvedValue({ data: {}, error: null }),
    }
    const store = await createMetaWebhookEventStore(gateway as any, { commentSink })

    // Case 1: isSelf: true
    await store.record([{
      eventKey: 'instagram:comment:c-self',
      provider: 'instagram',
      category: 'comment',
      providerEventId: 'c-self',
      instagramAccountId: 'ig-biz-acc',
      externalAccountId: 'ig-biz-acc',
      externalSubjectId: 'cust-1',
      providerPostReference: 'p-1',
      occurredAt: '2026-10-15T09:00:00.000Z',
      payload: { id: 'c-self', text: 'self', isSelf: true },
      payloadSha256: 'c'.repeat(64),
    }])

    // Case 2: externalSubjectId === externalAccountId (our own account)
    await store.record([{
      eventKey: 'instagram:comment:c-echo',
      provider: 'instagram',
      category: 'comment',
      providerEventId: 'c-echo',
      instagramAccountId: 'ig-biz-acc',
      externalAccountId: 'ig-biz-acc',
      externalSubjectId: 'ig-biz-acc',
      providerPostReference: 'p-1',
      occurredAt: '2026-10-15T09:00:00.000Z',
      payload: { id: 'c-echo', text: 'echo' },
      payloadSha256: 'd'.repeat(64),
    }])

    expect(commentSink).not.toHaveBeenCalled()
  })

  it('does not fail webhook response if commentSink throws, logs console.warn without PII', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const commentSink = vi.fn().mockRejectedValue(new Error('database connection timeout'))
    const gateway = {
      findConnection: vi.fn().mockResolvedValue({
        data: { id: 'conn-1', workspace_id: '10000000-0000-4000-8000-000000000001' },
        error: null,
      }),
      insertEvent: vi.fn().mockResolvedValue({ data: { id: 'evt-1' }, error: null }),
      updateHealth: vi.fn().mockResolvedValue({ data: true, error: null }),
      insertResponseJob: vi.fn().mockResolvedValue({ data: {}, error: null }),
    }
    const store = await createMetaWebhookEventStore(gateway as any, { commentSink })

    const text = '비밀댓글 민감정보 포함 본문'
    const handle = 'sensitive_handle_123'
    await expect(store.record([{
      eventKey: 'instagram:comment:c-err',
      provider: 'instagram',
      category: 'comment',
      providerEventId: 'c-err',
      instagramAccountId: 'biz-1',
      externalAccountId: 'biz-1',
      externalSubjectId: 'cust-1',
      providerPostReference: 'p-1',
      occurredAt: '2026-10-15T09:00:00.000Z',
      payload: { id: 'c-err', text, from: { username: handle } },
      payloadSha256: 'e'.repeat(64),
    }])).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith(
      '[webhook-comment-ingest]',
      expect.objectContaining({ reason: 'database connection timeout' })
    )
    // Verify no PII (text or handle) was logged in warnSpy
    for (const call of warnSpy.mock.calls) {
      const serialized = JSON.stringify(call)
      expect(serialized).not.toContain(text)
      expect(serialized).not.toContain(handle)
    }
    expect(logSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('skips commentSink when ENGAGEMENT_CYCLE_ENABLED is disabled', async () => {
    process.env.ENGAGEMENT_CYCLE_ENABLED = 'false'
    const commentSink = vi.fn().mockResolvedValue({})
    const gateway = {
      findConnection: vi.fn().mockResolvedValue({
        data: { id: 'conn-1', workspace_id: '10000000-0000-4000-8000-000000000001' },
        error: null,
      }),
      insertEvent: vi.fn().mockResolvedValue({ data: { id: 'evt-1' }, error: null }),
      updateHealth: vi.fn().mockResolvedValue({ data: true, error: null }),
      insertResponseJob: vi.fn().mockResolvedValue({ data: {}, error: null }),
    }
    const store = await createMetaWebhookEventStore(gateway as any, { commentSink })

    await store.record([{
      eventKey: 'threads:reply:r-1',
      provider: 'threads',
      category: 'reply',
      providerEventId: 'r-1',
      instagramAccountId: null,
      externalAccountId: 'biz-1',
      externalSubjectId: 'cust-1',
      providerPostReference: 'p-1',
      occurredAt: '2026-10-15T09:00:00.000Z',
      payload: { id: 'r-1', text: 'hello' },
      payloadSha256: 'f'.repeat(64),
    }])

    expect(commentSink).not.toHaveBeenCalled()
  })

  it('calls commentSink even on duplicate webhook event (inserted.data is null)', async () => {
    const commentSink = vi.fn().mockResolvedValue({})
    let insertCount = 0
    const gateway = {
      findConnection: vi.fn().mockResolvedValue({
        data: { id: 'conn-1', workspace_id: '10000000-0000-4000-8000-000000000001' },
        error: null,
      }),
      insertEvent: vi.fn().mockImplementation(async () => {
        insertCount += 1
        return insertCount === 1 ? { data: { id: 'evt-1' }, error: null } : { data: null, error: null }
      }),
      updateHealth: vi.fn().mockResolvedValue({ data: true, error: null }),
      insertResponseJob: vi.fn().mockResolvedValue({ data: {}, error: null }),
    }
    const store = await createMetaWebhookEventStore(gateway as any, { commentSink })

    const event = {
      eventKey: 'instagram:comment:c-dup',
      provider: 'instagram' as const,
      category: 'comment' as const,
      providerEventId: 'c-dup',
      instagramAccountId: 'biz-1',
      externalAccountId: 'biz-1',
      externalSubjectId: 'cust-1',
      providerPostReference: 'p-1',
      occurredAt: '2026-10-15T09:00:00.000Z',
      payload: { id: 'c-dup', text: '중복 수신 테스트' },
      payloadSha256: 'g'.repeat(64),
    }

    // Call 1 (first insert)
    await store.record([event])
    // Call 2 (duplicate insert)
    await store.record([event])

    // commentSink is called both times (its underlying storage is idempotent)
    expect(commentSink).toHaveBeenCalledTimes(2)
    // insertResponseJob is called only once on the winning insert
    expect(gateway.insertResponseJob).toHaveBeenCalledTimes(1)
  })

  it('supports gateway.recordComment when custom commentSink option is not passed', async () => {
    const recordComment = vi.fn().mockResolvedValue(undefined)
    const gateway = {
      findConnection: vi.fn().mockResolvedValue({
        data: { id: 'conn-1', workspace_id: '10000000-0000-4000-8000-000000000001' },
        error: null,
      }),
      insertEvent: vi.fn().mockResolvedValue({ data: { id: 'evt-1' }, error: null }),
      updateHealth: vi.fn().mockResolvedValue({ data: true, error: null }),
      insertResponseJob: vi.fn().mockResolvedValue({ data: {}, error: null }),
      recordComment,
    }
    const store = await createMetaWebhookEventStore(gateway as any)

    await store.record([{
      eventKey: 'threads:reply:r-gw',
      provider: 'threads',
      category: 'reply',
      providerEventId: 'r-gw',
      instagramAccountId: null,
      externalAccountId: 'biz-1',
      externalSubjectId: 'cust-1',
      providerPostReference: 'threads-post-9',
      occurredAt: '2026-10-15T09:00:00.000Z',
      payload: { id: 'r-gw', text: 'threads 댓글' },
      payloadSha256: 'h'.repeat(64),
    }])

    expect(recordComment).toHaveBeenCalledTimes(1)
    expect(recordComment).toHaveBeenCalledWith({
      workspaceId: '10000000-0000-4000-8000-000000000001',
      channelConnectionId: 'conn-1',
      event: expect.objectContaining({ providerEventId: 'r-gw' }),
    })
  })

  it('ensures commentSink receives params without repo property', async () => {
    let receivedParams: any = null
    const commentSink = vi.fn().mockImplementation(async (params) => {
      receivedParams = params
      return {}
    })
    const gateway = {
      findConnection: vi.fn().mockResolvedValue({
        data: { id: 'conn-1', workspace_id: '10000000-0000-4000-8000-000000000001' },
        error: null,
      }),
      insertEvent: vi.fn().mockResolvedValue({ data: { id: 'evt-1' }, error: null }),
      updateHealth: vi.fn().mockResolvedValue({ data: true, error: null }),
      insertResponseJob: vi.fn().mockResolvedValue({ data: {}, error: null }),
    }
    const store = await createMetaWebhookEventStore(gateway as any, { commentSink })

    await store.record([{
      eventKey: 'instagram:comment:c-no-repo',
      provider: 'instagram',
      category: 'comment',
      providerEventId: 'c-no-repo',
      instagramAccountId: 'biz-1',
      externalAccountId: 'biz-1',
      externalSubjectId: 'cust-1',
      providerPostReference: 'p-1',
      occurredAt: '2026-10-15T09:00:00.000Z',
      payload: { id: 'c-no-repo', text: 'repo 없음 검증', authorHandle: 'someuser' },
      payloadSha256: 'i'.repeat(64),
    }])

    expect(commentSink).toHaveBeenCalledTimes(1)
    expect(receivedParams).not.toBeNull()
    expect('repo' in receivedParams).toBe(false)
  })
})

describe('commentParamsFromEvent helper (Defect 2)', () => {
  const connection = { id: 'conn-1', workspace_id: 'ws-1' }

  it('maps valid comment event to params without repo', () => {
    const event = {
      eventKey: 'instagram:comment:c-1',
      provider: 'instagram' as const,
      category: 'comment' as const,
      providerEventId: 'c-1',
      instagramAccountId: 'biz-account',
      externalAccountId: 'biz-account',
      externalSubjectId: 'user-1',
      providerPostReference: 'media-1',
      occurredAt: '2026-10-15T09:00:00.000Z',
      payload: {
        id: 'c-1',
        text: '댓글 본문',
        authorHandle: 'handle_from_payload',
        from: { id: 'user-1', username: 'handle_from_nested' },
      },
      payloadSha256: 'a'.repeat(64),
    }

    const params = commentParamsFromEvent(event, connection)
    expect(params).not.toBeNull()
    expect(params).toEqual({
      workspaceId: 'ws-1',
      channelConnectionId: 'conn-1',
      channel: 'instagram',
      providerCommentId: 'c-1',
      providerMediaId: 'media-1',
      authorHandle: 'handle_from_nested',
      authorId: 'user-1',
      commentText: '댓글 본문',
      commentCreatedAt: '2026-10-15T09:00:00.000Z',
      selfAccountId: 'biz-account',
      selfAccountHandle: null,
      selfAccountUsername: null,
    })
    expect('repo' in (params as any)).toBe(false)
  })

  it('returns null for self/echo/deleted comments', () => {
    const base = {
      eventKey: 'instagram:comment:c-1',
      provider: 'instagram' as const,
      category: 'comment' as const,
      providerEventId: 'c-1',
      instagramAccountId: 'biz-account',
      externalAccountId: 'biz-account',
      externalSubjectId: 'user-1',
      providerPostReference: 'media-1',
      occurredAt: '2026-10-15T09:00:00.000Z',
      payloadSha256: 'a'.repeat(64),
    }

    expect(commentParamsFromEvent({ ...base, payload: { id: 'c-1', text: 'hi', isSelf: true } }, connection)).toBeNull()
    expect(commentParamsFromEvent({ ...base, payload: { id: 'c-1', text: 'hi', isEcho: true } }, connection)).toBeNull()
    expect(commentParamsFromEvent({ ...base, payload: { id: 'c-1', text: 'hi', isDeleted: true } }, connection)).toBeNull()
  })

  it('returns null when externalSubjectId or from.id matches own business account', () => {
    const base = {
      eventKey: 'instagram:comment:c-1',
      provider: 'instagram' as const,
      category: 'comment' as const,
      providerEventId: 'c-1',
      instagramAccountId: 'biz-account',
      externalAccountId: 'biz-account',
      providerPostReference: 'media-1',
      occurredAt: '2026-10-15T09:00:00.000Z',
      payloadSha256: 'a'.repeat(64),
    }

    // externalSubjectId matches externalAccountId
    expect(commentParamsFromEvent({
      ...base,
      externalSubjectId: 'biz-account',
      payload: { id: 'c-1', text: 'hi' },
    }, connection)).toBeNull()

    // from.id matches externalAccountId
    expect(commentParamsFromEvent({
      ...base,
      externalSubjectId: 'other-id',
      payload: { id: 'c-1', text: 'hi', from: { id: 'biz-account' } },
    }, connection)).toBeNull()
  })
})

