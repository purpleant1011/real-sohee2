import type {
  ContentPerformanceRow,
  CustomerConversation,
  CustomerSignal,
  DataHealthSource,
  MetricState,
  ReportEvidence,
  ReportExperience,
  ReportMetricEvidence,
  ReportSnapshot,
  ReportTrendPoint,
  SocialPerformanceReport,
  SocialPostReport,
  SocialReportMetric,
  SocialReportMetricName,
} from './types'

type MetricAggregate = Readonly<{
  state: MetricState
  value: number | null
  collectedAt: string | null
}>

type BuildReportExperienceInput = Readonly<{
  snapshot: ReportSnapshot
  current: SocialPerformanceReport
  previous: SocialPerformanceReport | null
  conversations: readonly CustomerConversation[]
}>

const metricStatePriority: Readonly<Record<SocialReportMetric['state'], number>> = {
  failed: 6,
  permission_denied: 5,
  collecting: 4,
  not_connected: 3,
  not_supported: 2,
  no_data: 1,
  available: 0,
}

function freezeList<T extends object>(items: readonly T[]): readonly Readonly<T>[] {
  return Object.freeze(items.map((item) => Object.freeze({ ...item })))
}

function stateFromProvider(state: SocialReportMetric['state']): MetricState {
  if (state === 'no_data') return 'confirmed_zero'
  if (state === 'not_connected') return 'stale'
  return state
}

function aggregateMetric(
  report: SocialPerformanceReport | null,
  name: SocialReportMetricName,
): MetricAggregate {
  if (report === null) return Object.freeze({ state: 'collecting', value: null, collectedAt: null })

  const postsWithMetric = report.posts.flatMap((post) => post.metrics
    .filter((candidate) => candidate.metric === name)
    .map((candidate) => ({ metric: candidate, collectedAt: post.collectedAt })))
  const available = postsWithMetric.filter(({ metric }) => metric.state === 'available')
  if (available.length > 0) {
    return Object.freeze({
      state: 'available',
      value: available.reduce((total, item) => total + (item.metric.value ?? 0), 0),
      collectedAt: available.map((item) => item.collectedAt).filter((value): value is string => value !== null).toSorted().at(-1) ?? null,
    })
  }
  if (postsWithMetric.length === 0) {
    return Object.freeze({ state: 'collecting', value: null, collectedAt: null })
  }

  const highest = postsWithMetric.toSorted((left, right) => (
    metricStatePriority[right.metric.state] - metricStatePriority[left.metric.state]
  ))[0]
  return Object.freeze({
    state: stateFromProvider(highest.metric.state),
    value: highest.metric.state === 'no_data' ? 0 : null,
    collectedAt: highest.collectedAt,
  })
}

function formatMetric(state: MetricState, value: number | null, suffix: string): string {
  if (state === 'confirmed_zero') return '확인된 0건'
  if (state === 'collecting') return '수집 중'
  if (state === 'stale') return '수집 지연'
  if (state === 'not_supported') return '현재 미지원'
  if (state === 'permission_denied') return '권한 필요'
  if (state === 'failed') return '수집 실패'
  return `${value ?? 0}${suffix}`
}

function percentChange(current: MetricAggregate, previous: MetricAggregate): number | null {
  if (current.state !== 'available' || previous.state !== 'available') return null
  if (current.value === null || previous.value === null || previous.value === 0) return null
  return Math.round(((current.value - previous.value) / previous.value) * 100)
}

function withSnapshotFallback(
  aggregate: MetricAggregate,
  value: number | null,
  checkedAt: string | null,
  sampleState: ReportSnapshot['sampleState'],
): MetricAggregate {
  if (aggregate.state !== 'collecting' || value === null || checkedAt === null || sampleState === 'unavailable') {
    return aggregate
  }
  return Object.freeze({
    state: value === 0 ? 'confirmed_zero' : 'available',
    value,
    collectedAt: checkedAt,
  })
}

function metricEvidence(
  key: ReportMetricEvidence['key'],
  label: string,
  current: MetricAggregate,
  previous: MetricAggregate,
  suffix: string,
): ReportMetricEvidence {
  return Object.freeze({
    key,
    label,
    state: current.state,
    value: current.value,
    previousValue: previous.state === 'available' || previous.state === 'confirmed_zero' ? previous.value : null,
    changePercent: percentChange(current, previous),
    displayValue: formatMetric(current.state, current.value, suffix),
  })
}

function metricValue(post: SocialPostReport, name: SocialReportMetricName): number | null {
  const candidate = post.metrics.find((item) => item.metric === name && item.state === 'available')
  return candidate?.value ?? null
}

