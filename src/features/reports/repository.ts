import { z } from 'zod'
import type { ReadinessInput } from '@/features/account/readiness'
import { calculateReadiness } from '@/features/account/readiness'
import type { WorkspaceRole } from '@/features/auth/workspace-context'
import type { ActionResult } from '@/lib/errors/result'
import { deriveReportState } from './report-state'
import type {
  CustomerConversation,
  ReportMetrics,
  ReportSnapshot,
  SocialPerformanceReport,
  SocialPostReport,
  SocialReportReaction,
} from './types'

type QueryResult = Promise<{ data: unknown; error: unknown }>

export type OperationsOverviewGateway = {
  getLatestReport(workspaceId: string): QueryResult
  getCustomerConversations(workspaceId: string): QueryResult
  getCustomerConversation(workspaceId: string, conversationId: string): QueryResult
  getBusinessProfile(workspaceId: string): QueryResult
  getBrandProfile(workspaceId: string): QueryResult
  getConnectedChannel(workspaceId: string): QueryResult
  getApprovedKnowledge(workspaceId: string): QueryResult
  getActiveAutomation(workspaceId: string): QueryResult
  getSocialPosts(
    workspaceId: string,
    periodStart: string,
    periodEnd: string,
    contentId: string | null,
  ): QueryResult
  getSocialPostDestinations(workspaceId: string): QueryResult
  getSocialReactions(
    workspaceId: string,
    periodStart: string,
    periodEnd: string,
    contentId: string | null,
  ): QueryResult
}

export type ReadinessSnapshot = Readonly<{
  input: ReadinessInput
  percentage: number
}>

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
const metricSchema = z.number().int().nonnegative().safe().nullable()
const metricsSchema = z
  .object({
    visits: metricSchema,
    engagements: metricSchema,
    inquiries: metricSchema,
    reservations: metricSchema,
    observed_posts: metricSchema,
  })
  .strict()
const reportRowSchema = z
  .object({
    id: uuidSchema,
    workspace_id: uuidSchema,
    period_start: dateSchema,
    period_end: dateSchema,
    status: z.enum(['unavailable', 'insufficient', 'sufficient']),
    metrics: metricsSchema,
    source_ready: z.boolean(),
    checked_at: timestampSchema,
  })
  .strict()
const signalRowSchema = z.object({ workspace_id: uuidSchema }).strict()
const customerConversationRowSchema = z
  .object({
    id: uuidSchema,
    workspace_id: uuidSchema,
    channel: z.enum(['instagram', 'threads', 'naver_blog', 'naver_place']),
    display_label: z.string().min(1).max(120),
    status: z.enum(['open', 'needs_attention', 'waiting_customer', 'resolved', 'archived']),
    intent: z.string().max(120).nullable(),
    summary: z.string().min(1).max(4000),
    latest_message_at: timestampSchema.nullable(),
    inquiry_id: uuidSchema.nullable(),
    booking_id: uuidSchema.nullable(),
    related_content_item_id: uuidSchema.nullable(),
    requires_human_review: z.boolean(),
  })
  .strict()

