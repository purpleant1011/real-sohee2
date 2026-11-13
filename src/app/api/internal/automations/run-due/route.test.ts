import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/features/automation/report-only-due-runtime', () => ({ runReportOnlyDueAutomations: mocks.run }))
vi.mock('@/features/automation/production-report-only-due', () => ({ createProductionReportOnlyRuntime: () => ({ enabled: true }) }))

import { POST } from './route'

describe('report-only automation due route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret-with-enough-entropy'
    process.env.SOHEE_REPORT_ONLY_DUE_ENABLED = '1'
    mocks.run.mockResolvedValue({ runs: [
      { runId: '10000000-0000-4000-8000-000000000001', status: 'succeeded', safeErrorCode: null },
      { runId: '10000000-0000-4000-8000-000000000002', status: 'skipped_credit_cap', safeErrorCode: 'weekly_cap' },
      { runId: '10000000-0000-4000-8000-000000000003', status: 'failed', safeErrorCode: 'collection_failed' },
    ] })
  })

  it('rejects an unauthenticated internal due request without revealing cron state', async () => {
    const response = await POST(new Request('https://example.com/api/internal/automations/run-due', { method: 'POST' }))
    expect(response.status).toBe(404)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('returns only safe aggregate counts for report-only due runs', async () => {
    const response = await POST(new Request('https://example.com/api/internal/automations/run-due', {
      method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ claimed: 3, completed: 1, skipped: 1, failed: 1 })
    expect(mocks.run).toHaveBeenCalledOnce()
  })

  it('returns a safe failure without report content when the runner is unavailable', async () => {
    mocks.run.mockRejectedValueOnce(new Error('sensitive provider details'))
    const response = await POST(new Request('https://example.com/api/internal/automations/run-due', {
      method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'automation_unavailable' })
  })
})
