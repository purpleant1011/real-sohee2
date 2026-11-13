import { runProductionLinearDoneSweep } from '@/features/linear-archive/sweep'
import { runServerNotificationOutbox } from '@/features/kakao/notify/outbox-server-runtime'

type Env = Record<string, unknown>

function resolveFetcher(value: unknown): typeof fetch {
  return typeof value === 'function' ? value as typeof fetch : fetch
}

function isProductionReportBoundary(now = new Date()) {
  return now.getUTCMinutes() === 0 && now.getUTCHours() % 6 === 0
}

export async function runEngagementSchedule(env: Env, fetcherOrContext?: unknown) {
  const fetcher = resolveFetcher(fetcherOrContext)
  if (typeof env.CRON_SECRET !== 'string' || env.CRON_SECRET.length < 20 || typeof env.APP_URL !== 'string') {
    return { ok: false, reason: 'unavailable' }
  }

  const response = await fetcher(new Request(new URL('/api/internal/engagement/run', env.APP_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  }))
  if (!response.ok) return { ok: false, reason: 'failed' }

  const data = await response.json().catch(() => null) as { workspacesProcessed?: unknown } | null
  return {
    ok: true,
    workspacesProcessed: typeof data?.workspacesProcessed === 'number' ? data.workspacesProcessed : 0,
  }
}

export async function runEngagementPurgeSchedule(env: Env, fetcherOrContext?: unknown) {
  const fetcher = resolveFetcher(fetcherOrContext)
  if (typeof env.CRON_SECRET !== 'string' || env.CRON_SECRET.length < 20 || typeof env.APP_URL !== 'string') {
    return { ok: false, reason: 'unavailable' }
  }

  const response = await fetcher(new Request(new URL('/api/internal/engagement/purge', env.APP_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  }))
  if (!response.ok) return { ok: false, reason: 'failed' }

  const data = await response.json().catch(() => null) as {
    threads?: unknown
    messages?: unknown
    drafts?: unknown
    hasMore?: unknown
    comments?: unknown
    commentDrafts?: unknown
    commentsHasMore?: unknown
  } | null

  return {
    ok: true,
    threads: typeof data?.threads === 'number' ? data.threads : 0,
    messages: typeof data?.messages === 'number' ? data.messages : 0,
    drafts: typeof data?.drafts === 'number' ? data.drafts : 0,
    hasMore: Boolean(data?.hasMore),
    comments: typeof data?.comments === 'number' ? data.comments : 0,
    commentDrafts: typeof data?.commentDrafts === 'number' ? data.commentDrafts : 0,
    commentsHasMore: Boolean(data?.commentsHasMore),
  }
}

export async function runReportOnlySchedule(env: Env, fetcherOrContext?: unknown) {
  // Authoritative Linear cleanup: every cron invocation scans Done and archives anything
  // that has remained completed for at least 15 minutes. Missed webhooks do not matter.
  try {
    await runProductionLinearDoneSweep(env)
  } catch (error) {
    console.error('Linear Done sweep failed; next minute will retry', error)
  }

  const injectedFetcher = typeof fetcherOrContext === 'function'

  // Preserve the existing slow sweep while due routines also use the quarter-hour path.
  if (!injectedFetcher && !isProductionReportBoundary()) {
    return { claimed: 0, reason: 'not_due' }
  }
  return runReportOnlyDueSchedule(env, fetcherOrContext)
}

export async function runReportOnlyDueSchedule(env: Env, fetcherOrContext?: unknown) {
  const fetcher = resolveFetcher(fetcherOrContext)
  if (env.SOHEE_REPORT_ONLY_DUE_ENABLED !== '1') return { claimed: 0, reason: 'disabled' }
  if (typeof env.CRON_SECRET !== 'string' || env.CRON_SECRET.length < 20 || typeof env.APP_URL !== 'string') {
    return { claimed: 0, reason: 'unavailable' }
  }

  const response = await fetcher(new Request(new URL('/api/internal/automations/run-due', env.APP_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  }))
  if (!response.ok) return { claimed: 0, reason: 'failed' }

  const data = await response.json() as { claimed?: unknown; completed?: unknown }
  return {
    claimed: typeof data.claimed === 'number' ? data.claimed : 0,
    completed: typeof data.completed === 'number' ? data.completed : 0,
  }
}