const socialMetricRowSchema = z.object({
  metric: z.enum([
    'views', 'likes', 'comments', 'saved', 'shares',
    'replies', 'reposts', 'quotes', 'visits', 'inquiries',
  ]),
  state: z.enum(['available', 'no_data', 'not_supported', 'permission_denied', 'failed']),
  value: metricSchema,
}).strict().refine(
  (value) => (value.state === 'available') === (value.value !== null),
  'METRIC_VALUE_STATE_MISMATCH',
)
const socialPostRowSchema = z.object({
  workspace_id: uuidSchema,
  work_item_id: uuidSchema.nullable(),
  work_title: z.string().min(1).max(200),
  content_item_id: uuidSchema,
  content_version_id: uuidSchema,
  version_number: z.number().int().positive(),
  channel: z.enum(['instagram', 'threads']),
  schedule_id: uuidSchema,
  scheduled_at: timestampSchema,
  schedule_status: z.enum(['scheduled', 'publishing', 'published', 'failed', 'cancelled']),
  publish_attempt_id: uuidSchema,
  delivery_status: z.enum(['pending', 'succeeded', 'failed']),
  provider_post_reference: z.string().min(1).max(500).nullable(),
  published_at: timestampSchema.nullable(),
  collection_id: uuidSchema.nullable(),
  collection_status: z.enum(['succeeded', 'no_data', 'permission_denied', 'failed']).nullable(),
  collection_period_start: timestampSchema.nullable(),
  collection_period_end: timestampSchema.nullable(),
  collected_at: timestampSchema.nullable(),
  tracking_id: z.string().min(8).max(80).nullable().optional(),
  next_collection_at: timestampSchema.nullable().optional(),
  return_visits: metricSchema.optional(),
  reservation_count: metricSchema.optional(),
  reservation_value: metricSchema.optional(),
  metrics: z.array(socialMetricRowSchema).max(10),
}).strict()
const socialReactionRowSchema = z.object({
  workspace_id: uuidSchema,
  event_id: uuidSchema,
  provider: z.enum(['instagram', 'threads']),
  category: z.enum(['comment', 'reply', 'mention', 'dm']),
  occurred_at: timestampSchema,
  inbound_text: z.string().max(4000).nullable(),
  provider_post_reference: z.string().min(1).max(500).nullable(),
  publish_attempt_id: uuidSchema.nullable(),
  content_item_id: uuidSchema.nullable(),
  content_version_id: uuidSchema.nullable(),
  work_item_id: uuidSchema.nullable(),
}).strict()
const socialDestinationRowSchema = z.object({
  publish_attempt_id: uuidSchema,
  destination_url: z.string().url().max(2_048).nullable(),
}).strict()

const customerConversationFields = [
  'id',
  'workspace_id',
  'channel',
  'display_label',
  'status',
  'intent',
  'summary',
  'latest_message_at',
  'inquiry_id',
  'booking_id',
  'related_content_item_id',
  'requires_human_review',
].join(', ') as 'id, workspace_id, channel, display_label, status, intent, summary, latest_message_at, inquiry_id, booking_id, related_content_item_id, requires_human_review'

function failure<T>(message: string, requestId: string): ActionResult<T> {
  return { error: { message, requestId } }
}

const emptyMetrics: ReportMetrics = Object.freeze({
  visits: null,
  engagements: null,
  inquiries: null,
  reservations: null,
  observedPosts: null,
})