function postCollectionState(post: SocialPostReport): MetricState {
  if (post.collectionStatus === 'permission_denied') return 'permission_denied'
  if (post.collectionStatus === 'failed') return 'failed'
  if (post.collectionStatus === 'no_data') return 'confirmed_zero'
  if (post.collectionStatus === 'succeeded') return 'available'
  return 'collecting'
}

function contentRows(report: SocialPerformanceReport): readonly ContentPerformanceRow[] {
  const rows = report.posts.map((item) => Object.freeze({
    contentItemId: item.contentItemId,
    contentVersionId: item.contentVersionId,
    versionNumber: item.versionNumber,
    publishAttemptId: item.publishAttemptId,
    providerPostReference: item.providerPostReference,
    title: item.workTitle,
    channel: item.channel,
    saved: metricValue(item, 'saved'),
    visits: metricValue(item, 'visits'),
    inquiries: metricValue(item, 'inquiries'),
    collectionState: postCollectionState(item),
    permalink: item.destinationUrl ?? null,
  } satisfies ContentPerformanceRow))

  return Object.freeze(rows.toSorted((left, right) => (
    (right.saved ?? -1) - (left.saved ?? -1)
  )).slice(0, 4))
}

function trendPoints(current: SocialPerformanceReport, previous: SocialPerformanceReport | null): readonly ReportTrendPoint[] {
  const start = new Date(current.periodStart)
  const currentDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(date.getUTCDate() + index)
    return date.toISOString().slice(0, 10)
  })
  const sumForDay = (report: SocialPerformanceReport | null, dayIndex: number, metric: SocialReportMetricName) => {
    if (!report) return null
    const reportStart = new Date(report.periodStart)
    const date = new Date(reportStart)
    date.setUTCDate(date.getUTCDate() + dayIndex)
    const day = date.toISOString().slice(0, 10)
    const values = report.posts
      .filter((post) => (post.publishedAt ?? post.scheduledAt).slice(0, 10) === day)
      .map((post) => post.metrics.find((item) => item.metric === metric))
      .filter((item): item is SocialReportMetric => item !== undefined)
    const available = values.filter((item) => item.state === 'available')
    if (available.length > 0) return available.reduce((total, item) => total + (item.value ?? 0), 0)
    return values.length > 0 && values.every((item) => item.state === 'no_data') ? 0 : null
  }
  return Object.freeze(currentDays.map((date, index) => Object.freeze({
    date,
    label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`,
    saved: sumForDay(current, index, 'saved'),
    inquiries: sumForDay(current, index, 'inquiries'),
    previousSaved: sumForDay(previous, index, 'saved'),
  })))
}

function evidenceRows(report: SocialPerformanceReport): readonly ReportEvidence[] {
  return Object.freeze(report.posts.toSorted((left, right) => (
    (metricValue(right, 'saved') ?? -1) - (metricValue(left, 'saved') ?? -1)
  )).slice(0, 3).map((item) => Object.freeze({
    contentItemId: item.contentItemId,
    contentVersionId: item.contentVersionId,
    versionNumber: item.versionNumber,
    publishAttemptId: item.publishAttemptId,
    providerPostReference: item.providerPostReference,
    title: item.workTitle,
    channel: item.channel,
    collectionState: postCollectionState(item),
    collectedAt: item.collectedAt,
    permalink: item.destinationUrl ?? null,
  })))
}

function customerSignals(conversations: readonly CustomerConversation[]): readonly CustomerSignal[] {
  const priority = (conversation: CustomerConversation): CustomerSignal['priority'] => {
    if (conversation.requiresHumanReview) return 'reply_required'
    if (conversation.bookingId !== null || conversation.inquiryId !== null) return 'booking_likely'
    if (conversation.relatedContentItemId !== null) return 'content_evidence'
    return 'observe'
  }
  const order: Readonly<Record<CustomerSignal['priority'], number>> = {
    reply_required: 0,
    booking_likely: 1,
    content_evidence: 2,
    observe: 3,
  }

  return Object.freeze(conversations.map((conversation) => Object.freeze({
    id: conversation.id,
    channel: conversation.channel,
    summary: conversation.summary,
    intent: conversation.intent,
    occurredAt: conversation.latestMessageAt,
    priority: priority(conversation),
    relatedContentItemId: conversation.relatedContentItemId,
  })).toSorted((left, right) => order[left.priority] - order[right.priority]))
}

function dataHealth(
  saved: MetricAggregate,
  visits: MetricAggregate,
  inquiries: MetricAggregate,
): readonly DataHealthSource[] {
  return freezeList([
    { id: 'instagram-posts', label: '인스타그램 게시 지표', state: saved.state, lastCollectedAt: saved.collectedAt, actionHref: null },
    { id: 'website-visits', label: '웹사이트 방문', state: visits.state, lastCollectedAt: visits.collectedAt, actionHref: visits.state === 'available' ? null : '/app/account' },
    { id: 'customer-inquiries', label: '고객 문의', state: inquiries.state, lastCollectedAt: inquiries.collectedAt, actionHref: inquiries.state === 'available' || inquiries.state === 'confirmed_zero' ? null : '/app/account' },
  ])
}

export function buildReportExperience(input: BuildReportExperienceInput): ReportExperience {
  const currentSaved = aggregateMetric(input.current, 'saved')
  const currentVisits = withSnapshotFallback(
    aggregateMetric(input.current, 'visits'),
    input.snapshot.metrics.visits,
    input.snapshot.checkedAt,
    input.snapshot.sampleState,
  )
  const currentInquiries = withSnapshotFallback(
    aggregateMetric(input.current, 'inquiries'),
    input.snapshot.metrics.inquiries,
    input.snapshot.checkedAt,
    input.snapshot.sampleState,
  )
  const previousSaved = aggregateMetric(input.previous, 'saved')
  const previousVisits = aggregateMetric(input.previous, 'visits')
  const previousInquiries = aggregateMetric(input.previous, 'inquiries')
  const reservationState: MetricAggregate = input.snapshot.metrics.reservations === null
    ? Object.freeze({ state: 'collecting', value: null, collectedAt: input.snapshot.checkedAt })
    : Object.freeze({
      state: input.snapshot.metrics.reservations === 0 ? 'confirmed_zero' : 'available',
      value: input.snapshot.metrics.reservations,
      collectedAt: input.snapshot.checkedAt,
    })
  const previousReservations: MetricAggregate = Object.freeze({ state: 'collecting', value: null, collectedAt: null })
  const savedChange = percentChange(currentSaved, previousSaved)
  const inquiryStopped = currentInquiries.value === 0
    && (currentInquiries.state === 'available' || currentInquiries.state === 'confirmed_zero')
  const title = savedChange !== null && savedChange > 0 && inquiryStopped
    ? '저장 반응은 늘었지만 문의 전환은 멈췄어요'
    : '확인된 반응에서 다음 방향을 찾아볼게요'
  const observedFacts = savedChange === null
    ? ['비교 가능한 저장 반응 자료가 아직 충분하지 않아요.']
    : [`저장 반응은 이전 기간보다 ${savedChange}% ${savedChange >= 0 ? '늘었어요' : '줄었어요'}.`]
  const insightEvidence = evidenceRows(input.current)

  const primaryInsight = Object.freeze({
    id: `briefing:${input.current.periodStart}:${input.current.periodEnd}`,
    title,
    observedFacts: Object.freeze(observedFacts),
    interpretations: Object.freeze([
      savedChange !== null && savedChange > 0
        ? '고민을 바로 말한 첫 문장이 관심을 만들었을 가능성이 있어요.'
        : '반응 차이를 설명할 가설은 비교 자료가 더 필요해요.',
    ]),
    unknowns: Object.freeze([
      inquiryStopped ? '문의가 멈춘 원인은 아직 단정할 수 없어요.' : '반응 변화가 문의에 미친 영향은 아직 단정할 수 없어요.',
    ]),
    confidence: insightEvidence.length >= 2 && savedChange !== null ? 'moderate' as const : 'limited' as const,
    evidence: insightEvidence,
  })
  const briefingEvidence = freezeList([
    metricEvidence('saved', '저장 반응', currentSaved, previousSaved, '건'),
    metricEvidence('visits', '프로필 방문', currentVisits, previousVisits, '건'),
    metricEvidence('inquiries', '문의 전환', currentInquiries, previousInquiries, '건'),
    metricEvidence('reservations', '예약', reservationState, previousReservations, '건'),
  ])

  return Object.freeze({
    briefing: Object.freeze({
      title: '이번 주, 무엇이 달라졌나요?' as const,
      periodStart: input.current.periodStart,
      periodEnd: input.current.periodEnd,
      evidence: briefingEvidence,
      primaryActionLabel: '소희와 개선하기' as const,
    }),
    primaryInsight,
    contentPerformance: contentRows(input.current),
    customerSignals: customerSignals(input.conversations),
    dataHealth: dataHealth(currentSaved, currentVisits, currentInquiries),
    trend: trendPoints(input.current, input.previous),
  })
}
