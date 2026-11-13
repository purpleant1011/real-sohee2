import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import type { ScheduleBoard as ScheduleBoardData } from './repository'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./actions/schedule-content', () => ({
  scheduleContentAction: vi.fn(), rescheduleContentAction: vi.fn(), cancelScheduleAction: vi.fn(),
}))
vi.mock('@/features/publishing/recovery-card', () => ({ RecoveryCard: () => <span>복구 필요</span> }))
vi.mock('@/features/local-publishing/actions/reconfirm-local-publish', () => ({
  reconfirmLocalPublishAction: vi.fn(async () => ({ data: { reconfirmed: true } })),
}))
vi.mock('@/features/kakao/history/use-kakao-history', () => ({
  useKakaoHistory: vi.fn().mockReturnValue({
    items: [],
    load: 'ready',
    refresh: vi.fn(),
  }),
}))

import * as useKakaoHistoryModule from '@/features/kakao/history/use-kakao-history'
import type { KakaoHistoryItem } from '@/features/kakao/history/contract'

import { NAVER_POLICY_STOPPED_LABEL } from '@/features/local-publishing/publish-status-card'
import { ScheduleBoard } from './schedule-board'

function FixedScheduleBoard(props: ComponentProps<typeof ScheduleBoard>) {
  return <NuqsTestingAdapter><ScheduleBoard now={new Date('2026-08-23T03:00:00.000Z')} {...props} /></NuqsTestingAdapter>
}

const schedule = {
  id: '60000000-0000-4000-8000-000000000001',
  content_id: '30000000-0000-4000-8000-000000000001',
  version_id: '40000000-0000-4000-8000-000000000001',
  publish_at: '2026-08-23T06:00:00.000Z',
  timezone: 'Asia/Seoul',
  status: 'scheduled' as const,
  channel_connection_id: '50000000-0000-4000-8000-000000000001',
  updated_at: '2026-08-22T06:00:00.000Z',
  title: '시술 뒤 24시간 관리 안내',
  channel: 'instagram',
  versionNumber: 3,
}

function board(overrides: Partial<ScheduleBoardData> = {}): ScheduleBoardData {
  return {
    source: 'actual',
    partialData: false,
    unavailableSources: [],
    ready: [],
    plans: [{
      contentId: '30000000-0000-4000-8000-000000000002',
      title: '잔흔 상담 전후 기록',
      channel: 'threads',
      status: 'review',
      versionId: '40000000-0000-4000-8000-000000000002',
      versionNumber: 2,
    }],
    schedules: [schedule],
    attempts: {},
    customerReservations: [{
      conversationId: '70000000-0000-4000-8000-000000000001',
      channel: 'instagram',
      displayLabel: '예약을 확정한 고객',
      status: 'waiting_customer',
      intent: '잔흔 상담 예약',
      latestMessageAt: '2026-08-13T08:00:00.000Z',
      bookingId: '80000000-0000-4000-8000-000000000001',
      startsAt: '2026-08-23T08:00:00.000Z',
      timezone: 'Asia/Seoul',
      timingState: 'connected',
    }],
    localPublishes: [],
    internalTasks: [],
    ...overrides,
  }
}

