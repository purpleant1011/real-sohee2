import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleMetaWebhook } from '../handler'
import crypto from 'node:crypto'

describe('Meta Webhook Verification, Signature & Idempotency (ANI-1213, ANI-1214)', () => {
  const appSecret = 'test-meta-app-secret-12345'
  const verifyToken = 'test-verify-token-67890'

  let recordedEvents: any[] = []

  const mockEventStore = {
    record: vi.fn(async (events: readonly any[]) => {
      recordedEvents.push(...events)
    }),
  }

  function signPayload(body: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex')
    return `sha256=${hmac}`
  }

  beforeEach(() => {
    recordedEvents = []
    vi.clearAllMocks()
  })

  it('1. MUST verify GET challenge with correct verify_token', async () => {
    const challenge = 'challenge_code_1234'
    const url = `https://example.com/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=${challenge}`
    const request = new Request(url, { method: 'GET' })

    const response = await handleMetaWebhook(request, {
      provider: 'instagram',
      verifyToken,
      appSecret,
      eventStore: mockEventStore,
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(challenge)
    expect(mockEventStore.record).not.toHaveBeenCalled()
  })

  it('2. MUST reject GET challenge with invalid verify_token (403)', async () => {
    const url = 'https://example.com/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=test'
    const request = new Request(url, { method: 'GET' })

    const response = await handleMetaWebhook(request, {
      provider: 'instagram',
      verifyToken,
      appSecret,
      eventStore: mockEventStore,
    })

    expect(response.status).toBe(403)
    expect(mockEventStore.record).not.toHaveBeenCalled()
  })

  it('3. MUST accept POST with valid HMAC-SHA256 signature and record event', async () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'ext-acc-001',
          time: 1725940800,
          changes: [
            {
              field: 'comments',
              value: {
                id: 'cmnt-001',
                text: '자연눈썹 예약 가능한 시간대가 언제인가요?',
                from: { id: 'user-ext-999', username: 'customer_jane' },
                media: { id: 'media-post-777' },
              },
            },
          ],
        },
      ],
    }

    const rawBody = JSON.stringify(payload)
    const validSignature = signPayload(rawBody, appSecret)

    const request = new Request('https://example.com/api/webhooks/instagram', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': validSignature,
      },
      body: rawBody,
    })

    const response = await handleMetaWebhook(request, {
      provider: 'instagram',
      verifyToken,
      appSecret,
      eventStore: mockEventStore,
    })

    expect(response.status).toBe(200)
    expect(mockEventStore.record).toHaveBeenCalledTimes(1)
    expect(recordedEvents.length).toBe(1)
    expect(recordedEvents[0].provider).toBe('instagram')
    expect(recordedEvents[0].category).toBe('comment')
    expect(recordedEvents[0].providerEventId).toBe('cmnt-001')
    expect(recordedEvents[0].externalSubjectId).toBe('user-ext-999')
    expect(recordedEvents[0].providerPostReference).toBe('media-post-777')
  })

  it('4. MUST reject POST with invalid signature with 401 and cause ZERO storage side effects', async () => {
    const rawBody = JSON.stringify({ test: 'malicious' })
    const invalidSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000'

    const request = new Request('https://example.com/api/webhooks/instagram', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': invalidSignature,
      },
      body: rawBody,
    })

    const response = await handleMetaWebhook(request, {
      provider: 'instagram',
      verifyToken,
      appSecret,
      eventStore: mockEventStore,
    })

    expect(response.status).toBe(401)
    expect(mockEventStore.record).not.toHaveBeenCalled()
    expect(recordedEvents.length).toBe(0)
  })
})
