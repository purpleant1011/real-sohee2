import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/features/linear-archive/sweep', () => ({ runProductionLinearDoneSweep: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
import { runProductionLinearDoneSweep } from '@/features/linear-archive/sweep'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import * as outboxServerRuntime from '@/features/kakao/notify/outbox-server-runtime'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
import {
  runNotificationOutboxSchedule,
  runReportOnlySchedule,
  runEngagementPurgeSchedule,
  runNaverPostReconcileSchedule,
  runChannelLearningSchedule,
  runScheduledTasks,
} from './cloudflare-scheduled'

it('runs due report routines on the 15-minute production path without moving retention or Linear cleanup', async () => {
  vi.setSystemTime(new Date('2026-10-30T00:15:00Z'))
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ claimed: 1, completed: 1 }), { status: 200 })))
  vi.stubGlobal('fetch', fetcher)
  vi.mocked(runProductionLinearDoneSweep).mockClear()
  await runScheduledTasks({ cron: '*/15 * * * *' }, { APP_URL: 'https://example.com', CRON_SECRET: 'x'.repeat(20), SOHEE_REPORT_ONLY_DUE_ENABLED: '1' }, {})
  const urls = fetcher.mock.calls.map(call => (call[0] as Request).url)
  expect(urls).toContain('https://example.com/api/internal/automations/run-due')
  expect(urls).not.toContain('https://example.com/api/internal/engagement/purge')
  expect(runProductionLinearDoneSweep).not.toHaveBeenCalled()
})

it('fails closed with zero report calls unless report-only flag and secret name are present', async () => {
  const fetch = vi.fn()
  await expect(runReportOnlySchedule({ APP_URL: 'https://example.com', SOHEE_REPORT_ONLY_DUE_ENABLED: '0' }, fetch)).resolves.toEqual({ claimed: 0, reason: 'disabled' })
  expect(fetch).not.toHaveBeenCalled()
})

it('calls only the report-only due route with bearer secret when a fetcher is injected', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ claimed: 0, completed: 0 }), { status: 200 }))
  await expect(runReportOnlySchedule({ APP_URL: 'https://example.com', CRON_SECRET: 'x'.repeat(20), SOHEE_REPORT_ONLY_DUE_ENABLED: '1' }, fetch)).resolves.toEqual({ claimed: 0, completed: 0 })
  expect(fetch.mock.calls[0][0].url).toContain('/api/internal/automations/run-due')
  expect(fetch.mock.calls[0][0].url).not.toContain('publishing')
})

it('fails closed when runNaverPostReconcileSchedule missing valid env credentials', async () => {
  const fetch = vi.fn()
  await expect(runNaverPostReconcileSchedule({ APP_URL: 'https://example.com' }, fetch)).resolves.toEqual({ ok: false, reason: 'unavailable' })
  expect(fetch).not.toHaveBeenCalled()
})

it('calls naver reconcile route on 15-minute cron with bearer secret', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ examined: 0 }), { status: 200 }))
  const res = await runScheduledTasks({ cron: '*/15 * * * *' }, { APP_URL: 'https://example.com', CRON_SECRET: 'x'.repeat(20) }, fetch)
  expect(res).toBeDefined()
  expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/api/internal/naver/reconcile-jobs' }))
})

it('fails closed for runEngagementPurgeSchedule when CRON_SECRET or APP_URL is missing', async () => {
  const fetch = vi.fn()
  await expect(runEngagementPurgeSchedule({ APP_URL: 'https://example.com', CRON_SECRET: 'too-short' }, fetch)).resolves.toEqual({ ok: false, reason: 'unavailable' })
  expect(fetch).not.toHaveBeenCalled()
})

it('calls engagement purge route with bearer secret and returns parsed aggregate counts', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    ok: true,
    threads: 3,
    messages: 5,
    drafts: 2,
    hasMore: false,
    comments: 4,
    commentDrafts: 1,
    commentsHasMore: false,
  }), { status: 200 }))
  await expect(runEngagementPurgeSchedule({ APP_URL: 'https://example.com', CRON_SECRET: 'x'.repeat(20) }, fetch)).resolves.toEqual({
    ok: true,
    threads: 3,
    messages: 5,
    drafts: 2,
    hasMore: false,
    comments: 4,
    commentDrafts: 1,
    commentsHasMore: false,
  })
  expect(fetch.mock.calls[0][0].url).toContain('/api/internal/engagement/purge')
  expect(fetch.mock.calls[0][0].headers.get('authorization')).toBe(`Bearer ${'x'.repeat(20)}`)
})

it('invokes purge schedule during 6-hour cron sweep without disrupting report schedule result', async () => {
  const fetch = vi.fn().mockImplementation((req: Request) => {
    if (req.url.includes('/api/internal/automations/run-due')) {
      return Promise.resolve(new Response(JSON.stringify({ claimed: 1, completed: 1 }), { status: 200 }))
    }
    if (req.url.includes('/api/internal/engagement/purge')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, threads: 2, messages: 4, drafts: 1, hasMore: false }), { status: 200 }))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })

  const result = await runScheduledTasks(
    { cron: '0 */6 * * *' },
    { APP_URL: 'https://example.com', CRON_SECRET: 'x'.repeat(20), SOHEE_REPORT_ONLY_DUE_ENABLED: '1' },
    fetch
  )

  expect(result).toEqual({ claimed: 1, completed: 1 })
  const urls = fetch.mock.calls.map((c) => c[0].url)
  expect(urls.some((u) => u.includes('/api/internal/automations/run-due'))).toBe(true)
  expect(urls.some((u) => u.includes('/api/internal/engagement/purge'))).toBe(true)
})

