import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReportDashboard } from './report-dashboard'
import type { ReportSnapshot, SocialPerformanceReport } from './types'

const snapshot: ReportSnapshot = {
  periodStart: '2026-08-01',
  periodEnd: '2026-08-14',
  checkedAt: '2026-08-14T04:00:00.000Z',
  sampleState: 'sufficient',
  message: '확인된 자료입니다.',
  metrics: { visits: 12, engagements: 8, inquiries: 2, reservations: 1, observedPosts: 1 },
}

const report: SocialPerformanceReport = {
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-08-14T23:59:59.999Z',
  posts: [{
    workItemId: null,
    workTitle: '여름 눈썹 관리법',
    contentItemId: '32000000-0000-4000-8000-000000000001',
    contentVersionId: '33000000-0000-4000-8000-000000000001',
    versionNumber: 2,
    channel: 'instagram',
    scheduleId: '34000000-0000-4000-8000-000000000001',
    scheduledAt: '2026-08-14T00:00:00.000Z',
    scheduleStatus: 'published',
    publishAttemptId: '35000000-0000-4000-8000-000000000001',
    deliveryStatus: 'succeeded',
    providerPostReference: 'ig-post-1',
    publishedAt: '2026-08-14T00:01:00.000Z',
    collectionStatus: 'succeeded',
    collectionPeriodStart: '2026-08-14T00:00:00.000Z',
    collectionPeriodEnd: '2026-08-14T04:00:00.000Z',
    collectedAt: '2026-08-14T04:00:00.000Z',
    trackingId: 'SH-IG-A1B2C3D4',
    nextCollectionAt: '2026-08-14T08:00:00.000Z',
    reservationCount: 1,
    reservationValue: null,
    returnVisits: 3,
    metrics: [
      { metric: 'views', state: 'available', value: 120 },
      { metric: 'likes', state: 'available', value: 18 },
      { metric: 'shares', state: 'available', value: 4 },
    ],
    reactions: [],
  }],
  unlinkedReactions: [],
}

describe('ReportDashboard post analysis', () => {
  it('keeps exact post evidence behind the raw-data disclosure with tracking and collection cadence', () => {
    render(<ReportDashboard
      snapshot={snapshot}
      socialReport={report}
      previews={{
        [report.posts[0].contentVersionId]: {
          versionId: report.posts[0].contentVersionId,
          channel: 'instagram',
          accountLabel: '@sohee.official',
          caption: '여름에도 오래가는 눈썹 관리법을 알려드려요.',
          hashtags: ['#눈썹관리'],
          media: [],
        },
      }}
    />)

    expect(screen.queryByLabelText('여름 눈썹 관리법 포스트 분석')).not.toBeVisible()
    fireEvent.click(screen.getByText('원자료와 게시 결과 살펴보기'))
    const card = screen.getByLabelText('여름 눈썹 관리법 포스트 분석')
    expect(screen.getByRole('heading', { name: '이번 주, 무엇이 달라졌나요?' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '게시 결과 1건' })).toBeVisible()
    expect(within(card).getByLabelText('Instagram 게시물 미리보기')).toHaveTextContent('여름에도 오래가는 눈썹 관리법을 알려드려요.')
    expect(within(card).getByText('유입')).toBeInTheDocument()
    expect(within(card).getByText('첫 반응')).toBeInTheDocument()
    expect(within(card).getByText('재방문')).toBeInTheDocument()
    expect(within(card).getByText('예약 가치')).toBeInTheDocument()
    expect(within(card).getByText('추천 확산')).toBeInTheDocument()
    expect(within(card).getByText('SH-IG-A1B2C3D4')).toBeInTheDocument()
    expect(within(card).getByText('가치 설정 전')).toBeInTheDocument()
    expect(within(card).getByText(/4시간마다 확인/)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: '관련 대화에서 개선하기' })).toHaveAttribute(
      'href',
      `/app?work=${report.posts[0].contentItemId}`,
    )
  })
})
