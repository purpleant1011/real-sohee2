import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { saveV08AutomationAction } from './save-v08-automation'
const id='10000000-0000-4000-8000-000000000001'
describe('V0.8 automation action',()=>{it('returns a safe workspace conflict code',async()=>{const repo={save:vi.fn().mockResolvedValue('workspace_conflict')}; await expect(saveV08AutomationAction({workspaceId:id,ruleId:id,mode:'pause',expectedVersion:1},{workspace:async()=>({workspaceId:id,role:'owner'}),repository:repo})).resolves.toEqual({data:{status:'workspace_conflict'}}); expect(repo.save).toHaveBeenCalledOnce()})})

it('persists a V0.8 report setup as inactive and approval-required through the concrete save boundary', async () => {
  const repo = { save: vi.fn().mockResolvedValue('saved') }
  const configuration = {
    kind: 'twice_daily_performance_report', active: false, approvalRequired: true,
    timezone: 'Asia/Seoul', localTimes: ['09:00', '18:00'], quietHours: { start: '22:00', end: '07:00' },
    perRunCreditCap: 20, dailyCreditCap: 40, weeklyCreditCap: 200,
    channels: ['instagram', 'naver_blog'],
  }

  await expect(saveV08AutomationAction({ workspaceId: id, mode: 'save', configuration }, { workspace: async () => ({ workspaceId: id, role: 'manager' }), repository: repo })).resolves.toEqual({ data: { status: 'saved' } })
  expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: id, configuration }))
})

it('denies reviewer and foreign workspace requests without calling the admin repository', async () => {
  const repository = { save: vi.fn() }
  await expect(saveV08AutomationAction({ workspaceId: id, mode: 'save', configuration: { kind: 'daily_performance_report', active: false, approvalRequired: true, timezone: 'Asia/Seoul', localTimes: ['09:00'], quietHours: { start: '22:00', end: '07:00' }, perRunCreditCap: 20, dailyCreditCap: 40, weeklyCreditCap: 200, channels: ['instagram'] } }, { workspace: async () => ({ workspaceId: id, role: 'reviewer' }), repository })).resolves.toEqual({ data: { status: 'forbidden' } })
  await expect(saveV08AutomationAction({ workspaceId: id, ruleId: id, mode: 'pause', expectedVersion: 1 }, { workspace: async () => ({ workspaceId: '10000000-0000-4000-8000-000000000099', role: 'owner' }), repository })).resolves.toEqual({ data: { status: 'forbidden' } })
  expect(repository.save).not.toHaveBeenCalled()
})
