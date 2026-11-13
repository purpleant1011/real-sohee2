import { describe, expect, it } from 'vitest'
import type { ReportMetrics, SocialPerformanceReport } from './types'
import { buildAarrrStages } from './aarrr-stages'

const metrics: ReportMetrics = {
  visits: 120,
  engagements: 18,
  inquiries: 4,
  reservations: 3,
  observedPosts: 2,
}

const socialReport: SocialPerformanceReport = {
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-08-08T23:59:59.999Z',
  posts: [{
    workItemId: null,
    workTitle: '고객 후기 게시물',
    contentItemId: '32000000-0000-4000-8000-000000000001',
    contentVersionId: '33000000-0000-4000-8000-000000000001',
    versionNumber: 2,
    channel: 'instagram',
    scheduleId: '34000000-0000-4000-8000-000000000001',
    scheduledAt: '2026-08-08T00:00:00.000Z',
    scheduleStatus: 'published',
    publishAttemptId: '35000000-0000-4000-8000-000000000001',
    deliveryStatus: 'succeeded',
    providerPostReference: 'ig-post-1',
    publishedAt: '2026-08-08T00:01:00.000Z',
    collectionStatus: 'succeeded',
    collectionPeriodStart: '2026-08-01T00:00:00.000Z',
    collectionPeriodEnd: '2026-08-08T00:00:00.000Z',
    collectedAt: '2026-08-08T01:00:00.000Z',
    metrics: [
      { metric: 'shares', state: 'available', value: 2 },
      { metric: 'reposts', state: 'available', value: 1 },
      { metric: 'quotes', state: 'available', value: 1 },
      { metric: 'likes', state: 'available', value: 9 },
    ],
    reactions: [],
  }],
  unlinkedReactions: [],
}

describe('buildAarrrStages', () => {
  it('maps only supported actual measures and keeps unsupported retention explicit', () => {
    const stages = buildAarrrStages(metrics, socialReport)

    expect(stages.map((stage) => stage.label)).toEqual([
      '유입', '첫 반응', '재방문', '예약 가치', '추천 확산',
    ])
    expect(stages.map((stage) => stage.value)).toEqual([120, 18, null, 3, 4])
    expect(stages[2]).toMatchObject({ state: 'not_connected', displayValue: '측정 연결 전' })
    expect(stages[3].note).toBe('예약 전환 지표이며 실제 매출액이 아니에요.')
  })

  it('keeps a collected zero as an actual referral result', () => {
    const zeroReport: SocialPerformanceReport = {
      ...socialReport,
      posts: [{
        ...socialReport.posts[0],
        metrics: [{ metric: 'shares', state: 'available', value: 0 }],
      }],
    }

    expect(buildAarrrStages(metrics, zeroReport)[4]).toMatchObject({
      value: 0,
      state: 'actual',
      displayValue: '0',
    })
  })

  it('does not turn unavailable referral signals into a fabricated zero', () => {
    const unsupportedReport: SocialPerformanceReport = {
      ...socialReport,
      posts: [{
        ...socialReport.posts[0],
        metrics: [
          { metric: 'shares', state: 'not_supported', value: null },
          { metric: 'reposts', state: 'permission_denied', value: null },
        ],
      }],
    }

    expect(buildAarrrStages(metrics, unsupportedReport)[4]).toMatchObject({
      value: null,
      state: 'not_connected',
      displayValue: '측정 연결 전',
    })
  })

  it('aggregates only observed first-party return visits', () => {
    const tracked: SocialPerformanceReport = {
      ...socialReport,
      posts: [{ ...socialReport.posts[0], returnVisits: 7 }],
    }

    expect(buildAarrrStages(metrics, tracked)[2]).toMatchObject({
      value: 7,
      state: 'actual',
      displayValue: '7',
    })
  })
})
