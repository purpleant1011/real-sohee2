import { describe, expect, it, vi } from 'vitest'
import type { NormalizedMetaEvent } from '@/features/meta-webhooks/handler'
import { handleInstagramWebhook } from './handler'

const encoder = new TextEncoder()

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)))
  return `sha256=${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://example.com${path}`, init)
}

function options() {
  return {
    verifyToken: 'test-verify-token',
    appSecret: 'test-app-secret',
    eventStore: { record: vi.fn(async (events: readonly NormalizedMetaEvent[]) => { void events }) },
  }
}

describe('Instagram webhook verification', () => {
  it('returns the challenge only for subscribe with the configured verification token', async () => {
    const response = await handleInstagramWebhook(
      request('/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge-123'),
      options(),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    await expect(response.text()).resolves.toBe('challenge-123')
  })

  it('rejects a mismatched verification token without echoing either token', async () => {
    const response = await handleInstagramWebhook(
      request('/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-123'),
      options(),
    )

    expect(response.status).toBe(403)
    await expect(response.text()).resolves.toBe('Forbidden')
  })

  it('returns unavailable when a required server secret is absent', async () => {
    const source = options()
    const getResponse = await handleInstagramWebhook(
      request('/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge-123'),
      { ...source, verifyToken: undefined },
    )
    const postResponse = await handleInstagramWebhook(
      request('/api/webhooks/instagram', { method: 'POST', body: '{}' }),
      { ...source, appSecret: undefined },
    )

    expect(getResponse.status).toBe(503)
    expect(postResponse.status).toBe(503)
    expect(source.eventStore.record).not.toHaveBeenCalled()
  })
})

describe('Instagram webhook event intake', () => {
  it('rejects a missing, malformed, or mismatched signature before parsing or storage', async () => {
    const source = options()
    const invalidSignatures = [undefined, 'sha256=not-hex', `sha256=${'0'.repeat(64)}`]

    for (const signature of invalidSignatures) {
      const headers = new Headers({ 'content-type': 'application/json' })
      if (signature) headers.set('x-hub-signature-256', signature)
      const response = await handleInstagramWebhook(
        request('/api/webhooks/instagram', { method: 'POST', headers, body: 'not-json' }),
        source,
      )
      expect(response.status).toBe(401)
      await expect(response.text()).resolves.toBe('Unauthorized')
    }

    expect(source.eventStore.record).not.toHaveBeenCalled()
  })

  it('normalizes verified comments, mentions, and DMs without retaining private provider fields', async () => {
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{
        id: 'ig-business-1',
        time: 1_723_456_789,
        changes: [
          {
            field: 'comments',
            value: {
              id: 'comment-123', media: { id: 'media-456' }, text: '예약 가능한가요?',
              profile: { email: 'private-profile-field' },
            },
          },
          {
            field: 'mentions',
            value: {
              comment_id: 'mention-comment-1', media_id: 'mention-media-1', text: '@sohee 궁금해요',
              private_note: 'private-profile-field',
            },
          },
        ],
        messaging: [{
          sender: { id: 'ig-user-3' },
          recipient: { id: 'ig-business-1' },
          timestamp: 1_723_456_790_000,
          message: { mid: 'dm-mid-789', text: '가격이 궁금해요', attachments: [{ private: 'private-profile-field' }] },
        }],
      }],
    })
    const source = options()
    const response = await handleInstagramWebhook(
      request('/api/webhooks/instagram', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': await sign(source.appSecret, body),
        },
        body,
      }),
      source,
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('EVENT_RECEIVED')
    expect(source.eventStore.record).toHaveBeenCalledOnce()
    const events = source.eventStore.record.mock.calls[0]?.[0]
    expect(events?.map((event) => event.category)).toEqual(['comment', 'mention', 'dm'])
    expect(JSON.stringify(events)).not.toContain('private-profile-field')
    expect(source.eventStore.record).toHaveBeenCalledWith([
      expect.objectContaining({
        eventKey: 'instagram:comment:comment-123',
        category: 'comment',
        providerEventId: 'comment-123',
        instagramAccountId: 'ig-business-1',
        providerPostReference: 'media-456',
        occurredAt: '2024-08-12T09:59:49.000Z',
        payload: { id: 'comment-123', text: '예약 가능한가요?', targetId: 'media-456' },
        payloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
      expect.objectContaining({
        eventKey: 'instagram:mention:mention-comment-1',
        category: 'mention',
        providerEventId: 'mention-comment-1',
        providerPostReference: 'mention-media-1',
        payload: { id: 'mention-comment-1', text: '@sohee 궁금해요', targetId: 'mention-media-1' },
      }),
      expect.objectContaining({
        eventKey: 'instagram:dm:dm-mid-789',
        category: 'dm',
        providerEventId: 'dm-mid-789',
        instagramAccountId: 'ig-business-1',
        providerPostReference: null,
        occurredAt: '2024-08-12T09:59:50.000Z',
        payload: {
          id: 'dm-mid-789',
          text: '가격이 궁금해요',
          targetId: null,
          recipientId: 'ig-business-1',
          isEcho: false,
          isSelf: false,
          isDeleted: false,
        },
        payloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ])
  })

  it('uses a raw-body digest fallback when a delivery has no provider event id', async () => {
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: 'ig-business-1', changes: [{ field: 'comments', value: { text: '문의' } }] }],
    })
    const source = options()

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await handleInstagramWebhook(
        request('/api/webhooks/instagram', {
          method: 'POST',
          headers: { 'x-hub-signature-256': await sign(source.appSecret, body) },
          body,
        }),
        source,
      )
      expect(response.status).toBe(200)
    }

    const first = source.eventStore.record.mock.calls[0]?.[0][0]
    const second = source.eventStore.record.mock.calls[1]?.[0][0]
    expect(first?.eventKey).toMatch(/^instagram:comment:[0-9a-f]{64}:0:0$/)
    expect(second?.eventKey).toBe(first?.eventKey)
  })

  it('returns a retryable server error without provider details when durable recording fails', async () => {
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: 'ig-business-1', changes: [{ field: 'comments', value: { id: 'comment-failure' } }] }],
    })
    const source = options()
    source.eventStore.record.mockRejectedValueOnce(new Error('provider credential detail'))
    const response = await handleInstagramWebhook(
      request('/api/webhooks/instagram', {
        method: 'POST',
        headers: { 'x-hub-signature-256': await sign(source.appSecret, body) },
        body,
      }),
      source,
    )

    expect(response.status).toBe(500)
    await expect(response.text()).resolves.toBe('Webhook storage failed')
  })

  it('rejects a signed oversized body and signed malformed JSON', async () => {
    const source = options()
    const oversized = JSON.stringify({ object: 'instagram', padding: 'x'.repeat(1_048_576) })
    const oversizedResponse = await handleInstagramWebhook(
      request('/api/webhooks/instagram', {
        method: 'POST',
        headers: { 'x-hub-signature-256': await sign(source.appSecret, oversized) },
        body: oversized,
      }),
      source,
    )
    const malformed = '{'
    const malformedResponse = await handleInstagramWebhook(
      request('/api/webhooks/instagram', {
        method: 'POST',
        headers: { 'x-hub-signature-256': await sign(source.appSecret, malformed) },
        body: malformed,
      }),
      source,
    )

    expect(oversizedResponse.status).toBe(413)
    expect(malformedResponse.status).toBe(400)
    expect(source.eventStore.record).not.toHaveBeenCalled()
  })
})
