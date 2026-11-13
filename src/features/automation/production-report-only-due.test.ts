import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { runDueAutomations } from './due-runner'
import {
  createProductionReportOnlyDueDependencies,
  createProductionReportOnlyRuntime,
  createAdminAutomationGateway,
  createAdminCreditGateway,
} from './production-report-only-due'
import type { V08AutomationRuleInput } from './v08-rule-schema'

const now = '2026-08-19T00:00:00.000Z'
const run = Object.freeze({
  runId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  ruleId: '30000000-0000-4000-8000-000000000001',
  scheduledFor: '2026-08-19T00:00:00.000Z',
})
const secondRun = Object.freeze({ ...run, runId: '10000000-0000-4000-8000-000000000002', ruleId: '30000000-0000-4000-8000-000000000002' })

const rule: V08AutomationRuleInput = {
  kind: 'daily_performance_report' as const,
  active: true,
  approvalRequired: true as const,
  timezone: 'Asia/Seoul',
  localTimes: ['09:00'],
  quietHours: { start: '22:00', end: '07:00' },
  perRunCreditCap: 1,
  dailyCreditCap: 2,
  weeklyCreditCap: 7,
  channels: ['instagram', 'threads'],
}

function ports(order: string[]) {
  return {
    admin: {
      claimDue: vi.fn(async () => { order.push('claim'); return [run] }),
      recheckRule: vi.fn(async () => ({ active: true, rule })),
      readStoredMetrics: vi.fn(async () => {
        order.push('metrics')
        return [
          { channel: 'instagram' as const, metric: 'views' as const, state: 'available' as const, value: 0 },
          { channel: 'threads' as const, metric: 'views' as const, state: 'not_connected' as const, value: null },
        ]
      }),
      persistReport: vi.fn(async () => { order.push('persist'); return '40000000-0000-4000-8000-000000000001' }),
      complete: vi.fn(async () => { order.push('complete') }),
      notificationRecipients: vi.fn(async () => ['50000000-0000-4000-8000-000000000001']),
      upsertNotification: vi.fn(async () => { order.push('notify') }),
      scheduleNext: vi.fn(async () => { order.push('next') }),
    },
    credits: {
      previewAutomationBudget: vi.fn(async () => ({ allowed: true, reason: null })),
      reserveAutomationCredit: vi.fn(async () => ({ reservationId: '60000000-0000-4000-8000-000000000001' })),
      settleAutomationCredit: vi.fn(async () => { order.push('settle') }),
      releaseAutomationCredit: vi.fn(async () => { order.push('release') }),
    },
  }
}

