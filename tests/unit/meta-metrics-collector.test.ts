import { describe, expect, it, vi } from 'vitest'
import {
  evaluateMetricFreshness,
  collectPostMetrics,
  type MetricCollectionInput,
} from '@/features/channels/meta-metrics-collector'

describe('Actual Metrics & Freshness Ledger (ANI-1000)', () => {
  it('marks metric as STALE if collected more than 4 hours ago', () => {
    const now = Date.now()
    const fiveHoursAgo = new Date(now - 5 * 60 * 60 * 1000).toISOString()

    const freshness = evaluateMetricFreshness(fiveHoursAgo, now)
    expect(freshness.isStale).toBe(true)
    expect(freshness.freshnessStatus).toBe('STALE')
  })

  it('marks metric as FRESH if collected recently (< 4 hours)', () => {
    const now = Date.now()
    const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString()

    const freshness = evaluateMetricFreshness(oneHourAgo, now)
    expect(freshness.isStale).toBe(false)
    expect(freshness.freshnessStatus).toBe('FRESH')
  })

  it('records NO_DATA when provider insights returns empty or zero metrics without hallucinating synthetic data', async () => {
    const mockClient = {
      from: vi.fn((table: string) => ({
        insert: vi.fn().mockResolvedValue({ error: null }),
      })),
    }

    const mockFetcher = vi.fn().mockResolvedValue({
      success: true,
      metrics: null, // No insights available
    })

    const input: MetricCollectionInput = {
      workspaceId: '10000000-0000-4000-8000-000000000001',
      publishAttemptId: '20000000-0000-4000-8000-000000000001',
      provider: 'instagram',
      providerObjectId: 'media-12345',
      fetcher: mockFetcher,
      client: mockClient as any,
    }

    const result = await collectPostMetrics(input)

    expect(result.status).toBe('no_data')
    expect(result.metrics.views.state).toBe('no_data')
    expect(result.metrics.views.value).toBeNull()
    expect(result.metrics.likes.state).toBe('no_data')
  })

  it('persists real observed metrics when provider returns valid insight numbers', async () => {
    const mockInsertCollection = vi.fn().mockResolvedValue({ error: null })
    const mockInsertValues = vi.fn().mockResolvedValue({ error: null })
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'channel_metric_collections') return { insert: mockInsertCollection }
        if (table === 'channel_metric_values') return { insert: mockInsertValues }
        return { insert: vi.fn() }
      }),
    }

    const mockFetcher = vi.fn().mockResolvedValue({
      success: true,
      metrics: {
        views: 1250,
        likes: 88,
        comments: 12,
        saved: 34,
        shares: 9,
      },
    })

    const input: MetricCollectionInput = {
      workspaceId: '10000000-0000-4000-8000-000000000001',
      publishAttemptId: '20000000-0000-4000-8000-000000000001',
      provider: 'instagram',
      providerObjectId: 'media-12345',
      fetcher: mockFetcher,
      client: mockClient as any,
    }

    const result = await collectPostMetrics(input)

    expect(result.status).toBe('succeeded')
    expect(result.metrics.views.value).toBe(1250)
    expect(result.metrics.likes.value).toBe(88)
    expect(result.metrics.views.state).toBe('available')
    expect(mockInsertCollection).toHaveBeenCalled()
    expect(mockInsertValues).toHaveBeenCalled()
  })
})