async function createSupabaseGateway(): Promise<OperationsOverviewGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()

  return {
    async getLatestReport(workspaceId) {
      return supabase
        .from('report_snapshots')
        .select(
          'id, workspace_id, period_start, period_end, status, metrics, source_ready, checked_at',
        )
        .eq('workspace_id', workspaceId)
        .order('period_end', { ascending: false })
        .order('checked_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    },
    async getCustomerConversations(workspaceId) {
      return supabase
        .from('customer_conversations')
        .select(customerConversationFields)
        .eq('workspace_id', workspaceId)
        .order('requires_human_review', { ascending: false })
        .order('latest_message_at', { ascending: false, nullsFirst: false })
        .limit(20)
    },
    async getCustomerConversation(workspaceId, conversationId) {
      return supabase
        .from('customer_conversations')
        .select(customerConversationFields)
        .eq('workspace_id', workspaceId)
        .eq('id', conversationId)
        .maybeSingle()
    },
    async getBusinessProfile(workspaceId) {
      return supabase
        .from('business_profiles')
        .select('workspace_id')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
    },
    async getBrandProfile(workspaceId) {
      return supabase
        .from('brand_profiles')
        .select('workspace_id')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
    },
    async getConnectedChannel(workspaceId) {
      return supabase
        .from('channel_connections')
        .select('workspace_id')
        .eq('workspace_id', workspaceId)
        .eq('status', 'connected')
        .limit(1)
        .maybeSingle()
    },
    async getApprovedKnowledge(workspaceId) {
      return supabase
        .from('knowledge_items')
        .select('workspace_id')
        .eq('workspace_id', workspaceId)
        .eq('status', 'approved')
        .limit(1)
        .maybeSingle()
    },
    async getActiveAutomation(workspaceId) {
      return supabase
        .from('automation_rules')
        .select('workspace_id')
        .eq('workspace_id', workspaceId)
        .eq('active', true)
        .limit(1)
        .maybeSingle()
    },
    async getSocialPosts(workspaceId, periodStart, periodEnd, contentId) {
      return supabase.rpc('list_social_post_reports_v075' as never, {
        p_workspace_id: workspaceId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_content_id: contentId,
      } as never) as unknown as QueryResult
    },
    async getSocialPostDestinations(workspaceId) {
      return supabase
        .from('social_post_tracking')
        .select('publish_attempt_id, destination_url')
        .eq('workspace_id', workspaceId)
    },
    async getSocialReactions(workspaceId, periodStart, periodEnd, contentId) {
      return supabase.rpc('list_social_report_reactions' as never, {
        p_workspace_id: workspaceId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_content_id: contentId,
      } as never) as unknown as QueryResult
    },
  }
}

function mapReaction(row: z.infer<typeof socialReactionRowSchema>): SocialReportReaction {
  return Object.freeze({
    id: row.event_id,
    channel: row.provider,
    category: row.category,
    occurredAt: row.occurred_at,
    text: row.inbound_text,
    providerPostReference: row.provider_post_reference,
  })
}

export async function getSocialPerformanceReport(
  workspaceId: string,
  filters: Readonly<{
    periodStart: string
    periodEnd: string
    contentId: string | null
  }>,
  providedGateway?: OperationsOverviewGateway,
): Promise<ActionResult<SocialPerformanceReport>> {
  const parsedWorkspace = uuidSchema.safeParse(workspaceId)
  const parsedStart = timestampSchema.safeParse(filters.periodStart)
  const parsedEnd = timestampSchema.safeParse(filters.periodEnd)
  const parsedContent = filters.contentId === null
    ? { success: true as const, data: null }
    : uuidSchema.safeParse(filters.contentId)
  if (
    !parsedWorkspace.success || !parsedStart.success || !parsedEnd.success
    || !parsedContent.success
    || Date.parse(parsedEnd.data) < Date.parse(parsedStart.data)
    || Date.parse(parsedEnd.data) - Date.parse(parsedStart.data) > 366 * 24 * 60 * 60_000
  ) {
    return failure('소셜 리포트 요청을 확인해 주세요.', 'social-performance-input')
  }

  try {
    const gateway = providedGateway ?? await createSupabaseGateway()
    const [postsResult, destinationsResult, reactionsResult] = await Promise.all([
      gateway.getSocialPosts(
        parsedWorkspace.data, parsedStart.data, parsedEnd.data, parsedContent.data,
      ),
      gateway.getSocialPostDestinations(parsedWorkspace.data),
      gateway.getSocialReactions(
        parsedWorkspace.data, parsedStart.data, parsedEnd.data, parsedContent.data,
      ),
    ])
    const posts = z.array(socialPostRowSchema).max(100).safeParse(postsResult.data)
    const destinations = z.array(socialDestinationRowSchema).max(500).safeParse(destinationsResult.data)
    const reactions = z.array(socialReactionRowSchema).max(200).safeParse(reactionsResult.data)
    if (
      postsResult.error || destinationsResult.error || reactionsResult.error
      || !posts.success || !destinations.success || !reactions.success
      || posts.data.some((row) => row.workspace_id !== parsedWorkspace.data)
      || reactions.data.some((row) => row.workspace_id !== parsedWorkspace.data)
    ) throw new Error('invalid-social-report')

    const reactionsByAttempt = new Map<string, SocialReportReaction[]>()
    const destinationByAttemptId = new Map(destinations.success
      ? destinations.data.map((row) => [row.publish_attempt_id, row.destination_url])
      : [])
    const unlinkedReactions: SocialReportReaction[] = []
    for (const row of reactions.data) {
      const mapped = mapReaction(row)
      if (row.publish_attempt_id === null) {
        unlinkedReactions.push(mapped)
      } else {
        const values = reactionsByAttempt.get(row.publish_attempt_id) ?? []
        values.push(mapped)
        reactionsByAttempt.set(row.publish_attempt_id, values)
      }
    }
    const mappedPosts: SocialPostReport[] = posts.data.map((row) => Object.freeze({
      workItemId: row.work_item_id,
      workTitle: row.work_title,
      contentItemId: row.content_item_id,
      contentVersionId: row.content_version_id,
      versionNumber: row.version_number,
      channel: row.channel,
      scheduleId: row.schedule_id,
      scheduledAt: row.scheduled_at,
      scheduleStatus: row.schedule_status,
      publishAttemptId: row.publish_attempt_id,
      deliveryStatus: row.delivery_status,
      providerPostReference: row.provider_post_reference,
      destinationUrl: destinationByAttemptId.get(row.publish_attempt_id) ?? null,
      publishedAt: row.published_at,
      collectionStatus: row.collection_status,
      collectionPeriodStart: row.collection_period_start,
      collectionPeriodEnd: row.collection_period_end,
      collectedAt: row.collected_at,
      trackingId: row.tracking_id ?? null,
      nextCollectionAt: row.next_collection_at ?? null,
      returnVisits: row.return_visits ?? null,
      reservationCount: row.reservation_count ?? null,
      reservationValue: row.reservation_value ?? null,
      metrics: Object.freeze(row.metrics.map((metric) => Object.freeze(metric))),
      reactions: Object.freeze(reactionsByAttempt.get(row.publish_attempt_id) ?? []),
    }))
    return { data: Object.freeze({
      periodStart: parsedStart.data,
      periodEnd: parsedEnd.data,
      posts: Object.freeze(mappedPosts),
      unlinkedReactions: Object.freeze(unlinkedReactions),
    }) }
  } catch {
    return failure(
      '소셜 성과 리포트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      'social-performance',
    )
  }
}

function mapCustomerConversation(
  row: z.infer<typeof customerConversationRowSchema>,
): CustomerConversation {
  return Object.freeze({
    id: row.id,
    channel: row.channel,
    displayLabel: row.display_label,
    status: row.status,
    intent: row.intent,
    summary: row.summary,
    latestMessageAt: row.latest_message_at,
    inquiryId: row.inquiry_id,
    bookingId: row.booking_id,
    relatedContentItemId: row.related_content_item_id,
    requiresHumanReview: row.requires_human_review,
  })
}

export async function getCustomerConversations(
  workspaceId: string,
  providedGateway?: OperationsOverviewGateway,
): Promise<ActionResult<readonly CustomerConversation[]>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) {
    return failure('고객 대화 요청을 확인해 주세요.', 'customer-conversations-input')
  }

  try {
    const gateway = providedGateway ?? (await createSupabaseGateway())
    const result = await gateway.getCustomerConversations(parsedWorkspaceId.data)
    if (result.error) {
      return failure(
        '고객 대화를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'customer-conversations',
      )
    }

    const rows = z.array(customerConversationRowSchema).max(20).safeParse(result.data)
    if (!rows.success || rows.data.some((row) => row.workspace_id !== parsedWorkspaceId.data)) {
      return failure(
        '고객 대화를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'customer-conversations',
      )
    }

    return { data: Object.freeze(rows.data.map(mapCustomerConversation)) }
  } catch {
    return failure(
      '고객 대화를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      'customer-conversations',
    )
  }
}