export async function runNaverPostReconcileSchedule(env: Env, fetcherOrContext?: unknown) {
  const fetcher = resolveFetcher(fetcherOrContext)
  if (typeof env.CRON_SECRET !== 'string' || env.CRON_SECRET.length < 20 || typeof env.APP_URL !== 'string') {
    return { ok: false, reason: 'unavailable' }
  }

  const response = await fetcher(new Request(new URL('/api/internal/naver/reconcile-jobs', env.APP_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  }))
  if (!response.ok) return { ok: false, reason: 'failed' }

  const data = await response.json().catch(() => null)
  return {
    ok: true,
    data,
  }
}

export async function runAutonomousPlannerSchedule(env: Env, fetcherOrContext?: unknown) {
  const fetcher = resolveFetcher(fetcherOrContext)
  if (typeof env.CRON_SECRET !== 'string' || env.CRON_SECRET.length < 20 || typeof env.APP_URL !== 'string') {
    return { ok: false, reason: 'unavailable' }
  }

  const response = await fetcher(new Request(new URL('/api/internal/autonomous-planner/run', env.APP_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  }))
  if (!response.ok) return { ok: false, reason: 'failed' }

  const data = await response.json().catch(() => null)
  return {
    ok: true,
    data,
  }
}

export async function runBookingRecoverySchedule(env: Env, fetcherOrContext?: unknown) {
  const fetcher = resolveFetcher(fetcherOrContext)
  if (typeof env.CRON_SECRET !== 'string' || env.CRON_SECRET.length < 20 || typeof env.APP_URL !== 'string') {
    return { ok: false, reason: 'unavailable' }
  }

  const response = await fetcher(new Request(new URL('/api/internal/booking-recovery/run', env.APP_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  }))
  if (!response.ok) return { ok: false, reason: 'failed' }

  const data = await response.json().catch(() => null)
  return {
    ok: true,
    data,
  }
}

export async function runChannelLearningSchedule(env: Env, fetcherOrContext?: unknown) {
  const fetcher = resolveFetcher(fetcherOrContext)
  if (typeof env.CRON_SECRET !== 'string' || env.CRON_SECRET.length < 20 || typeof env.APP_URL !== 'string') {
    return { ok: false, reason: 'unavailable' }
  }

  const response = await fetcher(new Request(new URL('/api/internal/channel-learning/sweep', env.APP_URL), {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  }))
  if (!response.ok) return { ok: false, reason: 'failed' }

  const data = await response.json().catch(() => null)
  return {
    ok: true,
    data,
  }
}

export async function runNotificationOutboxSchedule(env: Env) {
  try {
    const result = await runServerNotificationOutbox({
      env: env as Record<string, string | undefined>,
    })
    console.info('Notification outbox schedule completed', {
      counts: result.counts,
    })
    return {
      ok: true,
      enabled: result.enabled,
      counts: result.counts,
      result,
    }
  } catch {
    console.error('Notification outbox schedule failed; next run will retry')
    return { ok: false, reason: 'failed' }
  }
}

export async function runScheduledTasks(
  controller: { cron?: string } | undefined,
  env: Env,
  fetcherOrContext?: unknown
) {
  if (controller?.cron === '*/15 * * * *') {
    const engagement = await runEngagementSchedule(env, fetcherOrContext)
    const naverReconcile = await runNaverPostReconcileSchedule(env, fetcherOrContext)
    const autonomousPlanner = await runAutonomousPlannerSchedule(env, fetcherOrContext)
    const bookingRecovery = await runBookingRecoverySchedule(env, fetcherOrContext)
    const automationReport = await runReportOnlyDueSchedule(env, fetcherOrContext)
    let outbox: unknown = null
    try {
      outbox = await runNotificationOutboxSchedule(env)
    } catch {
      console.error('Notification outbox schedule unhandled failure')
      outbox = { ok: false, reason: 'failed' }
    }
    let channelLearning: unknown = null
    try {
      channelLearning = await runChannelLearningSchedule(env, fetcherOrContext)
    } catch {
      console.error('Channel learning schedule failed; next run will retry')
      channelLearning = { ok: false, reason: 'failed' }
    }
    return { engagement, naverReconcile, autonomousPlanner, bookingRecovery, automationReport, outbox, channelLearning }
  }
  const reportResult = await runReportOnlySchedule(env, fetcherOrContext)
  try {
    await runEngagementPurgeSchedule(env, fetcherOrContext)
  } catch (error) {
    console.error('Engagement retention purge schedule failed; next run will retry', error)
  }
  try {
    await runChannelLearningSchedule(env, fetcherOrContext)
  } catch (error) {
    console.error('Channel learning schedule sweep failed; next run will retry', error)
  }
  return reportResult
}