describe('production report-only due wiring', () => {
  it('uses the server-only automation budget preview and fails closed when it is unavailable', async () => {
    const cappedRpc = vi.fn(async () => ({ data: { allowed: false, reason: 'weekly_cap' }, error: null }))
    const capped = createAdminCreditGateway({ rpc: cappedRpc })
    await expect(capped.previewAutomationBudget({ workspaceId: run.workspaceId, ruleId: run.ruleId, scheduledFor: run.scheduledFor }))
      .resolves.toEqual({ allowed: false, reason: 'weekly_cap' })
    expect(cappedRpc).toHaveBeenCalledWith('preview_v08_automation_budget', {
      p_workspace_id: run.workspaceId, p_rule_id: run.ruleId, p_scheduled_for: run.scheduledFor,
    })

    const unavailable = createAdminCreditGateway({ rpc: vi.fn(async () => ({ data: null, error: { code: 'permission_denied' } })) })
    await expect(unavailable.previewAutomationBudget({ workspaceId: run.workspaceId, ruleId: run.ruleId, scheduledFor: run.scheduledFor }))
      .resolves.toEqual({ allowed: false, reason: 'balance' })
  })

  it('claims a bounded sequence of due rows and stops before duplicate or malformed rows', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ run_id: run.runId, workspace_id: run.workspaceId, rule_id: run.ruleId, scheduled_for: run.scheduledFor }], error: null })
      .mockResolvedValueOnce({ data: [{ run_id: secondRun.runId, workspace_id: secondRun.workspaceId, rule_id: secondRun.ruleId, scheduled_for: secondRun.scheduledFor }], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    const admin = createAdminAutomationGateway({ rpc, from: vi.fn() } as never)

    await expect(admin.claimDue(new Date(now), '70000000-0000-4000-8000-000000000001')).resolves.toEqual([run, secondRun])
    expect(rpc).toHaveBeenCalledTimes(3)
  })

  it('caps claims at 25 and does not admit a duplicate or malformed claim row', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      run_id: `10000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      workspace_id: run.workspaceId,
      rule_id: `30000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      scheduled_for: run.scheduledFor,
    }))
    const cappedRpc = vi.fn(async () => ({ data: [rows[Math.min(cappedRpc.mock.calls.length - 1, 24)]], error: null }))
    const cappedAdmin = createAdminAutomationGateway({ rpc: cappedRpc, from: vi.fn() } as never)
    await expect(cappedAdmin.claimDue(new Date(now), '70000000-0000-4000-8000-000000000001')).resolves.toHaveLength(25)
    expect(cappedRpc).toHaveBeenCalledTimes(25)

    const guardedRpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ run_id: run.runId, workspace_id: run.workspaceId, rule_id: run.ruleId, scheduled_for: run.scheduledFor }], error: null })
      .mockResolvedValueOnce({ data: [{ run_id: run.runId, workspace_id: run.workspaceId, rule_id: run.ruleId, scheduled_for: run.scheduledFor }], error: null })
    const guardedAdmin = createAdminAutomationGateway({ rpc: guardedRpc, from: vi.fn() } as never)
    await expect(guardedAdmin.claimDue(new Date(now), '70000000-0000-4000-8000-000000000001')).resolves.toEqual([run])
    expect(guardedRpc).toHaveBeenCalledTimes(2)

    const malformedRpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ run_id: run.runId, workspace_id: run.workspaceId, rule_id: run.ruleId, scheduled_for: run.scheduledFor }], error: null })
      .mockResolvedValueOnce({ data: [{ run_id: 'not-a-uuid', workspace_id: run.workspaceId, rule_id: run.ruleId, scheduled_for: run.scheduledFor }], error: null })
    const malformedAdmin = createAdminAutomationGateway({ rpc: malformedRpc, from: vi.fn() } as never)
    await expect(malformedAdmin.claimDue(new Date(now), '70000000-0000-4000-8000-000000000001')).resolves.toEqual([run])
    expect(malformedRpc).toHaveBeenCalledTimes(2)
  })

  it('retains owner recipients when an active reviewer is present', async () => {
    const result = { data: [
      { user_id: '50000000-0000-4000-8000-000000000001', role: 'owner', status: 'active' },
      { user_id: '50000000-0000-4000-8000-000000000002', role: 'reviewer', status: 'active' },
    ], error: null }
    const query: Readonly<{
      then(resolve: (value: typeof result) => unknown): Promise<unknown>
      select(): typeof query
      eq(): typeof query
    }> = Object.freeze({
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      select: () => query,
      eq: () => query,
    })
    const admin = createAdminAutomationGateway({ rpc: vi.fn(), from: vi.fn(() => query) } as never)

    await expect(admin.notificationRecipients(run.workspaceId)).resolves.toEqual(['50000000-0000-4000-8000-000000000001'])
  })

  it('keeps the route runtime closed when enabled without an admin gateway', () => {
    const previous = process.env.SOHEE_REPORT_ONLY_DUE_ENABLED
    process.env.SOHEE_REPORT_ONLY_DUE_ENABLED = '1'
    try {
      const runtime = createProductionReportOnlyRuntime({ enabled: true, serviceRoleKey: undefined })
      expect(runtime).toEqual({ enabled: false, dependencies: undefined })
    } finally {
      if (previous === undefined) delete process.env.SOHEE_REPORT_ONLY_DUE_ENABLED
      else process.env.SOHEE_REPORT_ONLY_DUE_ENABLED = previous
    }
  })

  it('uses stored metrics only, preserves an actual zero, and separates unknowns in the deterministic report', async () => {
    const order: string[] = []
    const dependencies = createProductionReportOnlyDueDependencies(ports(order))

    const observations = await dependencies.performance.collect(run)
    const report = await dependencies.reports.generate({
      run,
      performance: { channels: {
        instagram: { metrics: { views: { state: 'available', value: 0 } } },
        threads: { metrics: { views: { state: 'not_connected', value: null } } },
        naver_blog: { metrics: {} }, naver_place: { metrics: {} }, daangn_business: { metrics: {} },
      } },
    })

    expect(observations).toEqual([
      { channel: 'instagram', metric: 'views', state: 'available', value: 0 },
      { channel: 'threads', metric: 'views', state: 'not_connected', value: null },
    ])
    expect(report.observations).toContain('instagram views: 0')
    expect(report.unknowns).toContain('threads views: not_connected')
    expect(report.interpretations).toEqual([])
    expect(report.proposal).toContain('검토')
    expect(report.requiredDecision).toContain('승인')
  })

  it('runs concrete safe ports through notification and computes the next rule schedule', async () => {
    const order: string[] = []
    const testPorts = ports(order)
    const dependencies = createProductionReportOnlyDueDependencies(testPorts)

    const result = await runDueAutomations(new Date('2026-08-19T00:00:00.000Z'), '70000000-0000-4000-8000-000000000001', dependencies)

    expect(result.runs).toEqual([{ runId: run.runId, status: 'succeeded', safeErrorCode: null }])
    expect(order).toEqual(['claim', 'metrics', 'persist', 'settle', 'next', 'complete', 'notify'])
    expect(testPorts.admin.scheduleNext).toHaveBeenCalledWith(run, {
      kind: 'next_scheduled',
      at: '2026-08-20T00:00:00.000Z',
    })
  })
})