export async function getCustomerConversation(
  workspaceId: string,
  conversationId: string,
  providedGateway?: OperationsOverviewGateway,
): Promise<ActionResult<CustomerConversation | null>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  const parsedConversationId = uuidSchema.safeParse(conversationId)
  if (!parsedWorkspaceId.success || !parsedConversationId.success) {
    return failure('고객 대화 요청을 확인해 주세요.', 'customer-conversation-input')
  }

  try {
    const gateway = providedGateway ?? (await createSupabaseGateway())
    const result = await gateway.getCustomerConversation(
      parsedWorkspaceId.data,
      parsedConversationId.data,
    )
    if (result.error) {
      return failure(
        '고객 대화를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'customer-conversation',
      )
    }

    if (result.data === null) return { data: null }

    const row = customerConversationRowSchema.safeParse(result.data)
    if (!row.success || row.data.workspace_id !== parsedWorkspaceId.data) {
      return failure(
        '고객 대화를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'customer-conversation',
      )
    }

    return { data: mapCustomerConversation(row.data) }
  } catch {
    return failure(
      '고객 대화를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      'customer-conversation',
    )
  }
}

function mapMetrics(metrics: z.infer<typeof metricsSchema>): ReportMetrics {
  return Object.freeze({
    visits: metrics.visits,
    engagements: metrics.engagements,
    inquiries: metrics.inquiries,
    reservations: metrics.reservations,
    observedPosts: metrics.observed_posts,
  })
}

