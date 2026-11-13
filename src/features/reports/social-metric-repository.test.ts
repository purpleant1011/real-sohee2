import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mockAdmin = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: mockAdmin.createAdminSupabaseClient,
}))

import { loadPublishedMetricContext, loadSavedMetricSnapshot, saveMetricCollection } from './social-metric-repository'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const publishAttemptId = '20000000-0000-4000-8000-000000000001'
const requestKey = '30000000-0000-4000-8000-000000000001'
const collectionId = '40000000-0000-4000-8000-000000000001'

describe('social metric collection repository', () => {
  it('loads only a succeeded provider post context from the server contract', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      workspace_id: workspaceId,
      publish_attempt_id: publishAttemptId,
      channel_connection_id: '50000000-0000-4000-8000-000000000001',
      channel: 'instagram',
      provider_post_reference: 'ig-media-1',
      published_at: '2026-08-08T00:05:00.000Z',
    }, error: null })

    await expect(loadPublishedMetricContext(workspaceId, publishAttemptId, { rpc }))
      .resolves.toEqual({
        workspaceId,
        publishAttemptId,
        channelConnectionId: '50000000-0000-4000-8000-000000000001',
        channel: 'instagram',
        providerPostReference: 'ig-media-1',
        publishedAt: '2026-08-08T00:05:00.000Z',
      })
    expect(rpc).toHaveBeenCalledWith('load_social_metric_context', {
      p_workspace_id: workspaceId,
      p_publish_attempt_id: publishAttemptId,
    })
  })

  it('loads context when postgrest returns an array of table rows', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{
      workspace_id: workspaceId,
      publish_attempt_id: publishAttemptId,
      channel_connection_id: '50000000-0000-4000-8000-000000000001',
      channel: 'instagram',
      provider_post_reference: 'ig-media-1',
      published_at: '2026-08-08T00:05:00.000Z',
    }], error: null })

    await expect(loadPublishedMetricContext(workspaceId, publishAttemptId, { rpc }))
      .resolves.toEqual({
        workspaceId,
        publishAttemptId,
        channelConnectionId: '50000000-0000-4000-8000-000000000001',
        channel: 'instagram',
        providerPostReference: 'ig-media-1',
        publishedAt: '2026-08-08T00:05:00.000Z',
      })
  })

  it('sends actual zero and null states to one idempotent server transaction', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: collectionId, error: null })
    const input = {
      workspaceId,
      publishAttemptId,
      requestKey,
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-08T00:00:00.000Z',
      collectedAt: '2026-08-08T01:00:00.000Z',
      status: 'succeeded' as const,
      errorCode: null,
      nextAttemptAt: null,
      metrics: [
        { metric: 'views' as const, state: 'available' as const, value: 0 },
        { metric: 'saved' as const, state: 'no_data' as const, value: null },
        { metric: 'visits' as const, state: 'not_supported' as const, value: null },
      ],
    }

    await expect(saveMetricCollection(input, { rpc })).resolves.toEqual({ collectionId })
    expect(rpc).toHaveBeenCalledWith('save_channel_metric_collection', {
      p_workspace_id: workspaceId,
      p_publish_attempt_id: publishAttemptId,
      p_request_key: requestKey,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_collected_at: input.collectedAt,
      p_status: 'succeeded',
      p_error_code: null,
      p_next_attempt_at: null,
      p_metrics: input.metrics,
    })
  })

  it('records a retryable failure without leaking the database error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: new Error('credential ciphertext and provider post leaked'),
    })
    const promise = saveMetricCollection({
      workspaceId,
      publishAttemptId,
      requestKey,
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-08T00:00:00.000Z',
      collectedAt: '2026-08-08T01:00:00.000Z',
      status: 'failed',
      errorCode: 'TEMPORARY_NETWORK',
      nextAttemptAt: '2026-08-08T01:15:00.000Z',
      metrics: [{ metric: 'views', state: 'failed', value: null }],
    }, { rpc })

    await expect(promise).rejects.toThrow('채널 성과 수집 기록을 저장하지 못했습니다.')
    await expect(promise).rejects.not.toThrow(/ciphertext|provider post/u)
  })

  it('rejects a numeric value for a non-available metric before the database call', async () => {
    const rpc = vi.fn()
    await expect(saveMetricCollection({
      workspaceId,
      publishAttemptId,
      requestKey,
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-08T00:00:00.000Z',
      collectedAt: '2026-08-08T01:00:00.000Z',
      status: 'no_data',
      errorCode: null,
      nextAttemptAt: null,
      metrics: [{ metric: 'likes', state: 'no_data', value: 7 }],
    }, { rpc })).rejects.toThrow('채널 성과 수집 기록을 확인해 주세요.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('loadSavedMetricSnapshot returns null when metric values query returns null data instead of masking it as empty', async () => {
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'channel_metric_collections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { collected_at: '2026-08-08T01:00:00.000Z' },
              error: null,
            }),
          }
        }
        if (table === 'channel_metric_values') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }
        }
        return {}
      }),
    }
    mockAdmin.createAdminSupabaseClient.mockReturnValue(mockClient)

    const result = await loadSavedMetricSnapshot(workspaceId, collectionId)
    expect(result).toBeNull()
  })
})
