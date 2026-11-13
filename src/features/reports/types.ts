export type ReportSampleState = 'sufficient' | 'limited' | 'collecting' | 'unavailable'

export type ReportMetrics = Readonly<{
  visits: number | null
  engagements: number | null
  inquiries: number | null
  reservations: number | null
  observedPosts: number | null
}>

export type ReportSnapshot = Readonly<{
  periodStart: string | null
  periodEnd: string | null
  checkedAt: string | null
  sampleState: ReportSampleState
  message: string
  metrics: ReportMetrics
}>

export type CustomerConversationChannel =
  | 'instagram'
  | 'threads'
  | 'naver_blog'
  | 'naver_place'

export type CustomerConversationStatus =
  | 'open'
  | 'needs_attention'
  | 'waiting_customer'
  | 'resolved'
  | 'archived'

export type CustomerConversation = Readonly<{
  id: string
  channel: CustomerConversationChannel
  displayLabel: string
  status: CustomerConversationStatus
  intent: string | null
  summary: string
  latestMessageAt: string | null
  inquiryId: string | null
  bookingId: string | null
  relatedContentItemId: string | null
  requiresHumanReview: boolean
}>

export type SocialReportMetricState =
  | 'available'
  | 'no_data'
  | 'collecting'
  | 'not_connected'
  | 'not_supported'
  | 'permission_denied'
  | 'failed'

export type SocialReportMetricName =
  | 'views'
  | 'likes'
  | 'comments'
  | 'saved'
  | 'shares'
  | 'replies'
  | 'reposts'
  | 'quotes'
  | 'visits'
  | 'inquiries'

export type SocialReportMetric = Readonly<{
  metric: SocialReportMetricName
  state: SocialReportMetricState
  value: number | null
}>

export type SocialReportReaction = Readonly<{
  id: string
  channel: 'instagram' | 'threads'
  category: 'comment' | 'reply' | 'mention' | 'dm'
  occurredAt: string
  text: string | null
  providerPostReference: string | null
}>

export type SocialPostReport = Readonly<{
  workItemId: string | null
  workTitle: string
  contentItemId: string
  contentVersionId: string
  versionNumber: number
  channel: 'instagram' | 'threads'
  scheduleId: string
  scheduledAt: string
  scheduleStatus: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled'
  publishAttemptId: string
  deliveryStatus: 'pending' | 'succeeded' | 'failed'
  providerPostReference: string | null
  destinationUrl?: string | null
  publishedAt: string | null
  collectionStatus: 'succeeded' | 'no_data' | 'permission_denied' | 'failed' | null
  collectionPeriodStart: string | null
  collectionPeriodEnd: string | null
  collectedAt: string | null
  trackingId?: string | null
  nextCollectionAt?: string | null
  returnVisits?: number | null
  reservationCount?: number | null
  reservationValue?: number | null
  metrics: readonly SocialReportMetric[]
  reactions: readonly SocialReportReaction[]
}>

export type SocialPerformanceReport = Readonly<{
  periodStart: string
  periodEnd: string
  posts: readonly SocialPostReport[]
  unlinkedReactions: readonly SocialReportReaction[]
}>

export type MetricState =
  | 'available'
  | 'confirmed_zero'
  | 'collecting'
  | 'stale'
  | 'not_supported'
  | 'permission_denied'
  | 'failed'

export type ReportEvidence = Readonly<{
  contentItemId: string
  contentVersionId: string
  versionNumber: number
  publishAttemptId: string
  providerPostReference: string | null
  title: string
  channel: SocialPostReport['channel']
  collectionState: MetricState
  collectedAt: string | null
  permalink?: string | null
}>

export type ReportInsight = Readonly<{
  id: string
  title: string
  observedFacts: readonly string[]
  interpretations: readonly string[]
  unknowns: readonly string[]
  confidence: 'limited' | 'moderate' | 'strong'
  evidence: readonly ReportEvidence[]
}>

export type ReportMetricEvidence = Readonly<{
  key: 'saved' | 'visits' | 'inquiries' | 'reservations'
  label: string
  state: MetricState
  value: number | null
  previousValue: number | null
  changePercent: number | null
  displayValue: string
}>

export type ReportBriefing = Readonly<{
  title: '이번 주, 무엇이 달라졌나요?'
  periodStart: string
  periodEnd: string
  evidence: readonly ReportMetricEvidence[]
  primaryActionLabel: '소희와 개선하기'
}>

export type ReportTrendPoint = Readonly<{
  date: string
  label: string
  saved: number | null
  inquiries: number | null
  previousSaved: number | null
}>

export type ContentPerformanceRow = Readonly<{
  contentItemId: string
  contentVersionId: string
  versionNumber: number
  publishAttemptId: string
  providerPostReference: string | null
  title: string
  channel: SocialPostReport['channel']
  saved: number | null
  visits: number | null
  inquiries: number | null
  collectionState: MetricState
  permalink?: string | null
}>

export type CustomerSignal = Readonly<{
  id: string
  channel: CustomerConversationChannel
  summary: string
  intent: string | null
  occurredAt: string | null
  priority: 'reply_required' | 'booking_likely' | 'content_evidence' | 'observe'
  relatedContentItemId: string | null
}>

export type DataHealthSource = Readonly<{
  id: string
  label: string
  state: MetricState
  lastCollectedAt: string | null
  actionHref: string | null
}>

export type ReportExperience = Readonly<{
  briefing: ReportBriefing
  primaryInsight: ReportInsight
  contentPerformance: readonly ContentPerformanceRow[]
  customerSignals: readonly CustomerSignal[]
  dataHealth: readonly DataHealthSource[]
  trend: readonly ReportTrendPoint[]
}>

export type ReportSurface = 'briefing' | 'content' | 'signals' | 'decisions' | 'data-health'