export async function getReportSnapshot(
  workspaceId: string,
  providedGateway?: OperationsOverviewGateway,
): Promise<ActionResult<ReportSnapshot>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) {
    return failure('리포트 요청을 확인해 주세요.', 'report-snapshot-input')
  }

  try {
    const gateway = providedGateway ?? (await createSupabaseGateway())
    const result = await gateway.getLatestReport(parsedWorkspaceId.data)
    if (result.error) {
      return failure(
        '리포트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'report-snapshot',
      )
    }

    if (result.data === null) {
      const state = deriveReportState({
        observedPosts: null,
        checkedAt: null,
        sourceReady: true,
      })
      return {
        data: Object.freeze({
          periodStart: null,
          periodEnd: null,
          checkedAt: null,
          sampleState: state.kind,
          message: state.message,
          metrics: emptyMetrics,
        }),
      }
    }

    const row = reportRowSchema.safeParse(result.data)
    if (!row.success || row.data.workspace_id !== parsedWorkspaceId.data) {
      return failure(
        '리포트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'report-snapshot',
      )
    }

    const metrics = mapMetrics(row.data.metrics)
    const state = deriveReportState({
      observedPosts: metrics.observedPosts,
      checkedAt: new Date(row.data.checked_at),
      sourceReady: row.data.source_ready,
    })
    return {
      data: Object.freeze({
        periodStart: row.data.period_start,
        periodEnd: row.data.period_end,
        checkedAt: row.data.checked_at,
        sampleState: state.kind,
        message: state.message,
        metrics,
      }),
    }
  } catch {
    return failure(
      '리포트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      'report-snapshot',
    )
  }
}

function hasWorkspaceSignal(data: unknown, workspaceId: string): boolean | null {
  if (data === null) return false

  const parsed = signalRowSchema.safeParse(data)
  if (!parsed.success || parsed.data.workspace_id !== workspaceId) return null
  return true
}

export async function getReadinessSnapshot(
  workspaceId: string,
  role: WorkspaceRole,
  providedGateway?: OperationsOverviewGateway,
): Promise<ActionResult<ReadinessSnapshot>> {
  const parsedWorkspaceId = uuidSchema.safeParse(workspaceId)
  if (!parsedWorkspaceId.success) {
    return failure('준비 상태 요청을 확인해 주세요.', 'account-readiness-input')
  }

  try {
    const gateway = providedGateway ?? (await createSupabaseGateway())
    const results = await Promise.all([
      gateway.getBusinessProfile(parsedWorkspaceId.data),
      gateway.getBrandProfile(parsedWorkspaceId.data),
      gateway.getConnectedChannel(parsedWorkspaceId.data),
      gateway.getApprovedKnowledge(parsedWorkspaceId.data),
      gateway.getActiveAutomation(parsedWorkspaceId.data),
    ])

    if (results.some((result) => result.error)) {
      return failure(
        '준비 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'account-readiness',
      )
    }

    const signals = results.map((result) => hasWorkspaceSignal(result.data, parsedWorkspaceId.data))
    if (signals.some((signal) => signal === null)) {
      return failure(
        '준비 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'account-readiness',
      )
    }

    const input: ReadinessInput = Object.freeze({
      business: signals[0] as boolean,
      brand: signals[1] as boolean,
      channel: signals[2] as boolean,
      knowledge: signals[3] as boolean,
      automation: signals[4] as boolean,
      permissions: role === 'owner' || role === 'manager' || role === 'reviewer' || role === 'viewer',
    })
    const readiness = calculateReadiness(input)
    if (readiness.kind !== 'ready') {
      return failure(
        '준비 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        'account-readiness',
      )
    }

    return { data: Object.freeze({ input, percentage: readiness.percentage }) }
  } catch {
    return failure(
      '준비 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      'account-readiness',
    )
  }
}
