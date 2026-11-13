import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
const load = vi.hoisted(() => vi.fn())
vi.mock('@/features/automation/conversation-automation-reader', () => ({ loadConversationAutomationRules: load }))
import { soheeDispatcher } from './sohee-dispatcher'
const scope = { workspaceId: '20000000-0000-4000-8000-000000000001', correlationId: 'job', readClient: {} as ServerSupabaseClient }
beforeEach(() => vi.clearAllMocks())
describe('automation.list native source dispatch', () => {
  it('uses only the server-injected scope and returns actual configuration observations', async () => {
    load.mockResolvedValue({ workspaceId: scope.workspaceId, rules: [{ id: 'rule', active: false }], partial: false, notice: '현재 설정' })
    const result = await soheeDispatcher.execute({ _toolName: 'automation.list', workspaceId: 'foreign' }, scope)
    expect(result.status).toBe('COMPLETED')
    expect(result.data?.rules).toEqual([{ id: 'rule', active: false }])
    expect(load).toHaveBeenCalledWith({ client: scope.readClient, workspaceId: scope.workspaceId })
  })
  it('does not fall back to ambient admin credentials without a prepared read client', async () => {
    const result = await soheeDispatcher.execute({ _toolName: 'automation.list' }, { ...scope, readClient: undefined })
    expect(result.success).toBe(false)
    expect(load).not.toHaveBeenCalled()
  })
  it('fails closed for unavailable or foreign results without returning raw details', async () => {
    for (const value of [new Error('private sql detail'), { workspaceId: 'foreign', rules: [] }]) {
      load.mockImplementationOnce(async () => { if (value instanceof Error) throw value; return value })
      const result = await soheeDispatcher.execute({ _toolName: 'automation.list' }, scope)
      expect(result.success).toBe(false)
      expect(JSON.stringify(result)).not.toMatch(/private sql detail|foreign/)
    }
  })
})
