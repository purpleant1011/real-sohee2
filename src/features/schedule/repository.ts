import { z } from 'zod'
import type { ActionResult } from '@/lib/errors/result'
import type { LocalPublishStatusEntry, LocalExecutionViewState } from '@/features/local-publishing/publish-status-card'
import { NAVER_VISIBILITIES } from '@/features/naver-publish/types'

const uuid = z.string().uuid()
const time = z.string().datetime({ offset: true })
type Query = PromiseLike<{ data: unknown; error: unknown }>

export type ScheduleGateway = Readonly<{
  listApprovals(workspaceId: string): Query
  listItems(workspaceId: string): Query
  listVersions(workspaceId: string): Query
  listConnections(workspaceId: string): Query
  listSchedules(workspaceId: string): Query
  listAttempts(workspaceId: string): Query
  listTracking(workspaceId: string): Query
  listCustomerReservations(workspaceId: string): Query
  listLocalPublishes(workspaceId: string): Query
  listConversationJobs(workspaceId: string): Query
}>

export type ScheduleUnavailableSource =
  | 'content_approvals'
  | 'content_items'
  | 'content_versions'
  | 'channel_connections'
  | 'schedules'
  | 'publish_attempts'
  | 'publish_tracking'
  | 'customer_reservations'
  | 'local_publishes'
  | 'internal_tasks'

const approvalSchema = z.object({
  id: uuid,
  content_id: uuid,
  version_id: uuid,
  decided_at: time,
}).strict()
const itemSchema = z.object({
  id: uuid,
  title: z.string().max(200),
  channel: z.string().min(1).max(80),
  status: z.string().min(1).max(80),
  current_version_id: uuid.nullable(),
}).strict()
const versionSchema = z.object({
  id: uuid,
  content_id: uuid,
  version_number: z.number().int().positive(),
  naver_visibility: z.enum(NAVER_VISIBILITIES).nullable(),
}).strict()
const connectionSchema = z.object({
  id: uuid,
  channel: z.string().min(1).max(80),
  status: z.string().min(1).max(80),
  account_label: z.string().max(120).nullable(),
}).strict()
const scheduleSchema = z.object({
  id: uuid,
  content_id: uuid,
  version_id: uuid,
  publish_at: time,
  timezone: z.string().min(1).max(64),
  status: z.enum(['scheduled', 'publishing', 'published', 'failed', 'cancelled', 'unknown']),
  channel_connection_id: uuid,
  updated_at: time,
}).strict()
const attemptSchema = z.object({
  id: uuid,
  schedule_id: uuid,
  attempt_number: z.number().int().positive(),
  status: z.enum(['pending', 'succeeded', 'failed', 'unknown']),
  provider_reference: z.string().max(500).nullable(),
  error_code: z.string().max(120).nullable(),
  started_at: time,
  finished_at: time.nullable(),
}).strict()
const trackingSchema = z.object({
  publish_attempt_id: uuid,
  destination_url: z.string().url().max(2_048).nullable(),
}).strict()
const reservationSchema = z.object({
  id: uuid,
  channel: z.string().min(1).max(80),
  display_label: z.string().min(1).max(120),
  status: z.string().min(1).max(80),
  intent: z.string().max(120).nullable(),
  latest_message_at: time.nullable(),
  booking_id: uuid,
  booking_starts_at: time.nullable(),
  booking_timezone: z.string().min(1).max(64).nullable(),
}).strict()
const localPublishSchema = z.object({
  id: uuid,
  status: z.string().min(1).max(80),
  channel: z.enum(['naver_blog', 'daangn_business']),
  target_label: z.string().min(1).max(255),
  content_version_id: uuid,
  scheduled_at: time.nullable(),
  auto_execute_until: time.nullable(),
  failure_code: z.string().max(120).nullable(),
  exact_payload: z.record(z.string(), z.unknown()),
  result_url: z.string().url().max(2_048).nullable().optional(),
  current_phase: z.string().max(120).nullable().optional(),
}).strict()
const conversationJobSchema = z.object({
  id: uuid,
  thread_id: uuid,
  kind: z.enum(['chat', 'content_generation', 'image_generation', 'publish_preparation']),
  status: z.enum(['queued', 'running', 'cancel_requested', 'succeeded', 'needs_attention', 'cancelled']),
  queued_at: time,
  started_at: time.nullable(),
  completed_at: time.nullable(),
  safe_error_code: z.string().max(120).nullable(),
}).strict()

