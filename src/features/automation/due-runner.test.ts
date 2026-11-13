import { describe, expect, it, vi } from 'vitest'
import { runDueAutomations, type DueAutomationDependencies } from './due-runner'

const now = new Date('2026-08-19T00:00:00.000Z')
const claimed = { runId: '10000000-0000-4000-8000-000000000001', workspaceId: '20000000-0000-4000-8000-000000000001', ruleId: '30000000-0000-4000-8000-000000000001', scheduledFor: now.toISOString() }

function dependencies(overrides: Partial<DueAutomationDependencies> = {}): DueAutomationDependencies {
  return {
    repository: {
      claimDue: vi.fn().mockResolvedValue([claimed]), recheck: vi.fn().mockResolvedValue({ active: true, scheduleValid: true }),
      persistReport: vi.fn().mockResolvedValue('40000000-0000-4000-8000-000000000001'), complete: vi.fn().mockResolvedValue(undefined),
      scheduleNext: vi.fn().mockResolvedValue(undefined), notifyOnce: vi.fn().mockResolvedValue(undefined),
    },
    credits: {
      previewAutomationBudget: vi.fn().mockResolvedValue({ allowed: true, reason: null }), reserveAutomationCredit: vi.fn().mockResolvedValue({ reservationId: 'r1' }),
      settleAutomationCredit: vi.fn().mockResolvedValue(undefined), releaseAutomationCredit: vi.fn().mockResolvedValue(undefined),
    },
    performance: { collect: vi.fn().mockResolvedValue([{ channel: 'instagram', metric: 'views', state: 'available', value: 1 }]) },
    reports: { generate: vi.fn().mockResolvedValue({ observations: ['조회 1건'], interpretations: [], unknowns: [], proposal: '다음 주에도 확인', requiredDecision: '계속 여부' }) },
    ...overrides,
  }
}

describe('runDueAutomations', () => {
  it('skips and notifies when the weekly cap is exhausted', async () => {
    const deps = dependencies()
    vi.mocked(deps.credits.previewAutomationBudget).mockResolvedValue({ allowed: false, reason: 'weekly_cap' })
    const result = await runDueAutomations(now, '50000000-0000-4000-8000-000000000001', deps)
    expect(result.runs[0]).toMatchObject({ status: 'skipped_credit_cap', safeErrorCode: 'weekly_cap' })
    expect(deps.performance.collect).not.toHaveBeenCalled()
    expect(deps.repository.notifyOnce).toHaveBeenCalledTimes(1)
  })

  it('releases unused credit and schedules a bounded retry when collection fails', async () => {
    const deps = dependencies()
    vi.mocked(deps.performance.collect).mockRejectedValue(new Error('provider unavailable'))
    const result = await runDueAutomations(now, '50000000-0000-4000-8000-000000000001', deps)
    expect(result.runs[0]).toMatchObject({ status: 'failed', safeErrorCode: 'collection_failed' })
    expect(deps.credits.releaseAutomationCredit).toHaveBeenCalledWith({ reservationId: 'r1', reason: 'collection_failed' })
    expect(deps.repository.scheduleNext).toHaveBeenCalledWith(claimed, {
      kind: 'retry', at: '2026-08-19T00:15:00.000Z',
    })
  })

  it('runs claim through notification in order without publishing content', async () => {
    const deps = dependencies()
    await runDueAutomations(now, '50000000-0000-4000-8000-000000000001', deps)
    expect(deps.repository.persistReport).toHaveBeenCalledTimes(1)
    expect(deps.credits.settleAutomationCredit).toHaveBeenCalledWith({ reservationId: 'r1' })
    expect(deps.repository.notifyOnce).toHaveBeenCalledTimes(1)
  })

  it('releases an unspent reservation and records a retry when report persistence fails', async () => {
    const deps = dependencies()
    vi.mocked(deps.repository.persistReport).mockRejectedValue(new Error('insert unavailable'))

    const result = await runDueAutomations(now, '50000000-0000-4000-8000-000000000001', deps)

    expect(result.runs[0]).toMatchObject({ status: 'failed', safeErrorCode: 'report_persist_failed' })
    expect(deps.credits.releaseAutomationCredit).toHaveBeenCalledWith({ reservationId: 'r1', reason: 'report_failed' })
    expect(deps.repository.complete).toHaveBeenCalledWith(claimed, expect.objectContaining({ status: 'failed', safeErrorCode: 'report_persist_failed' }))
    expect(deps.repository.scheduleNext).toHaveBeenCalledWith(claimed, { kind: 'retry', at: '2026-08-19T00:15:00.000Z' })
  })

  it('releases only when credit settlement throws before reporting settlement', async () => {
    const deps = dependencies()
    vi.mocked(deps.credits.settleAutomationCredit).mockRejectedValue(new Error('settle unavailable'))

    const result = await runDueAutomations(now, '50000000-0000-4000-8000-000000000001', deps)

    expect(result.runs[0]).toMatchObject({ status: 'failed', safeErrorCode: 'credit_settle_failed' })
    expect(deps.credits.releaseAutomationCredit).toHaveBeenCalledWith({ reservationId: 'r1', reason: 'credit_settle_failed' })
  })

  it('keeps a persisted settled report successful when notification delivery fails', async () => {
    const deps = dependencies()
    vi.mocked(deps.repository.notifyOnce).mockRejectedValue(new Error('notification unavailable'))

    const result = await runDueAutomations(now, '50000000-0000-4000-8000-000000000001', deps)

    expect(result.runs[0]).toMatchObject({ status: 'succeeded', safeErrorCode: null })
    expect(deps.repository.persistReport).toHaveBeenCalledTimes(1)
    expect(deps.credits.releaseAutomationCredit).not.toHaveBeenCalled()
    expect(deps.repository.complete).toHaveBeenCalledWith(claimed, expect.objectContaining({ status: 'succeeded' }))
  })

  it('keeps settled credit and records a recoverable retry when next scheduling fails', async () => {
    const deps = dependencies()
    vi.mocked(deps.repository.scheduleNext).mockRejectedValueOnce(new Error('schedule unavailable'))

    const result = await runDueAutomations(now, '50000000-0000-4000-8000-000000000001', deps)

    expect(result.runs[0]).toMatchObject({ status: 'failed', safeErrorCode: 'next_schedule_failed' })
    expect(deps.credits.releaseAutomationCredit).not.toHaveBeenCalled()
    expect(deps.repository.complete).toHaveBeenCalledWith(claimed, expect.objectContaining({ status: 'failed', safeErrorCode: 'next_schedule_failed' }))
    expect(deps.repository.scheduleNext).toHaveBeenLastCalledWith(claimed, { kind: 'retry', at: '2026-08-19T00:15:00.000Z' })
  })

  it('continues failure completion and retry when releasing an unspent reservation fails', async () => {
    const deps = dependencies()
    vi.mocked(deps.performance.collect).mockRejectedValue(new Error('collection unavailable'))
    vi.mocked(deps.credits.releaseAutomationCredit).mockRejectedValue(new Error('release unavailable'))

    const result = await runDueAutomations(now, '50000000-0000-4000-8000-000000000001', deps)

    expect(result.runs[0]).toMatchObject({ status: 'failed', safeErrorCode: 'collection_failed' })
    expect(deps.repository.complete).toHaveBeenCalledWith(claimed, expect.objectContaining({ status: 'failed', safeErrorCode: 'collection_failed' }))
    expect(deps.repository.scheduleNext).toHaveBeenCalledWith(claimed, { kind: 'retry', at: '2026-08-19T00:15:00.000Z' })
  })
})
