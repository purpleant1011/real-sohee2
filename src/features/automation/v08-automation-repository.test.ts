import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { createV08AutomationRepository, type V08AutomationGateway } from './v08-automation-repository'
import type { V08AutomationRuleInput } from './v08-rule-schema'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const ruleId = '20000000-0000-4000-8000-000000000001'
const input: V08AutomationRuleInput = {
  kind: 'daily_performance_report', active: false, approvalRequired: true,
  timezone: 'Asia/Seoul', localTimes: ['09:00'], quietHours: { start: '22:00', end: '07:00' },
  perRunCreditCap: 20, dailyCreditCap: 40, weeklyCreditCap: 200, channels: ['instagram'],
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ruleId, workspace_id: workspaceId, kind: input.kind, active: false, approval_required: true,
    timezone: input.timezone, next_run_at: null, configuration_version: 1,
    configuration: { localTimes: input.localTimes, weekday: null, quietHours: input.quietHours, perRunCreditCap: 20, dailyCreditCap: 40, weeklyCreditCap: 200, channels: input.channels },
    ...overrides,
  }
}

describe('V0.8 automation repository', () => {
  it('lists V0.8 status separately and resumes with the next local cadence', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: ruleId, workspace_id: workspaceId }, error: null })
    const gateway: V08AutomationGateway = {
      list: vi.fn().mockResolvedValue({ data: [row()], error: null }),
      find: vi.fn().mockResolvedValue({ data: row(), error: null }),
      insert: vi.fn(), update,
    }
    const repository = createV08AutomationRepository(gateway, () => new Date('2026-08-19T00:30:00.000Z'))

    await expect(repository.list(workspaceId)).resolves.toEqual({ data: [expect.objectContaining({ id: ruleId, active: false, nextRunAt: null, configurationVersion: 1 })] })
    await expect(repository.save({ workspaceId, ruleId, mode: 'resume', expectedVersion: 1 })).resolves.toBe('resumed')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId, ruleId, expectedVersion: 1, active: true, configurationVersion: 2,
      nextRunAt: '2026-08-20T00:00:00.000Z',
    }))
  })

  it('refuses stale or cross-workspace changes before issuing an update', async () => {
    const update = vi.fn()
    const gateway: V08AutomationGateway = {
      list: vi.fn(), insert: vi.fn(), update,
      find: vi.fn().mockResolvedValue({ data: row({ workspace_id: '10000000-0000-4000-8000-000000000099', configuration_version: 2 }), error: null }),
    }
    const repository = createV08AutomationRepository(gateway)

    await expect(repository.save({ workspaceId, ruleId, mode: 'pause', expectedVersion: 1 })).resolves.toBe('workspace_conflict')
    expect(update).not.toHaveBeenCalled()
  })

  it('preserves the authenticated actor on a new rule insert', async () => {
    const insert = vi.fn().mockResolvedValue({ data: { id: ruleId }, error: null })
    const gateway: V08AutomationGateway = { list: vi.fn(), find: vi.fn(), insert, update: vi.fn() }
    const repository = createV08AutomationRepository(gateway, () => new Date(), '30000000-0000-4000-8000-000000000001')

    await expect(repository.save({ workspaceId, mode: 'save', configuration: input })).resolves.toBe('saved')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: workspaceId,
      created_by: '30000000-0000-4000-8000-000000000001',
      active: false,
      next_run_at: null,
    }))
  })

  it('treats an update with no returned row or a wrong row as a version conflict', async () => {
    for (const updateResult of [
      { data: null, error: null },
      { data: { id: '20000000-0000-4000-8000-000000000099', workspace_id: workspaceId }, error: null },
      { data: { id: ruleId, workspace_id: '10000000-0000-4000-8000-000000000099' }, error: null },
    ]) {
      const gateway: V08AutomationGateway = {
        list: vi.fn(), insert: vi.fn(),
        find: vi.fn().mockResolvedValue({ data: row(), error: null }),
        update: vi.fn().mockResolvedValue(updateResult),
      }
      await expect(createV08AutomationRepository(gateway).save({ workspaceId, ruleId, mode: 'pause', expectedVersion: 1 })).resolves.toBe('version_conflict')
    }
  })

  it('does not report a create as saved without a valid returned rule id', async () => {
    for (const insertResult of [
      { data: null, error: null },
      { data: { id: 'not-a-uuid' }, error: null },
    ]) {
      const gateway: V08AutomationGateway = {
        list: vi.fn(), find: vi.fn(), update: vi.fn(),
        insert: vi.fn().mockResolvedValue(insertResult),
      }
      await expect(createV08AutomationRepository(gateway, () => new Date(), '30000000-0000-4000-8000-000000000001').save({ workspaceId, mode: 'save', configuration: input })).resolves.toBe('workspace_conflict')
    }
  })
})