export type ScheduleAttempt = Readonly<z.infer<typeof attemptSchema> & { destination_url?: string | null }>
export type ScheduleEntry = Readonly<z.infer<typeof scheduleSchema> & {
  title: string
  channel: string
  versionNumber: number | null
}>
export type SchedulePlan = Readonly<{
  contentId: string
  title: string
  channel: string
  status: string
  versionId: string
  versionNumber: number | null
}>
export type CustomerReservationLink = Readonly<{
  conversationId: string
  channel: string
  displayLabel: string
  status: string
  intent: string | null
  latestMessageAt: string | null
  bookingId: string
  startsAt: string | null
  timezone: string | null
  timingState: 'connected' | 'not_connected'
}>
export type InternalScheduleTask = Readonly<{
  id: string
  conversationThreadId: string
  kind: 'chat' | 'content_generation' | 'image_generation' | 'publish_preparation'
  state: 'preparing' | 'completed' | 'needs_attention' | 'cancelled'
  title: string
  occurredAt: string
  completedAt: string | null
}>
export type ScheduleBoard = Readonly<{
  source: 'actual'
  partialData: boolean
  unavailableSources: readonly ScheduleUnavailableSource[]
  ready: readonly Readonly<{
    approvalId: string
    contentId: string
    versionId: string
    versionNumber: number | null
    title: string
    channel: string
    connections: readonly Readonly<{ id: string; label: string }>[]
  }>[]
  plans: readonly SchedulePlan[]
  schedules: readonly ScheduleEntry[]
  attempts: Readonly<Record<string, ScheduleAttempt>>
  customerReservations: readonly CustomerReservationLink[]
  localPublishes: readonly LocalPublishStatusEntry[]
  internalTasks: readonly InternalScheduleTask[]
}>

const internalTaskTitles: Readonly<Record<InternalScheduleTask['kind'], string>> = {
  chat: '대화 내용을 정리하고 있어요',
  content_generation: '콘텐츠 초안을 준비하고 있어요',
  image_generation: '콘텐츠 이미지를 준비하고 있어요',
  publish_preparation: '게시할 내용을 준비하고 있어요',
}

function internalTaskState(status: z.infer<typeof conversationJobSchema>['status']): InternalScheduleTask['state'] {
  if (status === 'succeeded') return 'completed'
  if (status === 'needs_attention') return 'needs_attention'
  if (status === 'cancelled' || status === 'cancel_requested') return 'cancelled'
  return 'preparing'
}

type QueryResult = Readonly<{ data: unknown; error: unknown }>

async function runQuery(call: () => Query): Promise<QueryResult> {
  try {
    return await Promise.resolve(call())
  } catch (error) {
    return { data: null, error }
  }
}

export function localExecutionViewState(status: string): LocalExecutionViewState {
  if (status === 'reconfirmation_required') return 'reconfirmation_required'
  if (status === 'unknown_result' || status === 'submitted' || status === 'provider_review') return 'unknown_after_submit'
  if (status === 'executing') return 'running'
  if (status === 'succeeded') return 'succeeded'
  if (status === 'failed') return 'failed_before_submit'
  return 'device_waiting'
}

