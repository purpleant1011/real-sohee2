import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { loadConversationAutomationRules } from './conversation-automation-reader'
const workspaceId = '20000000-0000-4000-8000-000000000001'
const rule = { id: '30000000-0000-4000-8000-000000000001', workspace_id: workspaceId,
  kind: 'daily_performance_report', active: true, approval_required: true, timezone: 'Asia/Seoul',
  next_run_at: '2026-10-31T00:00:00Z', configuration_version: 2,
  configuration: { localTimes: ['09:00'], weekday: null, quietHours: { start: '22:00', end: '07:00' }, perRunCreditCap: 20, dailyCreditCap: 40, weeklyCreditCap: 200, channels: ['instagram'] } }
function database(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {}
  const eq = vi.fn(() => chain)
  for (const method of ['select', 'in', 'order', 'limit']) chain[method] = vi.fn(() => chain)
  chain.eq = eq
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve)
  return { client: { from: () => chain } as unknown as ServerSupabaseClient, eq, chain }
}
describe('대화 자동화 정본 읽기', () => {
  it('실제 설정·버전·상한·다음 실행 시각을 변경 없이 반환한다', async () => {
    const db = database([rule])
    const result = await loadConversationAutomationRules({ client: db.client, workspaceId })
    expect(result.rules[0]).toMatchObject({ id: rule.id, configurationVersion: 2, active: true, nextRunAt: rule.next_run_at,
      configuration: { perRunCreditCap: 20, localTimes: ['09:00'], approvalRequired: true } })
    expect(result.partial).toBe(false)
    expect(db.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(db.chain.limit).toHaveBeenCalledWith(26)
    expect(result.notice).toContain('자동 게시')
  })
  it('빈 자료와 접근 실패를 혼동하지 않는다', async () => {
    expect((await loadConversationAutomationRules({ client: database([]).client, workspaceId })).rules).toEqual([])
    await expect(loadConversationAutomationRules({ client: database(null, { code: 'private' }).client, workspaceId })).rejects.toThrow('AUTOMATION_READ_UNAVAILABLE')
  })
  it('다른 가게 설정이나 승인 경계가 잘못된 자료를 전달하지 않는다', async () => {
    for (const value of [{ ...rule, workspace_id: '21000000-0000-4000-8000-000000000001' }, { ...rule, approval_required: false }]) {
      await expect(loadConversationAutomationRules({ client: database([value]).client, workspaceId })).rejects.toThrow('AUTOMATION_READ_UNAVAILABLE')
    }
  })
})
