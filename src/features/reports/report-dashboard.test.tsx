import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { ReportDashboard } from './report-dashboard'

describe('ReportDashboard', () => {
  it('renders collecting values without fake initial zeros', () => {
    render(
      <ReportDashboard
        snapshot={{
          periodStart: null,
          periodEnd: null,
          checkedAt: null,
          sampleState: 'collecting',
          message: '자료를 모으고 있어요. 아직 실제 0건으로 계산하지 않아요.',
          metrics: {
            visits: null,
            engagements: null,
            inquiries: null,
            reservations: null,
            observedPosts: null,
          },
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: '이번 주, 무엇이 달라졌나요?' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '리포트 분석 보기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'AARRR 고객 여정' })).not.toBeInTheDocument()
    expect(screen.getAllByText('수집 중').length).toBeGreaterThan(0)
    expect(screen.queryByText('확인된 0건')).not.toBeInTheDocument()
    expect(screen.getByText('자료 수집 중')).toBeInTheDocument()
    expect(screen.getByText('원자료와 게시 결과 살펴보기')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: '원자료 보기' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '업무·게시 성과' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('비교 가능한 저장 반응 자료가 아직 충분하지 않아요.')).toBeInTheDocument()
    expect(screen.getByText('대화나 일정을 열어도 게시가 자동 실행되지 않아요.')).toBeInTheDocument()
  })

  it('shows an explicit empty state instead of prototype customer stories', () => {
    render(
      <ReportDashboard
        conversations={[]}
        conversationState="ready"
        snapshot={{
          periodStart: null,
          periodEnd: null,
          checkedAt: null,
          sampleState: 'collecting',
          message: '자료를 모으고 있어요.',
          metrics: {
            visits: null,
            engagements: null,
            inquiries: null,
            reservations: null,
            observedPosts: null,
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: '고객 반응' }))
    expect(screen.getByText('아직 연결된 고객 대화가 없어요.')).toBeInTheDocument()
    expect(screen.getByText(/실제 채널 대화가 저장되면/)).toBeInTheDocument()
  })

  it('renders real customer rows and a privacy-safe R-05 detail dialog', () => {
    const conversation = {
      id: '30000000-0000-4000-8000-000000000010',
      channel: 'instagram' as const,
      displayLabel: '예약을 문의한 고객',
      status: 'needs_attention' as const,
      intent: '시술 예약 문의',
      summary: '가격을 확인한 뒤 가능한 시간을 물어봤어요.',
      latestMessageAt: '2026-08-10T02:30:00.000Z',
      inquiryId: '30000000-0000-4000-8000-000000000011',
      bookingId: null,
      relatedContentItemId: '30000000-0000-4000-8000-000000000012',
      requiresHumanReview: true,
    }
    render(
      <ReportDashboard
        conversations={[conversation]}
        conversationState="ready"
        initialView="reactions"
        selectedConversation={conversation}
        snapshot={{
          periodStart: '2026-08-01',
          periodEnd: '2026-08-08',
          checkedAt: '2026-08-10T03:00:00.000Z',
          sampleState: 'limited',
          message: '확인된 자료만 보여줘요.',
          metrics: {
            visits: 12,
            engagements: 4,
            inquiries: 1,
            reservations: 0,
            observedPosts: 2,
          },
        }}
      />,
    )

    expect(screen.getByRole('link', { name: /예약을 문의한 고객/ })).toHaveAttribute(
      'href',
      `/app/reports?view=reactions&conversation=${conversation.id}`,
    )
    expect(screen.getByRole('dialog', { name: '고객 대화 상세' })).toBeInTheDocument()
    expect(screen.getByText('가격을 확인한 뒤 가능한 시간을 물어봤어요.')).toBeInTheDocument()
    expect(screen.getByText('사람 확인 필요')).toBeInTheDocument()
    expect(screen.getByText(/개인정보를 줄인 요약만/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '연결 콘텐츠 보기' })).toHaveAttribute(
      'href',
      `/app/work/${conversation.relatedContentItemId}`,
    )
  })

  it('renders an actual zero and the sample check time explicitly', () => {
    render(
      <ReportDashboard
        snapshot={{
          periodStart: '2026-08-01',
          periodEnd: '2026-08-08',
          checkedAt: '2026-08-09T03:00:00.000Z',
          sampleState: 'limited',
          message: '확인된 표본이 적어 성과 원인을 단정하지 않아요.',
          metrics: {
            visits: 0,
            engagements: 0,
            inquiries: 0,
            reservations: 0,
            observedPosts: 0,
          },
        }}
      />,
    )

    expect(screen.getAllByText('확인된 0건').length).toBeGreaterThan(0)
    expect(screen.getByText('근거 제한')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '고객 반응' }))
    expect(screen.getByRole('tab', { name: '고객 반응' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('필요할 때만 게시별 원자료와 수집 상태를 펼쳐 확인합니다.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '예약 전환' }))
    expect(screen.getByRole('tab', { name: '예약 전환' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows exact-version post metrics and customer reactions in the same report card', () => {
    render(
      <ReportDashboard
        initialView="reactions"
        socialReport={{
          periodStart: '2026-08-01T00:00:00.000Z',
          periodEnd: '2026-08-08T23:59:59.999Z',
          posts: [{
            workItemId: '31000000-0000-4000-8000-000000000001',
            workTitle: '여름 관리 게시물',
            contentItemId: '32000000-0000-4000-8000-000000000001',
            contentVersionId: '33000000-0000-4000-8000-000000000001',
            versionNumber: 3,
            channel: 'instagram',
            scheduleId: '34000000-0000-4000-8000-000000000001',
            scheduledAt: '2026-08-08T00:00:00.000Z',
            scheduleStatus: 'published',
            publishAttemptId: '30000000-0000-4000-8000-000000000001',
            deliveryStatus: 'succeeded',
            providerPostReference: 'ig-media-1',
            destinationUrl: 'https://www.instagram.com/p/POST1/',
            publishedAt: '2026-08-08T00:05:00.000Z',
            collectionStatus: 'succeeded',
            collectionPeriodStart: '2026-08-01T00:00:00.000Z',
            collectionPeriodEnd: '2026-08-08T00:00:00.000Z',
            collectedAt: '2026-08-08T01:00:00.000Z',
            metrics: [
              { metric: 'views', state: 'available', value: 0 },
              { metric: 'saved', state: 'no_data', value: null },
              { metric: 'visits', state: 'not_supported', value: null },
              { metric: 'inquiries', state: 'permission_denied', value: null },
              { metric: 'shares', state: 'failed', value: null },
            ],
            reactions: [{
              id: '36000000-0000-4000-8000-000000000001',
              channel: 'instagram',
              category: 'comment',
              occurredAt: '2026-08-08T02:00:00.000Z',
              text: '예약 가능한가요?',
              providerPostReference: 'ig-media-1',
            }],
          }],
          unlinkedReactions: [],
        }}
        snapshot={{
          periodStart: '2026-08-01', periodEnd: '2026-08-08',
          checkedAt: '2026-08-08T01:00:00.000Z', sampleState: 'limited',
          message: '확인된 자료만 보여줘요.',
          metrics: { visits: null, engagements: null, inquiries: null, reservations: null, observedPosts: 1 },
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: '여름 관리 게시물' })).toBeInTheDocument()
    expect(screen.getByText('인스타그램 · 게시 버전 v3')).toBeInTheDocument()
    expect(screen.getByText('채널 게시물 ig-media-1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '실제 게시물 열기' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/p/POST1/',
    )
    expect(screen.getByText('조회 0')).toBeInTheDocument()
    expect(screen.getByText('저장 데이터 없음')).toBeInTheDocument()
    expect(screen.getByText('방문 미지원')).toBeInTheDocument()
    expect(screen.getByText('문의 권한 없음')).toBeInTheDocument()
    expect(screen.getByText('공유 수집 실패')).toBeInTheDocument()
    expect(screen.getByText('예약 가능한가요?')).toBeInTheDocument()
    expect(screen.getByText(/수집 기간/)).toBeInTheDocument()
    expect(screen.getByText(/수집 시각/)).toBeInTheDocument()
  })
})
