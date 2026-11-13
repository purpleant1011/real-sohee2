import { describe, it, expect, vi } from 'vitest'
import { createMetaWebhookEventStore } from '../event-store'
import type { NormalizedMetaEvent } from '../handler'

describe('Meta Webhook Customer Conversation & Mission Integration (ANI-1214, ANI-1215)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const connectionId = 'conn-insta-123'
  const externalAccountId = 'insta-act-123'

  it('MUST ingest customer conversation and pass linked mission when webhook receives interactive comment', async () => {
    let capturedConvParams: any = null
    let capturedResponseJob: any = null

    const mockGateway = {
      findConnection: vi.fn().mockResolvedValue({
        data: { id: connectionId, workspace_id: workspaceId },
        error: null,
      }),
      insertEvent: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
      updateHealth: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
      findMissionByPostReference: vi.fn().mockResolvedValue({
        data: { id: 'msn-byreum-test', content_id: 'cnt-post-001' },
        error: null,
      }),
      recordCustomerConversation: vi.fn().mockImplementation(async (params) => {
        capturedConvParams = params
        return { data: { id: 'conv-001' }, error: null }
      }),
      insertResponseJob: vi.fn().mockImplementation(async (job) => {
        capturedResponseJob = job
        return { data: { id: 'job-001' }, error: null }
      }),
    }

    const store = await createMetaWebhookEventStore(mockGateway as any)

    const event: NormalizedMetaEvent = {
      provider: 'instagram',
      category: 'comment',
      eventKey: 'evt-key-comment-001',
      providerEventId: 'provider-comment-001',
      externalAccountId,
      instagramAccountId: externalAccountId,
      externalSubjectId: 'instagram-user-byreum-fan',
      providerPostReference: '18029384729102938',
      payload: {
        id: 'provider-comment-001',
        text: '이번 주 토요일에 자연눈썹 예약하고 싶어요!',
        from: {
          id: 'instagram-user-byreum-fan',
          username: 'byreum_fan_99',
        },
      },
      payloadSha256: 'a'.repeat(64),
      occurredAt: '2026-09-10T12:00:00.000Z',
    }

    await store.record([event])

    // 1. Ingestion of customer conversation verification
    expect(mockGateway.recordCustomerConversation).toHaveBeenCalledTimes(1)
    expect(capturedConvParams).toEqual({
      workspaceId,
      channel: 'instagram',
      externalSubjectId: 'instagram-user-byreum-fan',
      displayLabel: 'byreum_fan_99',
      messageText: '이번 주 토요일에 자연눈썹 예약하고 싶어요!',
      relatedContentItemId: 'cnt-post-001',
      missionId: 'msn-byreum-test',
    })

    // 2. Response job verification
    expect(mockGateway.insertResponseJob).toHaveBeenCalledTimes(1)
    expect(capturedResponseJob.response_kind).toBe('instagram_comment_reply')
    expect(capturedResponseJob.status).toBe('queued')
  })
})
