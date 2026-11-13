import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { ReportContentPerformance } from './report-content-performance'
import { ReportDashboard } from './report-dashboard'
import { ReportDataHealth } from './report-data-health'
import { ReportSignalRadar } from './report-signal-radar'
import type { ContentPerformanceRow, CustomerSignal, DataHealthSource, ReportExperience, ReportInsight } from './types'

const rows: readonly ContentPerformanceRow[] = [
  ['content-1', 'version-1', '얼굴형보다 먼저 보는 눈썹 균형', 124, 186, 9],
  ['content-2', 'version-2', '첫 시술 전 꼭 묻는 세 가지', 86, 141, 6],
  ['content-3', 'version-3', '자연스러운 인상을 만드는 결', 64, 119, 4],
  ['content-4', 'version-4', '상담 전에 준비할 사진', 48, 103, 3],
].map(([contentItemId, contentVersionId, title, saved, visits, inquiries], index) => ({
  contentItemId: String(contentItemId),
  contentVersionId: String(contentVersionId),
  versionNumber: 4 - index,
  publishAttemptId: `attempt-${index + 1}`,
  providerPostReference: `provider-${index + 1}`,
  title: String(title),
  channel: index === 3 ? 'threads' as const : 'instagram' as const,
  saved: Number(saved),
  visits: Number(visits),
  inquiries: Number(inquiries),
  collectionState: 'available' as const,
}))

const insight: ReportInsight = {
  id: 'insight-1',
  title: '저장 반응은 늘었지만 문의 전환은 멈췄어요',
  observedFacts: ['저장 반응은 이전 기간보다 42% 늘었어요.'],
  interpretations: ['고민을 바로 말한 첫 문장이 관심을 만들었을 가능성이 있어요.'],
  unknowns: ['문의가 멈춘 원인은 아직 단정할 수 없어요.'],
  confidence: 'moderate',
  evidence: [],
}

const signals: readonly CustomerSignal[] = [{
  id: 'signal-1',
  channel: 'instagram',
  summary: '제 얼굴형에도 어울릴까요?',
  intent: '얼굴형 상담 문의',
  occurredAt: '2026-08-22T09:12:00.000Z',
  priority: 'reply_required',
  relatedContentItemId: 'content-1',
}, {
  id: 'signal-2',
  channel: 'naver_place',
  summary: '관리 기간이 궁금해요.',
  intent: '관리와 예약 문의',
  occurredAt: '2026-08-21T16:37:00.000Z',
  priority: 'booking_likely',
  relatedContentItemId: 'content-2',
}]

const sources: readonly DataHealthSource[] = [{
  id: 'instagram-posts',
  label: '인스타그램 게시 지표',
  state: 'available',
  lastCollectedAt: '2026-08-23T00:00:00.000Z',
  actionHref: null,
}, {
  id: 'instagram-messages',
  label: '인스타그램 댓글·DM',
  state: 'permission_denied',
  lastCollectedAt: '2026-08-19T05:15:00.000Z',
  actionHref: '/app/account',
}, {
  id: 'naver-place',
  label: '네이버 플레이스',
  state: 'not_supported',
  lastCollectedAt: null,
  actionHref: null,
}]

const experience: ReportExperience = {
  briefing: {
    title: '이번 주, 무엇이 달라졌나요?',
    periodStart: '2026-08-16T00:00:00.000Z',
    periodEnd: '2026-08-22T23:59:59.999Z',
    evidence: [],
    primaryActionLabel: '소희와 개선하기',
  },
  primaryInsight: insight,
  contentPerformance: rows,
  customerSignals: signals,
  dataHealth: sources,
  trend: [],
}

describe('report analysis surfaces', () => {
  it('ranks four concise exact-version rows and exposes a next-post action', () => {
    render(<ReportContentPerformance insight={insight} rows={rows} />)

    const ranking = screen.getByRole('list', { name: '콘텐츠 성과 순위' })
    expect(within(ranking).getAllByRole('listitem')).toHaveLength(4)
    expect(within(ranking).getByText('저장 반응 1위')).toBeVisible()
    expect(within(ranking).getByText(/게시 버전 v4/)).toBeVisible()
    expect(screen.getByRole('link', { name: '이 패턴으로 새 글 만들기' })).toHaveAttribute(
      'href',
      expect.stringContaining('action=plan'),
    )
  })

  it('prioritizes privacy-safe customer signals and connects them to conversation', () => {
    render(<ReportSignalRadar signals={signals} />)

    expect(screen.getByRole('heading', { level: 1, name: '고객 여정 레이더' })).toBeVisible()
    expect(screen.getByText('제 얼굴형에도 어울릴까요?')).toBeVisible()
    expect(screen.getByText('답변 필요')).toBeVisible()
    expect(screen.getByText('예약 가능성 높음')).toBeVisible()
    expect(screen.queryByText('얼굴형을 문의한 고객')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '대화에서 답변 만들기' })).toHaveAttribute(
      'href',
      expect.stringContaining('/app?'),
    )
  })

  it('explains recovery states without coercing unsupported data to zero', () => {
    render(<ReportDataHealth sources={sources} />)

    expect(screen.getByRole('heading', { level: 1, name: '어떤 자료를 믿고 볼 수 있는지 알려드려요' })).toBeVisible()
    expect(screen.getByText('권한 필요')).toBeVisible()
    expect(screen.getByText('현재 미지원')).toBeVisible()
    expect(screen.queryByText('0건')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '연결 확인하기' })).toHaveAttribute('href', '/app/account')
    expect(screen.getByText('연결을 다시 해도 게시하거나 메시지를 보내지 않아요.')).toBeVisible()
  })

  it('selects an allowlisted report surface through the dashboard boundary', () => {
    render(
      <ReportDashboard
        experience={experience}
        initialSurface="content"
        snapshot={{
          periodStart: '2026-08-16',
          periodEnd: '2026-08-22',
          checkedAt: '2026-08-23T00:00:00.000Z',
          sampleState: 'sufficient',
          message: '확인된 자료를 비교했어요.',
          metrics: { visits: 186, engagements: 142, inquiries: 0, reservations: 5, observedPosts: 4 },
        }}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: '콘텐츠 실험실' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '이번 주, 무엇이 달라졌나요?' })).not.toBeInTheDocument()
  })
})