it('makes zero admin client import and zero DB calls when outbox flags are disabled', async () => {
  vi.mocked(createAdminSupabaseClient).mockClear()
  const result = await runNotificationOutboxSchedule({
    APP_URL: 'https://example.com',
    CRON_SECRET: 'x'.repeat(20),
    KAKAO_OUTBOX_ENABLED: 'false',
    SOLAPI_ENABLED: 'false',
  })
  expect(createAdminSupabaseClient).not.toHaveBeenCalled()
  expect(result.ok).toBe(true)
  expect(result.enabled).toBe(false)
  expect(result.counts?.DISABLED).toBe(0)
})

it('invokes runServerNotificationOutbox on 15-minute cron but returns disabled result when flag is off', async () => {
  const spy = vi.spyOn(outboxServerRuntime, 'runServerNotificationOutbox')
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })))
  const res = await runScheduledTasks(
    { cron: '*/15 * * * *' },
    { APP_URL: 'https://example.com', CRON_SECRET: 'x'.repeat(20) },
    fetch
  ) as { outbox?: { ok: boolean; enabled: boolean; counts: { DISABLED: number } } }

  expect(spy).toHaveBeenCalled()
  expect(res.outbox).toBeDefined()
  expect(res.outbox?.ok).toBe(true)
  expect(res.outbox?.enabled).toBe(false)
  expect(res.outbox?.counts.DISABLED).toBe(0)
  spy.mockRestore()
})

it('continues executing other cron tasks when runServerNotificationOutbox throws, and emits static log without PII', async () => {
  const spy = vi.spyOn(outboxServerRuntime, 'runServerNotificationOutbox').mockRejectedValueOnce(
    new Error('Fatal error: customer phone 010-9876-5432 failed with secret-token-xyz')
  )
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const fetch = vi.fn().mockImplementation((req: Request) => {
    if (req.url.includes('/api/internal/automations/run-due')) {
      return Promise.resolve(new Response(JSON.stringify({ claimed: 3, completed: 3 }), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  })

  const result = await runScheduledTasks(
    { cron: '*/15 * * * *' },
    {
      APP_URL: 'https://example.com',
      CRON_SECRET: 'x'.repeat(20),
      SOHEE_REPORT_ONLY_DUE_ENABLED: '1',
    },
    fetch
  ) as { automationReport?: { claimed: number; completed: number }; outbox?: { ok: boolean } }

  expect(result.automationReport).toEqual({ claimed: 3, completed: 3 })
  expect(result.outbox).toEqual({ ok: false, reason: 'failed' })

  // 정적 로그만 출력되고 PII나 에러 원문은 절대 노출되지 않음을 검증
  const loggedErrors = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n')
  expect(loggedErrors).toContain('Notification outbox schedule failed')
  expect(loggedErrors).not.toContain('010-9876-5432')
  expect(loggedErrors).not.toContain('secret-token-xyz')

  spy.mockRestore()
  consoleErrorSpy.mockRestore()
})

it('does not invoke runServerNotificationOutbox for other cron patterns or undefined cron', async () => {
  const spy = vi.spyOn(outboxServerRuntime, 'runServerNotificationOutbox')
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })))

  await runScheduledTasks(
    { cron: '0 */6 * * *' },
    { APP_URL: 'https://example.com', CRON_SECRET: 'x'.repeat(20), SOHEE_REPORT_ONLY_DUE_ENABLED: '1' },
    fetch
  )
  expect(spy).not.toHaveBeenCalled()

  await runScheduledTasks(
    undefined,
    { APP_URL: 'https://example.com', CRON_SECRET: 'x'.repeat(20), SOHEE_REPORT_ONLY_DUE_ENABLED: '1' },
    fetch
  )
  expect(spy).not.toHaveBeenCalled()

  spy.mockRestore()
})

it('fails closed when runChannelLearningSchedule missing credentials', async () => {
  const fetch = vi.fn()
  await expect(runChannelLearningSchedule({ APP_URL: 'https://example.com' }, fetch)).resolves.toEqual({
    ok: false,
    reason: 'unavailable',
  })
  expect(fetch).not.toHaveBeenCalled()
})

it('calls channel learning sweep route with bearer token on 15-minute cron', async () => {
  const fetch = vi.fn().mockImplementation(() => {
    return Promise.resolve(new Response(JSON.stringify({ ok: true, verifiedEnqueued: 2, deletedEnqueued: 1, purgedCount: 3 }), { status: 200 }))
  })

  const result = await runScheduledTasks(
    { cron: '*/15 * * * *' },
    { APP_URL: 'https://example.com', CRON_SECRET: 'x'.repeat(20) },
    fetch
  ) as any

  expect(result.channelLearning).toBeDefined()
  expect(result.channelLearning.ok).toBe(true)
  expect(fetch).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'https://example.com/api/internal/channel-learning/sweep',
    })
  )
})
