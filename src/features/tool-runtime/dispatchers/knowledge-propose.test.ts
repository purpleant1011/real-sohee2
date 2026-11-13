import { describe, expect, it, vi } from 'vitest'
import { soheeDispatcher } from './sohee-dispatcher'
const scope = { workspaceId: 'workspace', correlationId: 'job' }
describe('native knowledge candidate dispatcher', () => {
  it('blocks the former synthetic proposal when no server-owned writer is injected', async () => {
    const result = await soheeDispatcher.execute({ _toolName: 'knowledge.propose', subject: '휴무', factContent: '월요일 휴무' }, scope)
    expect(result.success).toBe(false)
    expect(result.proposal).toBeUndefined()
  })
  it('passes only validated knowledge fields to the server-owned writer', async () => {
    const proposeKnowledge = vi.fn().mockResolvedValue({ success: true, toolId: 'knowledge.propose', status: 'COMPLETED', data: { proposalId: 'stored' } })
    const result = await soheeDispatcher.execute({ _toolName: 'knowledge.propose', subject: '휴무', factContent: '월요일 휴무' }, { ...scope, proposeKnowledge })
    expect(result.data?.proposalId).toBe('stored')
    expect(proposeKnowledge).toHaveBeenCalledExactlyOnceWith({ subject: '휴무', factContent: '월요일 휴무' })
    expect((await soheeDispatcher.execute({ _toolName: 'knowledge.propose', subject: '휴무', factContent: '월요일 휴무', workspaceId: 'foreign' }, { ...scope, proposeKnowledge })).success).toBe(false)
    expect(proposeKnowledge).toHaveBeenCalledTimes(1)
  })
})
