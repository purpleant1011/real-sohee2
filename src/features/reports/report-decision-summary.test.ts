import { describe, expect, it } from 'vitest'
import type { CustomerConversation, ReportSnapshot, SocialPerformanceReport } from './types'
import { buildReportDecisionSummary } from './report-decision-summary'

const snapshot: ReportSnapshot = {
  periodStart: '2026-08-01',
  periodEnd: '2026-08-14',
  checkedAt: '2026-08-14T04:00:00.000Z',
  sampleState: 'limited',
  message: '확인된 자료만 보여줘요.',
  metrics: { visits: 12, engagements: 8, inquiries: 2, reservations: 1, observedPosts: 2 },
}

const report: SocialPerformanceReport = {
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-08-14T23:59:59.999Z',
  posts: [{
    workItemId: '31000000-0000-4000-8000-000000000001',
    workTitle: '게시 성공 콘텐츠',
    contentItemId: '32000000-0000-4000-8000-000000000001',
    contentVersionId: '33000000-0000-4000-8000-000000000001',
    versionNumber: 3,
    channel: 'instagram',
    scheduleId: '34000000-0000-4000-8000-000000000001',
    scheduledAt: '2026-08-14T00:00:00.000Z',
    scheduleStatus: 'published',
    publishAttemptId: '35000000-0000-4000-8000-000000000001',
    deliveryStatus: 'succeeded',
    providerPostReference: 'ig-post-1',
    publishedAt: '2026-08-14T00:01:00.000Z',
    collectionStatus: 'permission_denied',
    collectionPeriodStart: '2026-08-14T00:00:00.000Z',
    collectionPeriodEnd: '2026-08-14T04:00:00.000Z',
    collectedAt: '2026-08-14T04:00:00.000Z',
    nextCollectionAt: '2026-08-14T08:00:00.000Z',
    metrics: [{ metric: 'views', state: 'permission_denied', value: null }],
    reactions: [{
      id: '36000000-0000-4000-8000-000000000001',
      channel: 'instagram',
      category: 'comment',
      occurredAt: '2026-08-14T05:00:00.000Z',
      text: '예약 가능한가요?',
      providerPostReference: 'ig-post-1',
    }],
  }],
  unlinkedReactions: [{
    id: '36000000-0000-4000-8000-000000000002',
    channel: 'instagram',
    category: 'dm',
    occurredAt: '2026-08-14T06:00:00.000Z',
    text: '가격 문의',
    providerPostReference: null,
  }],
}

const conversations: readonly CustomerConversation[] = [{
  id: '37000000-0000-4000-8000-000000000001',
  channel: 'instagram',
  displayLabel: '확인이 필요한 고객',
  status: 'needs_attention',
  intent: '예약 문의',
  summary: '가능 시간을 물어봤어요.',
  latestMessageAt: '2026-08-14T06:00:00.000Z',
  inquiryId: '38000000-0000-4000-8000-000000000001',
  bookingId: null,
  relatedContentItemId: null,
  requiresHumanReview: true,
}]

describe('buildReportDecisionSummary', () => {
  it('summarizes only observed outcomes and counts each post or conversation needing attention once', () => {
    expect(buildReportDecisionSummary(snapshot, report, conversations)).toEqual({
      observedPosts: 2,
      reactions: 2,
      reservations: 1,
      attentionItems: 2,
      checkedAt: '2026-08-14T04:00:00.000Z',
      nextCollectionAt: '2026-08-14T08:00:00.000Z',
    })
  })

  it('keeps missing measurements unknown instead of converting them to zero', () => {
    expect(buildReportDecisionSummary({
      ...snapshot,
      checkedAt: null,
      metrics: { visits: null, engagements: null, inquiries: null, reservations: null, observedPosts: null },
    }, undefined, [])).toEqual({
      observedPosts: null,
      reactions: null,
      reservations: null,
      attentionItems: 0,
      checkedAt: null,
      nextCollectionAt: null,
    })
  })
})
