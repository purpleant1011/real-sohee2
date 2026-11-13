import { describe, expect, it } from 'vitest'
import { buildReportExperience } from './report-experience'
import type {
  CustomerConversation,
  ReportSnapshot,
  SocialPerformanceReport,
  SocialPostReport,
  SocialReportMetric,
} from './types'

function metric(
  name: SocialReportMetric['metric'],
  state: SocialReportMetric['state'],
  value: number | null,
): SocialReportMetric {
  return { metric: name, state, value }
}

function post(input: Readonly<{
  id: string
  title: string
  saved: SocialReportMetric
  visits: SocialReportMetric
  inquiries: SocialReportMetric
  reactions?: SocialPostReport['reactions']
  collectedAt?: string | null
}>): SocialPostReport {
  return {
    workItemId: `work-${input.id}`,
    workTitle: input.title,
    contentItemId: `content-${input.id}`,
    contentVersionId: `version-${input.id}`,
    versionNumber: 3,
    channel: 'instagram',
    scheduleId: `schedule-${input.id}`,
    scheduledAt: '2026-08-20T10:00:00.000Z',
    scheduleStatus: 'published',
    publishAttemptId: `attempt-${input.id}`,
    deliveryStatus: 'succeeded',
    providerPostReference: `provider-${input.id}`,
    publishedAt: '2026-08-20T10:05:00.000Z',
    collectionStatus: 'succeeded',
    collectionPeriodStart: '2026-08-16T00:00:00.000Z',
    collectionPeriodEnd: '2026-08-22T23:59:59.999Z',
    collectedAt: input.collectedAt === undefined ? '2026-08-23T00:00:00.000Z' : input.collectedAt,
    metrics: [input.saved, input.visits, input.inquiries],
    reactions: input.reactions ?? [],
  }
}

const snapshot: ReportSnapshot = {
  periodStart: '2026-08-16',
  periodEnd: '2026-08-22',
  checkedAt: '2026-08-23T00:00:00.000Z',
  sampleState: 'sufficient',
  message: '관측된 게시물 기준으로 성과를 확인할 수 있어요.',
  metrics: {
    visits: 186,
    engagements: 142,
    inquiries: 0,
    reservations: 5,
    observedPosts: 3,
  },
}

const conversations: readonly CustomerConversation[] = [{
  id: 'conversation-1',
  channel: 'instagram',
  displayLabel: '얼굴형을 문의한 고객',
  status: 'needs_attention',
  intent: '얼굴형 상담 문의',
  summary: '제 얼굴형에도 어울릴까요?',
  latestMessageAt: '2026-08-22T09:12:00.000Z',
  inquiryId: 'inquiry-1',
  bookingId: null,
  relatedContentItemId: 'content-current-1',
  requiresHumanReview: true,
}]

function report(posts: readonly SocialPostReport[]): SocialPerformanceReport {
  return {
    periodStart: '2026-08-16T00:00:00.000Z',
    periodEnd: '2026-08-22T23:59:59.999Z',
    posts,
    unlinkedReactions: [],
  }
}