describe('ScheduleBoard', () => {
  it('shows a report experiment as an unapproved plan without creating a schedule', () => {
    render(<FixedScheduleBoard
      data={board({ schedules: [] })}
      reportExperiment={{
        id: '70000000-0000-4000-8000-000000000001',
        hypothesis: '첫 문장만 바꾸면 저장 반응이 달라질 수 있어요.',
        changeVariable: 'opening',
        variantAContentVersionId: '40000000-0000-4000-8000-000000000001',
        variantBContentVersionId: '40000000-0000-4000-8000-000000000002',
        variantAScheduledAt: '2026-08-24T01:00:00.000Z',
        variantBScheduledAt: '2026-08-25T01:00:00.000Z',
        primaryMetric: 'saved',
        reviewAt: '2026-09-01T01:00:00.000Z',
        approvalState: 'not_requested',
        status: 'planned',
      }}
      role="manager"
      workspaceId="20000000-0000-4000-8000-000000000001"
    />)

    expect(screen.getByRole('heading', { name: '리포트 실험 계획' })).toBeVisible()
    expect(screen.getByText('아직 승인이나 일정 예약을 요청하지 않았어요.')).toBeVisible()
    expect(screen.queryByText('게시 예정')).not.toBeInTheDocument()
  })
  it('shows posting plans, scheduled posts, execution state, and customer bookings in one activity surface', () => {
    render(<FixedScheduleBoard
      workspaceId="20000000-0000-4000-8000-000000000001"
      role="manager"
      data={board()}
      previews={{
        [schedule.version_id]: {
          versionId: schedule.version_id,
          channel: 'instagram',
          accountLabel: '@sohee.official',
          caption: '시술 후 붉음은 자연스러운 회복 과정이에요.',
          hashtags: ['#소희'],
          media: [],
        },
      }}
    />)

    expect(screen.getByRole('heading', { name: '일정' })).toBeInTheDocument()
    expect(screen.getByText('오늘 소희가 할 일 1개')).toBeInTheDocument()
    expect(screen.getByText('잔흔 상담 전후 기록')).toBeInTheDocument()
    expect(screen.getByText('시술 뒤 24시간 관리 안내')).toBeInTheDocument()
    expect(screen.getAllByText('인스타그램').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '시술 뒤 24시간 관리 안내 상세 보기' }))
    expect(screen.getAllByLabelText('Instagram 게시물 미리보기')[0]).toHaveTextContent('시술 후 붉음은 자연스러운 회복 과정이에요.')
    expect(screen.getAllByLabelText('Instagram 게시물 미리보기')[0]).toHaveTextContent('@sohee.official')
    expect(screen.getByText('예약을 확정한 고객')).toBeInTheDocument()
    expect(screen.getByText('오후 5:00')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(schedule.version_id)
    expect(screen.queryByText('복구 필요')).not.toBeInTheDocument()
    expect(screen.getByText('시간을 정할 콘텐츠 1개')).toBeInTheDocument()
  })

  it('shows a late local publish confirmation in the schedule decision panel', () => {
    render(<FixedScheduleBoard selectedDate="2026-08-10" workspaceId="20000000-0000-4000-8000-000000000001" role="manager" data={board({
      localPublishes: [{
        id: '91000000-0000-4000-8000-000000000001',
        status: 'reconfirmation_required',
        channel: 'naver_blog',
        targetLabel: 'findk3 테스트 블로그',
        contentVersionId: '92000000-0000-4000-8000-000000000001',
        scheduledAt: '2026-08-19T05:00:00.000Z',
        autoExecuteUntil: '2026-08-19T05:30:00.000Z',
        failureCode: 'DEADLINE_EXPIRED',
        visibility: 'private',
      }],
    })} />)

    expect(screen.getByText(NAVER_POLICY_STOPPED_LABEL)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('92000000-0000-4000-8000-000000000001')
    expect(screen.getByRole('button', { name: '게시 내용 다시 확인' })).toBeInTheDocument()
  })

  it('filters the real timeline by content work or customer reservation', () => {
    render(<FixedScheduleBoard workspaceId="20000000-0000-4000-8000-000000000001" role="manager" data={board()} />)

    fireEvent.click(screen.getByRole('radio', { name: '고객 예약' }))
    expect(screen.getByText('예약을 확정한 고객')).toBeInTheDocument()
    expect(screen.queryByText('시술 뒤 24시간 관리 안내')).not.toBeInTheDocument()
    expect(screen.getByText('잔흔 상담 전후 기록')).not.toBeVisible()

    fireEvent.click(screen.getByRole('radio', { name: '콘텐츠' }))
    expect(screen.getByText('시술 뒤 24시간 관리 안내')).toBeInTheDocument()
    expect(screen.getByText('잔흔 상담 전후 기록')).not.toBeVisible()
    expect(screen.queryByText('예약을 확정한 고객')).not.toBeInTheDocument()
  })

  it('keeps schedule decision controls for managers and unavailable for reviewers', () => {
    const ready: ScheduleBoardData['ready'] = [{
      approvalId: '90000000-0000-4000-8000-000000000001',
      contentId: '30000000-0000-4000-8000-000000000003',
      versionId: '40000000-0000-4000-8000-000000000003',
      versionNumber: 4,
      title: '이번 주 최종 제안',
      channel: 'instagram',
      connections: [{ id: '50000000-0000-4000-8000-000000000001', label: '@sohee' }],
    }]
    const manager = render(<FixedScheduleBoard workspaceId="20000000-0000-4000-8000-000000000001" role="manager" data={board({ ready })} />)
    expect(screen.getByRole('button', { name: '일정 예약' })).toBeEnabled()
    manager.unmount()

    render(<FixedScheduleBoard workspaceId="20000000-0000-4000-8000-000000000001" role="reviewer" data={board({ ready })} />)
    expect(screen.getByText(/소유자와 관리자만/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '일정 예약' })).not.toBeInTheDocument()
  })

  it('shows the provider-confirmed result on the same exact-version activity', () => {
    const published = { ...schedule, status: 'published' as const }
    render(<FixedScheduleBoard selectedDate="2026-08-10" workspaceId="20000000-0000-4000-8000-000000000001" role="manager" data={board({
      schedules: [published],
      attempts: {
        [published.id]: {
          id: '70000000-0000-4000-8000-000000000002',
          schedule_id: published.id,
          attempt_number: 1,
          status: 'succeeded',
          provider_reference: 'ig-post-123',
          destination_url: 'https://www.instagram.com/p/POST1/',
          error_code: null,
          started_at: '2026-08-10T09:00:00.000Z',
          finished_at: '2026-08-10T09:02:00.000Z',
        },
      },
    })} />)

    expect(screen.getByText('게시를 완료했어요.')).toBeInTheDocument()
    expect(screen.queryByText('ig-post-123')).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('채널 게시 결과')).getByText('게시를 완료했어요.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '성과와 고객 반응 보기' })).toHaveAttribute(
      'href',
      `/app/reports?view=reactions&work=${published.content_id}`,
    )
    expect(screen.getByRole('link', { name: '실제 게시물 보기' })).toHaveAttribute(
      'href',
      'https://www.instagram.com/p/POST1/',
    )
  })

  it('shows daily work and provider-confirmed posting history with the actual completion time', () => {
    const instagram = { ...schedule, status: 'published' as const, publish_at: '2030-08-14T05:50:00.000Z' }
    const threads = {
      ...schedule,
      id: '60000000-0000-4000-8000-000000000008',
      content_id: '30000000-0000-4000-8000-000000000008',
      version_id: '40000000-0000-4000-8000-000000000008',
      status: 'published' as const,
      publish_at: '2030-08-14T06:10:00.000Z',
      title: '대화에서 즉시 게시한 한 줄',
      channel: 'threads',
    }
    render(<FixedScheduleBoard
      workspaceId="20000000-0000-4000-8000-000000000001"
      role="manager"
      selectedDate="2030-08-14"
      data={board({
        plans: [],
        customerReservations: [],
        schedules: [instagram, threads],
        attempts: {
          [instagram.id]: {
            id: '70000000-0000-4000-8000-000000000007', schedule_id: instagram.id,
            attempt_number: 1, status: 'succeeded', provider_reference: 'ig-post-7', error_code: null,
            started_at: '2030-08-14T05:50:00.000Z', finished_at: '2030-08-14T05:52:00.000Z',
          },
          [threads.id]: {
            id: '70000000-0000-4000-8000-000000000008', schedule_id: threads.id,
            attempt_number: 1, status: 'succeeded', provider_reference: 'threads-post-8', error_code: null,
            started_at: '2030-08-14T06:10:00.000Z', finished_at: '2030-08-14T06:11:00.000Z',
          },
        },
      })}
    />)

    expect(screen.getByText('오늘 소희가 할 일 0개')).toBeInTheDocument()
    expect(screen.getByText('오늘 소희가 한 일 2건')).toBeInTheDocument()
    expect(screen.getByText('인스타그램 1건 · Threads 1건 게시했어요.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '소희가 한 일 2' })).toBeInTheDocument()
    expect(screen.getAllByText('오후 2:52').length).toBeGreaterThan(0)
    expect(screen.getAllByText('오후 3:11').length).toBeGreaterThan(0)
  })

  it('shows recovery controls only when a posting execution failed', () => {
    const failed = { ...schedule, status: 'failed' as const }
    render(<FixedScheduleBoard selectedDate="2026-08-23" workspaceId="20000000-0000-4000-8000-000000000001" role="manager" data={board({
      schedules: [failed],
      attempts: {
        [failed.id]: {
          id: '70000000-0000-4000-8000-000000000003', schedule_id: failed.id,
          attempt_number: 1, status: 'failed', provider_reference: null,
          error_code: 'PROVIDER_UNAVAILABLE', started_at: '2026-08-10T09:00:00.000Z',
          finished_at: '2026-08-10T09:02:00.000Z',
        },
      },
    })} />)

    expect(screen.getByText('복구 필요')).toBeInTheDocument()
  })

  it('summarizes execution states and filters the timeline to recovery work', () => {
    const publishing = { ...schedule, id: '60000000-0000-4000-8000-000000000002', status: 'publishing' as const, title: '게시 중인 안내' }
    const published = { ...schedule, id: '60000000-0000-4000-8000-000000000003', status: 'published' as const, title: '게시를 마친 안내' }
    const failed = { ...schedule, id: '60000000-0000-4000-8000-000000000004', status: 'failed' as const, title: '복구할 안내' }
    render(<FixedScheduleBoard workspaceId="20000000-0000-4000-8000-000000000001" role="manager" data={board({
      plans: [],
      customerReservations: [],
      schedules: [schedule, publishing, published, failed],
    })} />)

    expect(screen.getByLabelText('게시 상태 필터')).toHaveTextContent(/예정\s*1/)
    expect(screen.getByLabelText('게시 상태 필터')).toHaveTextContent(/진행 중\s*1/)
    expect(screen.getByLabelText('게시 상태 필터')).toHaveTextContent(/완료\s*1/)
    expect(screen.getByLabelText('게시 상태 필터')).toHaveTextContent(/다시 확인\s*1/)

    fireEvent.click(screen.getByRole('radio', { name: '다시 확인 1' }))
    expect(screen.getByText('복구할 안내')).toBeInTheDocument()
    expect(screen.queryByText('게시 중인 안내')).not.toBeInTheDocument()
    expect(screen.queryByText('게시를 마친 안내')).not.toBeInTheDocument()
  })

  it('opens exact-version execution details with scheduled and actual completion times kept separate', () => {
    const published = { ...schedule, status: 'published' as const }
    render(<FixedScheduleBoard
      workspaceId="20000000-0000-4000-8000-000000000001"
      role="manager"
      selectedDate="2030-08-14"
      data={board({
        plans: [],
        customerReservations: [],
        schedules: [published],
        attempts: {
          [published.id]: {
            id: '70000000-0000-4000-8000-000000000002',
            schedule_id: published.id,
            attempt_number: 1,
            status: 'succeeded',
            provider_reference: 'ig-post-123',
            error_code: null,
            started_at: '2030-08-14T06:01:00.000Z',
            finished_at: '2030-08-14T06:02:00.000Z',
          },
        },
      })}
      previews={{
        [published.version_id]: {
          versionId: published.version_id,
          channel: 'instagram',
          accountLabel: '@sohee.official',
          caption: '시술 후 관리 안내입니다.',
          hashtags: [],
          media: [],
        },
      }}
    />)

    fireEvent.click(screen.getByRole('radio', { name: '완료 1' }))
    fireEvent.click(screen.getByRole('button', { name: '시술 뒤 24시간 관리 안내 상세 보기' }))
    const dialog = screen.getByRole('dialog', { name: '시술 뒤 24시간 관리 안내' })
    expect(dialog).toHaveTextContent('인스타그램 · @sohee.official')
    expect(dialog).not.toHaveTextContent('v3')
    expect(dialog).toHaveTextContent('예약 시각2026년 8월 23일 오후 3:00')
    expect(dialog).toHaveTextContent('실제 완료 시각2030년 8월 14일 오후 3:02')
    expect(dialog).not.toHaveTextContent('ig-post-123')
    expect(within(dialog).getByRole('link', { name: '관련 대화 보기' })).toHaveAttribute('href', expect.stringContaining('entryPoint=schedule'))
  })

  it('keeps the daily briefing focused and moves undated work into a collapsed decision queue', () => {
    const plans = Array.from({ length: 5 }, (_, index) => ({
      contentId: `30000000-0000-4000-8000-${String(index + 20).padStart(12, '0')}`,
      title: `시간을 정할 콘텐츠 ${index + 1}`,
      channel: 'instagram',
      status: 'review',
      versionId: `40000000-0000-4000-8000-${String(index + 20).padStart(12, '0')}`,
      versionNumber: 1,
    }))
    render(<FixedScheduleBoard
      workspaceId="20000000-0000-4000-8000-000000000001"
      role="manager"
      selectedDate="2030-08-14"
      data={board({ plans, schedules: [], customerReservations: [] })}
    />)

    expect(screen.getByText('오늘 소희가 할 일 0개')).toBeInTheDocument()
    expect(screen.getByText('시간을 정할 콘텐츠 5개')).toBeInTheDocument()
    expect(screen.queryByLabelText('일정 요약')).not.toBeInTheDocument()

    const queueSummary = screen.getByText('시간을 정할 콘텐츠 5개')
    expect(queueSummary.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(queueSummary)
    expect(screen.getByText('시간을 정할 콘텐츠 1')).toBeInTheDocument()
    expect(screen.getByText('나머지 2개는 대화에서 이어서 확인할 수 있어요.')).toBeInTheDocument()
  })

  it('uses schedule-aware conversation links and exposes the primary schedule conversation action', () => {
    render(<FixedScheduleBoard
      workspaceId="20000000-0000-4000-8000-000000000001"
      role="manager"
      selectedDate="2026-08-23"
      data={board({ plans: [], customerReservations: [] })}
    />)

    expect(screen.getAllByRole('link', { name: '소희와 일정 잡기' })[0]).toHaveAttribute(
      'href',
      expect.stringContaining('intent=create_schedule'),
    )
    const detailButton = screen.getByRole('button', { name: '시술 뒤 24시간 관리 안내 상세 보기' })
    expect(detailButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(detailButton)
    const conversationLink = screen.getAllByRole('link', { name: '관련 대화 보기' })[0]
    expect(conversationLink).toHaveAttribute('href', expect.stringContaining('entryPoint=schedule'))
    expect(conversationLink).toHaveAttribute('href', expect.stringContaining(`scheduleId=${schedule.id}`))
    expect(conversationLink).toHaveAttribute('href', expect.stringContaining(`contentVersionId=${schedule.version_id}`))
    expect(conversationLink).toHaveAttribute('href', expect.stringContaining('returnTo=%2Fapp%2Fschedule%3Fdate%3D2026-08-23'))
  })

  it('shows reports only for provider-confirmed success and keeps diagnostics out of primary copy', () => {
    const failed = { ...schedule, status: 'failed' as const }
    render(<FixedScheduleBoard workspaceId="20000000-0000-4000-8000-000000000001" role="manager" data={board({
      plans: [],
      customerReservations: [],
      schedules: [failed],
      attempts: {
        [failed.id]: {
          id: '70000000-0000-4000-8000-000000000003', schedule_id: failed.id,
          attempt_number: 1, status: 'failed', provider_reference: null,
          error_code: 'PROVIDER_UNAVAILABLE', started_at: '2030-08-14T06:00:00.000Z',
          finished_at: '2030-08-14T06:02:00.000Z',
        },
      },
    })} />)

    expect(screen.getByText('게시하지 못했어요.')).toBeInTheDocument()
    expect(screen.getByText('확인한 콘텐츠는 그대로 보관되어 있어요.')).toBeInTheDocument()
    expect(screen.queryByText('PROVIDER_UNAVAILABLE')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '성과와 고객 반응 보기' })).not.toBeInTheDocument()
  })

  it('preserves usable work while naming partial source failures', () => {
    render(<FixedScheduleBoard workspaceId="20000000-0000-4000-8000-000000000001" role="manager" data={board({
      partialData: true,
      unavailableSources: ['customer_reservations', 'internal_tasks'],
    })} />)

    expect(screen.getByRole('status')).toHaveTextContent('고객 예약과 소희의 준비 작업 일부를 확인하지 못했어요.')
    expect(screen.getByText('시술 뒤 24시간 관리 안내')).toBeInTheDocument()
  })

  it('shows Sohee preparation and completed internal work in the selected-day flow', () => {
    render(<FixedScheduleBoard workspaceId="20000000-0000-4000-8000-000000000001" role="manager" selectedDate="2030-08-14" data={board({
      plans: [],
      customerReservations: [],
      schedules: [],
      internalTasks: [{
        id: '91000000-0000-4000-8000-000000000001',
        conversationThreadId: '92000000-0000-4000-8000-000000000001',
        kind: 'publish_preparation',
        state: 'preparing',
        title: '게시할 내용을 준비하고 있어요',
        occurredAt: '2030-08-14T01:00:00.000Z',
        completedAt: null,
      }],
    })} />)

    expect(screen.getByText('게시할 내용을 준비하고 있어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '준비 중인 대화 보기' })).toHaveAttribute(
      'href',
      '/app/conversations/92000000-0000-4000-8000-000000000001',
    )
  })

  it('offers three reasoned schedule choices, direct entry, and explicit cancel confirmation', () => {
    render(<FixedScheduleBoard
      workspaceId="20000000-0000-4000-8000-000000000001"
      role="manager"
      selectedDate="2026-08-23"
      now={new Date('2026-08-23T00:00:00.000Z')}
      data={board({ plans: [], customerReservations: [] })}
    />)

    fireEvent.click(screen.getByRole('button', { name: '시술 뒤 24시간 관리 안내 상세 보기' }))
    const dialog = screen.getByRole('dialog', { name: '시술 뒤 24시간 관리 안내' })
    expect(within(dialog).getByRole('heading', { name: '일정 바꾸기' })).toBeInTheDocument()
    expect(within(dialog).getByText('시간만 바꾸면 확인한 콘텐츠는 그대로 유지돼요.')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button').filter((button) => button.textContent?.includes('추천') || button.textContent?.includes('확보') || button.textContent?.includes('겹치지')).length).toBeGreaterThanOrEqual(2)
    expect(within(dialog).getByText('직접 날짜와 시간 선택')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: '예약 취소' }))
    expect(within(dialog).getByText('예약만 취소하고 확인한 콘텐츠는 시간 미정으로 보관할까요?')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '예약 취소 확인' })).toBeInTheDocument()
  })

  it('예약 카드에 가장 최근 알림톡 상태 배지를 표시하고, 이력이 없으면 배지를 표시하지 않는다', () => {
    const kakaoItem: KakaoHistoryItem = {
      id: 'outbox-1',
      reservationId: '80000000-0000-4000-8000-000000000001',
      event: 'BOOKING_CONFIRMED',
      eventLabel: '예약 확정 안내',
      status: 'DELIVERED',
      statusLabel: '도착 확인',
      detailLabel: null,
      dueAt: '2026-08-23T06:00:00.000Z',
      updatedAt: '2026-08-23T06:05:00.000Z',
    }

    const useKakaoHistorySpy = vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory')
    useKakaoHistorySpy.mockReturnValue({
      items: [kakaoItem],
      load: 'ready',
      refresh: vi.fn(),
    })

    const { rerender } = render(<FixedScheduleBoard
      workspaceId="ws-test-real-42"
      role="manager"
      selectedDate="2026-08-23"
      data={board()}
    />)

    expect(useKakaoHistorySpy).toHaveBeenCalledWith({
      workspaceId: 'ws-test-real-42',
      limit: 100,
    })

    const badge = screen.getByText('도착 확인')
    expect(badge).toBeInTheDocument()
    expect(badge.closest('[data-slot="kakao-status-badge"]')).toBeInTheDocument()

    // 이력이 없는 경우: 배지 미표시
    useKakaoHistorySpy.mockReturnValue({
      items: [],
      load: 'ready',
      refresh: vi.fn(),
    })

    rerender(<FixedScheduleBoard
      workspaceId="ws-test-real-42"
      role="manager"
      selectedDate="2026-08-23"
      data={board()}
    />)

    expect(screen.queryByText('도착 확인')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="kakao-status-badge"]')).toBeNull()
  })

  it('예시/프리뷰 모드에서는 fetch를 건너뛰도록 빈 workspaceId로 useKakaoHistory를 호출한다', () => {
    const useKakaoHistorySpy = vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory')

    render(<FixedScheduleBoard
      workspaceId="preview-ws-99"
      role="manager"
      selectedDate="2026-08-23"
      data={board()}
    />)

    expect(useKakaoHistorySpy).toHaveBeenCalledWith({
      workspaceId: '',
      limit: 100,
    })

    render(<FixedScheduleBoard
      workspaceId="ws-default"
      role="manager"
      selectedDate="2026-08-23"
      data={board()}
    />)

    expect(useKakaoHistorySpy).toHaveBeenCalledWith({
      workspaceId: '',
      limit: 100,
    })
  })

  it('알림톡 조회 실패(load === "error") 시 배지 없이 보드는 정상 표시되고 안내 문구를 표시한다', () => {
    const useKakaoHistorySpy = vi.spyOn(useKakaoHistoryModule, 'useKakaoHistory')
    useKakaoHistorySpy.mockReturnValue({
      items: [],
      load: 'error',
      refresh: vi.fn(),
    })

    render(<FixedScheduleBoard
      workspaceId="ws-test-real-42"
      role="manager"
      selectedDate="2026-08-23"
      data={board()}
    />)

    // 보드는 정상 렌더됨
    expect(screen.getByRole('heading', { name: '일정' })).toBeInTheDocument()
    expect(screen.getByText('예약을 확정한 고객')).toBeInTheDocument()
    // 배지는 미표시
    expect(document.querySelector('[data-slot="kakao-status-badge"]')).toBeNull()
    // 오류 문구 표시
    expect(screen.getByText('발송 상태를 불러오지 못했어요')).toBeInTheDocument()
  })
})
