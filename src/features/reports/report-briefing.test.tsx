import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildReportExperience } from './report-experience'
import { ReportBriefingView } from './report-briefing'
import { ReportInsightDetail } from './report-insight-detail'
import type { SocialPerformanceReport } from './types'

const current: SocialPerformanceReport = {
  periodStart: '2026-08-16T00:00:00.000Z',
  periodEnd: '2026-08-22T23:59:59.999Z',
  posts: [{
    workItemId: 'work-1',
    workTitle: '얼굴형보다 먼저 보는 눈썹 균형',
    contentItemId: 'content-1',
    contentVersionId: 'version-1',
    versionNumber: 3,
    channel: 'instagram',
    scheduleId: 'schedule-1',
    scheduledAt: '2026-08-20T10:00:00.000Z',
    scheduleStatus: 'published',
    publishAttemptId: 'attempt-1',
    deliveryStatus: 'succeeded',
    providerPostReference: 'provider-1',
    publishedAt: '2026-08-20T10:05:00.000Z',
    collectionStatus: 'succeeded',
    collectionPeriodStart: '2026-08-16T00:00:00.000Z',
    collectionPeriodEnd: '2026-08-22T23:59:59.999Z',
    collectedAt: '2026-08-23T00:00:00.000Z',
    metrics: [
      { metric: 'saved', state: 'available', value: 142 },
      { metric: 'visits', state: 'available', value: 186 },
      { metric: 'inquiries', state: 'no_data', value: null },
    ],
    reactions: [],
  }, {
    workItemId: 'work-2',
    workTitle: '첫 상담 전에 묻는 세 가지',
    contentItemId: 'content-2',
    contentVersionId: 'version-2',
    versionNumber: 2,
    channel: 'instagram',
    scheduleId: 'schedule-2',
    scheduledAt: '2026-08-18T10:00:00.000Z',
    scheduleStatus: 'published',
    publishAttemptId: 'attempt-2',
    deliveryStatus: 'succeeded',
    providerPostReference: 'provider-2',
    publishedAt: '2026-08-18T10:05:00.000Z',
    collectionStatus: 'no_data',
    collectionPeriodStart: '2026-08-16T00:00:00.000Z',
    collectionPeriodEnd: '2026-08-22T23:59:59.999Z',
    collectedAt: '2026-08-23T00:00:00.000Z',
    metrics: [
      { metric: 'saved', state: 'no_data', value: null },
      { metric: 'visits', state: 'no_data', value: null },
      { metric: 'inquiries', state: 'no_data', value: null },
    ],
    reactions: [],
  }],
  unlinkedReactions: [],
}

const previous: SocialPerformanceReport = {
  ...current,
  periodStart: '2026-08-09T00:00:00.000Z',
  periodEnd: '2026-08-15T23:59:59.999Z',
  posts: [{
    ...current.posts[0],
    contentItemId: 'content-previous',
    contentVersionId: 'version-previous',
    publishAttemptId: 'attempt-previous',
    metrics: [
      { metric: 'saved', state: 'available', value: 100 },
      { metric: 'visits', state: 'available', value: 158 },
      { metric: 'inquiries', state: 'no_data', value: null },
    ],
  }],
}

const experience = buildReportExperience({
  snapshot: {
    periodStart: '2026-08-16',
    periodEnd: '2026-08-22',
    checkedAt: '2026-08-23T00:00:00.000Z',
    sampleState: 'sufficient',
    message: '확인된 자료를 비교했어요.',
    metrics: { visits: 186, engagements: 142, inquiries: 0, reservations: 5, observedPosts: 1 },
  },
  current,
  previous,
  conversations: [],
})

describe('decision-first report briefing', () => {
  it('shows one primary briefing and action before raw evidence', () => {
    render(<ReportBriefingView experience={experience} sampleState="sufficient" />)

    expect(screen.getByRole('heading', { level: 1, name: '이번 주, 무엇이 달라졌나요?' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '저장 반응은 늘었지만 문의 전환은 멈췄어요' })).toBeVisible()
    expect(screen.getByText('이번 주 가장 중요한 일')).toBeVisible()
    expect(screen.getByRole('region', { name: '이번 주와 이전 주의 7일 반응 추이' })).toBeVisible()
    expect(screen.getByRole('table', { name: '7일 반응 추이 원자료' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '이번 주' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: '지난 주' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: '신뢰도' })).toBeVisible()
    expect(screen.getByText('데이터 상태')).toBeVisible()
    expect(screen.getByRole('link', { name: '소희와 개선하기' })).toHaveAttribute(
      'href',
      expect.stringContaining('action=plan'),
    )
    expect(screen.getByRole('link', { name: '다음 주 일정에 추가' })).toHaveAttribute(
      'href',
      expect.stringContaining('action=experiment'),
    )
    expect(screen.getByRole('link', { name: '인사이트 근거 상세 보기' })).toHaveAttribute(
      'href',
      expect.stringContaining('insight='),
    )
    expect(screen.queryByText('AARRR 고객 여정')).not.toBeInTheDocument()
  })

  it('renders facts separately from interpretation and unknowns', () => {
    render(<ReportInsightDetail insight={experience.primaryInsight} />)

    expect(screen.getByRole('heading', { level: 1, name: experience.primaryInsight.title })).toBeVisible()
    expect(screen.getByRole('heading', { name: '관찰된 사실' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '가능한 해석' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '아직 모르는 것' })).toBeVisible()
    expect(screen.getByText('근거 충분도: 보통')).toBeVisible()
    expect(screen.getByText(/게시 버전 v3/)).toBeVisible()
    expect(screen.getByText('version-1')).toBeVisible()
    expect(screen.getByRole('link', { name: '이 근거로 새 글 만들기' })).toHaveAttribute(
      'href',
      expect.stringContaining('action=plan'),
    )
  })
})
