import { describe, expect, it, vi } from 'vitest'
import { handleMetaWebhook, type NormalizedMetaEvent } from './handler'

const encoder = new TextEncoder()

async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)))
  return `sha256=${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

describe('handleMetaWebhook normalize payload authorHandle (Defect 1)', () => {
  const secret = 'test-secret'
  const verifyToken = 'test-token'

  it('includes authorHandle in minimalPayload for Instagram comment when value.from.username is present', async () => {
    const recorded: NormalizedMetaEvent[] = []
    const eventStore = {
      record: vi.fn(async (events: readonly NormalizedMetaEvent[]) => {
        recorded.push(...events)
      }),
    }

    const body = JSON.stringify({
      object: 'instagram',
      entry: [{
        id: 'ig-account-1',
        time: 1720000000,
        changes: [{
          field: 'comments',
          value: {
            id: 'comment-123',
            text: '예약 문의합니다',
            from: { id: 'user-456', username: 'beauty_lover' },
            media: { id: 'media-789' },
          },
        }],
      }],
    })

    const response = await handleMetaWebhook(
      new Request('https://example.com/api/webhooks/instagram', {
        method: 'POST',
        headers: { 'x-hub-signature-256': await sign(secret, body) },
        body,
      }),
      { provider: 'instagram', verifyToken, appSecret: secret, eventStore },
    )

    expect(response.status).toBe(200)
    expect(recorded).toHaveLength(1)
    expect(recorded[0].payload).toEqual({
      id: 'comment-123',
      text: '예약 문의합니다',
      targetId: 'media-789',
      authorHandle: 'beauty_lover',
    })
  })

  it('includes authorHandle in minimalPayload for Threads reply when value.username is present', async () => {
    const recorded: NormalizedMetaEvent[] = []
    const eventStore = {
      record: vi.fn(async (events: readonly NormalizedMetaEvent[]) => {
        recorded.push(...events)
      }),
    }

    const body = JSON.stringify({
      object: 'threads',
      entry: [{
        id: 'threads-account-1',
        time: 1720000000,
        changes: [{
          field: 'replies',
          value: {
            id: 'reply-123',
            text: '스레드 답글',
            username: 'threads_user',
            replied_to: { id: 'post-999' },
          },
        }],
      }],
    })

    const response = await handleMetaWebhook(
      new Request('https://example.com/api/webhooks/threads', {
        method: 'POST',
        headers: { 'x-hub-signature-256': await sign(secret, body) },
        body,
      }),
      { provider: 'threads', verifyToken, appSecret: secret, eventStore },
    )

    expect(response.status).toBe(200)
    expect(recorded).toHaveLength(1)
    expect(recorded[0].payload).toEqual({
      id: 'reply-123',
      text: '스레드 답글',
      targetId: 'post-999',
      authorHandle: 'threads_user',
    })
  })

  it('omits authorHandle if it is non-string or exceeds 100 characters', async () => {
    const recorded: NormalizedMetaEvent[] = []
    const eventStore = {
      record: vi.fn(async (events: readonly NormalizedMetaEvent[]) => {
        recorded.push(...events)
      }),
    }

    const body = JSON.stringify({
      object: 'instagram',
      entry: [{
        id: 'ig-account-1',
        time: 1720000000,
        changes: [
          {
            field: 'comments',
            value: {
              id: 'comment-toolong',
              text: '긴 핸들 테스트',
              from: { id: 'user-1', username: 'a'.repeat(101) },
              media: { id: 'media-1' },
            },
          },
          {
            field: 'comments',
            value: {
              id: 'comment-nonstring',
              text: '비문자열 핸들 테스트',
              from: { id: 'user-2', username: 12345 },
              media: { id: 'media-2' },
            },
          },
        ],
      }],
    })

    const response = await handleMetaWebhook(
      new Request('https://example.com/api/webhooks/instagram', {
        method: 'POST',
        headers: { 'x-hub-signature-256': await sign(secret, body) },
        body,
      }),
      { provider: 'instagram', verifyToken, appSecret: secret, eventStore },
    )

    expect(response.status).toBe(200)
    expect(recorded).toHaveLength(2)
    expect(recorded[0].payload).toEqual({
      id: 'comment-toolong',
      text: '긴 핸들 테스트',
      targetId: 'media-1',
    })
    expect(recorded[1].payload).toEqual({
      id: 'comment-nonstring',
      text: '비문자열 핸들 테스트',
      targetId: 'media-2',
    })
  })

  it('does NOT include authorHandle for mention events (payload and hash unchanged)', async () => {
    const recorded: NormalizedMetaEvent[] = []
    const eventStore = {
      record: vi.fn(async (events: readonly NormalizedMetaEvent[]) => {
        recorded.push(...events)
      }),
    }

    const body = JSON.stringify({
      object: 'instagram',
      entry: [{
        id: 'ig-account-1',
        time: 1720000000,
        changes: [{
          field: 'mentions',
          value: {
            comment_id: 'mention-comment-1',
            text: '@sohee 멘션 테스트',
            from: { id: 'user-mentioner', username: 'mentioner_handle' },
            media: { id: 'media-mention' },
          },
        }],
      }],
    })

    const response = await handleMetaWebhook(
      new Request('https://example.com/api/webhooks/instagram', {
        method: 'POST',
        headers: { 'x-hub-signature-256': await sign(secret, body) },
        body,
      }),
      { provider: 'instagram', verifyToken, appSecret: secret, eventStore },
    )

    expect(response.status).toBe(200)
    expect(recorded).toHaveLength(1)
    expect(recorded[0].payload).toEqual({
      id: 'mention-comment-1',
      text: '@sohee 멘션 테스트',
      targetId: 'media-mention',
    })
    expect((recorded[0].payload as any).authorHandle).toBeUndefined()
  })

  it('does NOT change payload or hash for DM events', async () => {
    const recorded: NormalizedMetaEvent[] = []
    const eventStore = {
      record: vi.fn(async (events: readonly NormalizedMetaEvent[]) => {
        recorded.push(...events)
      }),
    }

    const body = JSON.stringify({
      object: 'instagram',
      entry: [{
        id: 'ig-account-1',
        time: 1720000000,
        messaging: [{
          message: {
            mid: 'dm-mid-1',
            text: '안녕하세요 DM',
          },
          sender: { id: 'sender-1' },
          recipient: { id: 'ig-account-1' },
          timestamp: 1720000000,
        }],
      }],
    })

    const response = await handleMetaWebhook(
      new Request('https://example.com/api/webhooks/instagram', {
        method: 'POST',
        headers: { 'x-hub-signature-256': await sign(secret, body) },
        body,
      }),
      { provider: 'instagram', verifyToken, appSecret: secret, eventStore },
    )

    expect(response.status).toBe(200)
    expect(recorded).toHaveLength(1)
    expect(recorded[0].payload).toEqual({
      id: 'dm-mid-1',
      text: '안녕하세요 DM',
      targetId: null,
      recipientId: 'ig-account-1',
      isEcho: false,
      isSelf: false,
      isDeleted: false,
    })
  })
})