describe('buildReportExperience', () => {
  it('keeps collecting and provider-confirmed zero distinct', () => {
    const current = report([post({
      id: 'state',
      title: '상태 구분 게시물',
      saved: metric('saved', 'collecting', null),
      visits: metric('visits', 'not_supported', null),
      inquiries: metric('inquiries', 'no_data', null),
    })])

    const experience = buildReportExperience({
      snapshot: { ...snapshot, sampleState: 'collecting' },
      current,
      previous: null,
      conversations: [],
    })

    expect(experience.briefing.evidence.find((item) => item.key === 'saved')).toMatchObject({
      state: 'collecting',
      value: null,
      displayValue: '수집 중',
    })
    expect(experience.briefing.evidence.find((item) => item.key === 'inquiries')).toMatchObject({
      state: 'confirmed_zero',
      value: 0,
      displayValue: '확인된 0건',
    })
    expect(experience.briefing.evidence.find((item) => item.key === 'visits')).toMatchObject({
      state: 'not_supported',
      value: null,
      displayValue: '현재 미지원',
    })
  })

  it('uses a checked snapshot zero when no post-level metric exists yet', () => {
    const experience = buildReportExperience({
      snapshot: {
        ...snapshot,
        metrics: { ...snapshot.metrics, visits: 0, inquiries: 0 },
      },
      current: report([]),
      previous: null,
      conversations: [],
    })

    expect(experience.briefing.evidence.find((item) => item.key === 'visits')).toMatchObject({
      state: 'confirmed_zero',
      value: 0,
      displayValue: '확인된 0건',
    })
    expect(experience.briefing.evidence.find((item) => item.key === 'inquiries')).toMatchObject({
      state: 'confirmed_zero',
      value: 0,
      displayValue: '확인된 0건',
    })
  })

  it('builds a decision-first insight from current and previous saved reactions', () => {
    const current = report([
      post({
        id: 'current-1',
        title: '얼굴형보다 먼저 보는 눈썹 균형',
        saved: metric('saved', 'available', 82),
        visits: metric('visits', 'available', 100),
        inquiries: metric('inquiries', 'available', 0),
      }),
      post({
        id: 'current-2',
        title: '첫 상담 전에 묻는 세 가지',
        saved: metric('saved', 'available', 60),
        visits: metric('visits', 'available', 86),
        inquiries: metric('inquiries', 'available', 0),
      }),
    ])
    const previous = report([post({
      id: 'previous-1',
      title: '이전 기간 게시물',
      saved: metric('saved', 'available', 100),
      visits: metric('visits', 'available', 158),
      inquiries: metric('inquiries', 'available', 0),
    })])

    const experience = buildReportExperience({ snapshot, current, previous, conversations })

    expect(experience.briefing.title).toBe('이번 주, 무엇이 달라졌나요?')
    expect(experience.primaryInsight.title).toBe('저장 반응은 늘었지만 문의 전환은 멈췄어요')
    expect(experience.primaryInsight.observedFacts).toContain('저장 반응은 이전 기간보다 42% 늘었어요.')
    expect(experience.primaryInsight.interpretations[0]).toMatch(/가능성이 있어요/)
    expect(experience.primaryInsight.unknowns[0]).toBe('문의가 멈춘 원인은 아직 단정할 수 없어요.')
    expect(experience.primaryInsight.confidence).toBe('moderate')
  })

  it('preserves exact-version evidence and ranks only concise top content rows', () => {
    const current = report(Array.from({ length: 6 }, (_, index) => post({
      id: `rank-${index + 1}`,
      title: `게시물 ${index + 1}`,
      saved: metric('saved', 'available', 60 - index * 10),
      visits: metric('visits', 'available', 100),
      inquiries: metric('inquiries', 'available', index),
    })))

    const experience = buildReportExperience({ snapshot, current, previous: null, conversations: [] })

    expect(experience.contentPerformance).toHaveLength(4)
    expect(experience.contentPerformance[0]).toMatchObject({
      contentItemId: 'content-rank-1',
      contentVersionId: 'version-rank-1',
      versionNumber: 3,
      publishAttemptId: 'attempt-rank-1',
      providerPostReference: 'provider-rank-1',
      saved: 60,
    })
    expect(experience.primaryInsight.evidence[0]).toMatchObject({
      contentVersionId: 'version-rank-1',
      collectionState: 'available',
      collectedAt: '2026-08-23T00:00:00.000Z',
    })
  })

  it('prioritizes human-review customer signals without exposing an account identifier', () => {
    const current = report([post({
      id: 'signal',
      title: '얼굴형 추천 디자인',
      saved: metric('saved', 'available', 12),
      visits: metric('visits', 'available', 40),
      inquiries: metric('inquiries', 'available', 1),
    })])

    const experience = buildReportExperience({ snapshot, current, previous: null, conversations })

    expect(experience.customerSignals[0]).toMatchObject({
      id: 'conversation-1',
      summary: '제 얼굴형에도 어울릴까요?',
      priority: 'reply_required',
      relatedContentItemId: 'content-current-1',
    })
    expect(experience.customerSignals[0]).not.toHaveProperty('displayLabel')
  })

  it('freezes the derived experience so an interaction cannot rewrite historical evidence', () => {
    const current = report([post({
      id: 'frozen',
      title: '고정 근거 게시물',
      saved: metric('saved', 'available', 10),
      visits: metric('visits', 'available', 20),
      inquiries: metric('inquiries', 'available', 1),
    })])

    const experience = buildReportExperience({ snapshot, current, previous: null, conversations: [] })

    expect(Object.isFrozen(experience)).toBe(true)
    expect(Object.isFrozen(experience.primaryInsight)).toBe(true)
    expect(Object.isFrozen(experience.primaryInsight.evidence)).toBe(true)
    expect(Object.isFrozen(experience.contentPerformance)).toBe(true)
  })
})