async function productionGateway(): Promise<ScheduleGateway> {
  const { createServerSupabaseClient } = await import('@/lib/supabase/server')
  const supabase = await createServerSupabaseClient()
  return {
    listApprovals: (workspaceId) => supabase.from('approvals')
      .select('id, content_id, version_id, decided_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'approved'),
    listItems: (workspaceId) => supabase.from('content_items')
      .select('id, title, channel, status, current_version_id')
      .eq('workspace_id', workspaceId),
    listVersions: (workspaceId) => supabase.from('content_versions')
      .select('id, content_id, version_number, naver_visibility:structured_payload->>visibility')
      .eq('workspace_id', workspaceId),
    listConnections: (workspaceId) => supabase.from('channel_connections')
      .select('id, channel, status, account_label')
      .eq('workspace_id', workspaceId)
      .eq('status', 'connected'),
    listSchedules: (workspaceId) => supabase.from('schedules')
      .select('id, content_id, version_id, publish_at, timezone, status, channel_connection_id, updated_at')
      .eq('workspace_id', workspaceId)
      .order('publish_at'),
    listAttempts: (workspaceId) => supabase.from('publish_attempts')
      .select('id, schedule_id, attempt_number, status, provider_reference, error_code, started_at, finished_at')
      .eq('workspace_id', workspaceId)
      .order('attempt_number', { ascending: false }),
    listTracking: (workspaceId) => supabase.from('social_post_tracking')
      .select('publish_attempt_id, destination_url')
      .eq('workspace_id', workspaceId),
    listCustomerReservations: (workspaceId) => supabase.from('customer_conversations')
      .select('id, channel, display_label, status, intent, latest_message_at, booking_id, booking_starts_at, booking_timezone')
      .eq('workspace_id', workspaceId)
      .not('booking_id', 'is', null)
      .order('latest_message_at', { ascending: false }),
    listLocalPublishes: (workspaceId) => supabase.from('external_action_requests')
      .select('id, status, channel, target_label, content_version_id, scheduled_at, auto_execute_until, failure_code, exact_payload')
      .eq('workspace_id', workspaceId)
      .in('channel', ['naver_blog', 'daangn_business'])
      .order('created_at', { ascending: false }),
    listConversationJobs: (workspaceId) => supabase.from('conversation_jobs')
      .select('id, thread_id, kind, status, queued_at, started_at, completed_at, safe_error_code')
      .eq('workspace_id', workspaceId)
      .order('queued_at', { ascending: false })
      .limit(100),
  }
}

export async function getScheduleBoard(
  workspaceId: string,
  provided?: ScheduleGateway,
): Promise<ActionResult<ScheduleBoard>> {
  if (!uuid.safeParse(workspaceId).success) {
    return { error: { message: '일정 요청을 확인해 주세요.', requestId: 'schedule-board' } }
  }
  try {
    const source = provided ?? await productionGateway()
    const [approvalRows, itemRows, versionRows, connectionRows, scheduleRows, attemptRows, trackingRows, reservationRows, localPublishRows, jobRows] = await Promise.all([
      runQuery(() => source.listApprovals(workspaceId)),
      runQuery(() => source.listItems(workspaceId)),
      runQuery(() => source.listVersions(workspaceId)),
      runQuery(() => source.listConnections(workspaceId)),
      runQuery(() => source.listSchedules(workspaceId)),
      runQuery(() => source.listAttempts(workspaceId)),
      runQuery(() => source.listTracking(workspaceId)),
      runQuery(() => source.listCustomerReservations(workspaceId)),
      runQuery(() => source.listLocalPublishes(workspaceId)),
      runQuery(() => source.listConversationJobs(workspaceId)),
    ])
    const unavailableSources: ScheduleUnavailableSource[] = []
    function parseRows<T>(sourceName: ScheduleUnavailableSource, result: QueryResult, schema: z.ZodType<T>) {
      const parsed = z.array(schema).safeParse(result.data)
      if (result.error || !parsed.success) {
        unavailableSources.push(sourceName)
        return [] as T[]
      }
      return parsed.data
    }
    const approvals = parseRows('content_approvals', approvalRows, approvalSchema)
    const items = parseRows('content_items', itemRows, itemSchema)
    const versions = parseRows('content_versions', versionRows, versionSchema)
    const connections = parseRows('channel_connections', connectionRows, connectionSchema)
    const schedules = parseRows('schedules', scheduleRows, scheduleSchema)
    const attempts = parseRows('publish_attempts', attemptRows, attemptSchema)
    const tracking = parseRows('publish_tracking', trackingRows, trackingSchema)
    const reservations = parseRows('customer_reservations', reservationRows, reservationSchema)
    const localPublishes = parseRows('local_publishes', localPublishRows, localPublishSchema)
    const conversationJobs = parseRows('internal_tasks', jobRows, conversationJobSchema)
    if (unavailableSources.length === 10) throw new Error('schedule_projection_unavailable')

    const itemById = new Map(items.map((item) => [item.id, item]))
    const versionNumberById = new Map(versions.map((version) => [version.id, version.version_number]))
    const naverVisibilityByVersionId = new Map(versions.flatMap((version) => version.naver_visibility
      ? [[version.id, version.naver_visibility] as const]
      : []))
    const destinationByAttemptId = new Map(tracking.map((row) => [row.publish_attempt_id, row.destination_url]))
    const latestAttempts: Record<string, ScheduleAttempt> = {}
    for (const attempt of attempts) {
      if (!latestAttempts[attempt.schedule_id]) latestAttempts[attempt.schedule_id] = Object.freeze({
        ...attempt,
        destination_url: destinationByAttemptId.get(attempt.id) ?? null,
      })
    }
    const activeScheduleContentIds = new Set(schedules
      .filter((schedule) => schedule.status === 'scheduled' || schedule.status === 'publishing')
      .map((schedule) => schedule.content_id))

    return { data: Object.freeze({
      source: 'actual' as const,
      partialData: unavailableSources.length > 0,
      unavailableSources: Object.freeze(unavailableSources),
      ready: Object.freeze(approvals.flatMap((approval) => {
        const content = itemById.get(approval.content_id)
        if (!content || content.status !== 'approved' || content.current_version_id !== approval.version_id) return []
        return [Object.freeze({
          approvalId: approval.id,
          contentId: approval.content_id,
          versionId: approval.version_id,
          versionNumber: versionNumberById.get(approval.version_id) ?? null,
          title: content.title,
          channel: content.channel,
          connections: Object.freeze(connections
            .filter((connection) => connection.channel === content.channel && connection.status === 'connected')
            .map((connection) => Object.freeze({ id: connection.id, label: connection.account_label ?? connection.channel }))),
        })]
      })),
      plans: Object.freeze(items.flatMap((content) => {
        if (
          !content.current_version_id
          || !['draft', 'review', 'approved'].includes(content.status)
          || activeScheduleContentIds.has(content.id)
        ) return []
        return [Object.freeze({
          contentId: content.id,
          title: content.title,
          channel: content.channel,
          status: content.status,
          versionId: content.current_version_id,
          versionNumber: versionNumberById.get(content.current_version_id) ?? null,
        })]
      })),
      schedules: Object.freeze(schedules.map((schedule) => {
        const content = itemById.get(schedule.content_id)
        return Object.freeze({
          ...schedule,
          title: content?.title ?? '연결 콘텐츠 확인 필요',
          channel: content?.channel ?? '채널 확인 필요',
          versionNumber: versionNumberById.get(schedule.version_id) ?? null,
        })
      })),
      attempts: Object.freeze(latestAttempts),
      customerReservations: Object.freeze(reservations.map((reservation) => Object.freeze({
        conversationId: reservation.id,
        channel: reservation.channel,
        displayLabel: reservation.display_label,
        status: reservation.status,
        intent: reservation.intent,
        latestMessageAt: reservation.latest_message_at,
        bookingId: reservation.booking_id,
        startsAt: reservation.booking_starts_at,
        timezone: reservation.booking_timezone,
        timingState: reservation.booking_starts_at ? 'connected' as const : 'not_connected' as const,
      }))),
      localPublishes: Object.freeze(localPublishes.map((entry) => Object.freeze({
        id: entry.id,
        status: localExecutionViewState(entry.status),
        channel: entry.channel,
        targetLabel: entry.target_label,
        contentVersionId: entry.content_version_id,
        scheduledAt: entry.scheduled_at,
        autoExecuteUntil: entry.auto_execute_until,
        failureCode: entry.failure_code,
        visibility: naverVisibilityByVersionId.get(entry.content_version_id)
          ?? NAVER_VISIBILITIES.find((visibility) => visibility === entry.exact_payload.visibility) ?? 'private',
        resultUrl: entry.result_url ?? null,
        phase: entry.current_phase ?? null,
      }))),
      internalTasks: Object.freeze(conversationJobs.map((job) => Object.freeze({
        id: job.id,
        conversationThreadId: job.thread_id,
        kind: job.kind,
        state: internalTaskState(job.status),
        title: internalTaskTitles[job.kind],
        occurredAt: job.completed_at ?? job.started_at ?? job.queued_at,
        completedAt: job.completed_at,
      }))),
    }) }
  } catch {
    return { error: { message: '일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', requestId: 'schedule-board' } }
  }
}
