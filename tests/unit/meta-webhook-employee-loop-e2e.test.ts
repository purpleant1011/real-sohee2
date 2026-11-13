import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handleMetaWebhook } from '@/features/meta-webhooks/handler'
import {
  evaluateRiskPolicy,
  executeResponseJobDelivery,
} from '@/features/channels/responsive-employee-loop'

describe('Instagram/Threads Webhook -> Response Job -> Delivery -> Readback E2E Loop (ANI-999)', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const connectionId = '20000000-0000-4000-8000-000000000001'
  const actorUserId = '30000000-0000-4000-8000-000000000001'
  const externalAccountId = '17841400000000001'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('verifies Meta webhook challenge response', async () => {
    const verifyToken = 'test-secret-verify-token-123'
    const challenge = '1158201244'
    const req = new Request(
      `http://localhost/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=${challenge}`,
      { method: 'GET' },
    )

    const res = await handleMetaWebhook(req, {
      provider: 'instagram',
      verifyToken,
      eventStore: { record: vi.fn() },
    })

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe(challenge)
  })

  it('runs the full E2E loop: Inbound Comment -> Event Store -> Risk Guardrail -> Autonomous Delivery -> Receipt', async () => {
    const recordedEvents: any[] = []
    const mockEventStore = {
      record: vi.fn(async (events) => {
        recordedEvents.push(...events)
      }),
    }

    // 1. Inbound Webhook Payload (Instagram Comment)
    const rawPayload = JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: externalAccountId,
          time: 1725685200,
          changes: [
            {
              field: 'comments',
              value: {
                id: 'comment-live-999',
                text: '오늘 메이크업 팁 너무 유익해요! 감사합니다~',
                from: { id: 'customer-user-111', username: 'beauty_lover' },
                media: { id: 'media-post-888' },
              },
            },
          ],
        },
      ],
    })

    const appSecret = 'meta-test-app-secret-32-chars-long!'
    // Calculate HMAC-SHA256 signature
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(appSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawPayload))
    const signatureHex = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    const webhookReq = new Request('http://localhost/api/webhooks/instagram', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${signatureHex}`,
      },
      body: rawPayload,
    })

    const webhookRes = await handleMetaWebhook(webhookReq, {
      provider: 'instagram',
      appSecret,
      eventStore: mockEventStore,
    })

    expect(webhookRes.status).toBe(200)
    expect(recordedEvents.length).toBe(1)
    const event = recordedEvents[0]
    expect(event.category).toBe('comment')
    expect(event.providerEventId).toBe('comment-live-999')

    // 2. Risk Guardrail Evaluation
    const riskDecision = evaluateRiskPolicy({
      channel: 'instagram',
      category: 'comment',
      text: event.payload.text,
    })
    expect(riskDecision.riskTier).toBe('LOW')
    expect(riskDecision.isAutonomousAllowed).toBe(true)

    // 3. Response Job Processing & Autonomous Delivery
    const dbRows: Record<string, any[]> = {
      external_action_requests: [],
      external_action_attempts: [],
      external_action_receipts: [],
      channel_delivery_attempts: [],
    }

    const mockDbClient = {
      from: vi.fn((table: string) => {
        if (table === 'channel_response_jobs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'job-999',
                    workspace_id: workspaceId,
                    channel_connection_id: connectionId,
                    response_kind: 'instagram_comment_reply',
                    external_target_id: 'comment-live-999',
                    draft_text: '좋게 봐주셔서 감사합니다! 궁금한 점 있으시면 언제든 남겨주세요 💕',
                    idempotency_key: 'a'.repeat(64),
                    status: 'draft',
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: connectionId, workspace_id: workspaceId, channel: 'instagram' },
                  error: null,
                }),
              }),
            }),
          }
        }
        // ANI-1758: 수신거부 가드가 fail-closed 로 바뀌어, customer_opt_outs 조회가
        // 없으면(=조회 실패) 발송이 차단된다. 이 테스트는 "미등록"을 명시한다.
        if (table === 'customer_opt_outs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'channel_consents') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        status: 'ACTIVE',
                        capabilities: { reply_comments: true },
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        // ANI-1753 후속: 수신거부 가드가 fail-closed 로 바뀌면서 이 조회가 필수 경로가 됐다.
        // 이 고객은 수신거부하지 않은 상태(data: null)이므로 발송이 계속 진행된다.
        if (table === 'customer_opt_outs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }
        }
        return {
          insert: vi.fn(async (row) => {
            if (dbRows[table]) dbRows[table].push(row)
            return { error: null }
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }),
    }

    const mockMetaProvider = {
      sendCommentReply: vi.fn().mockResolvedValue({
        id: 'reply-posted-777',
        parent_id: 'comment-live-999',
      }),
    }

    const deliveryResult = await executeResponseJobDelivery({
      jobId: 'job-999',
      actorUserId,
      client: mockDbClient as any,
      metaProvider: mockMetaProvider as any,
      accessToken: 'secure-token-abc',
    })

    expect(deliveryResult.success).toBe(true)
    expect(mockMetaProvider.sendCommentReply).toHaveBeenCalledWith({
      commentId: 'comment-live-999',
      message: '좋게 봐주셔서 감사합니다! 궁금한 점 있으시면 언제든 남겨주세요 💕',
      accessToken: 'secure-token-abc',
    })

    // Verify Canonical Lineage
    expect(dbRows.external_action_requests.length).toBe(1)
    expect(dbRows.external_action_attempts.length).toBe(1)
    expect(dbRows.external_action_receipts.length).toBe(1)
    expect(dbRows.channel_delivery_attempts.length).toBe(1)

    const receipt = dbRows.external_action_receipts[0]
    expect(receipt.receipt_kind).toBe('observed_result')
    expect(receipt.provider_reference).toBe('reply-posted-777')
  })
})
