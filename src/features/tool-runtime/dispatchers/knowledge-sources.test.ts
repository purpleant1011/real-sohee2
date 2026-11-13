import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ memories: vi.fn(), facts: vi.fn() }))
vi.mock('@/lib/memory/long-term-memory-service', () => ({ LongTermMemoryService: { retrieveRelevantMemories: mocks.memories } }))
vi.mock('@/features/harness/repository', () => ({ listApprovedKnowledgeFacts: mocks.facts }))
import { soheeDispatcher } from './sohee-dispatcher'
import type { ToolExecutionContext } from '../types'
const scope: ToolExecutionContext = { workspaceId: '20000000-0000-4000-8000-000000000001', correlationId: 'job', readClient: {} as ToolExecutionContext['readClient'] }
beforeEach(() => { vi.resetAllMocks(); mocks.memories.mockResolvedValue([]); mocks.facts.mockResolvedValue([]) })
describe('unified approved knowledge lookup', () => {
  it('finds approved facts even when the separate memory store is empty', async () => {
    mocks.facts.mockResolvedValue([{ id: 'fact', workspaceId: scope.workspaceId, category: '가격', content: '상담 가격은 개별 안내합니다.', status: 'active', validFrom: null, validUntil: null }])
    const result = await soheeDispatcher.execute({ _toolName: 'knowledge.search', query: '가격' }, scope)
    expect(result).toMatchObject({ success: true, data: { totalFound: 1, facts: [{ id: 'fact', content: '상담 가격은 개별 안내합니다.' }] } })
    expect(mocks.facts).toHaveBeenCalledWith({ client: scope.readClient, workspaceId: scope.workspaceId })
  })
  it('does not reuse expired facts or leak another tenant', async () => {
    mocks.facts.mockResolvedValue([{ id: 'expired', workspaceId: scope.workspaceId, category: '가격', content: '지난 가격', status: 'active', validUntil: '2000-01-01T00:00:00Z' }])
    expect((await soheeDispatcher.execute({ _toolName: 'knowledge.search', query: '가격' }, scope)).data?.facts).toEqual([])
    mocks.facts.mockResolvedValue([{ id: 'foreign', workspaceId: 'other', category: '가격', content: '다른 가게 가격', status: 'active' }])
    expect((await soheeDispatcher.execute({ _toolName: 'knowledge.search', query: '가격' }, scope)).success).toBe(false)
  })
  it('fails closed when the fact store cannot be read instead of claiming no knowledge', async () => {
    mocks.facts.mockRejectedValue(new Error('private database detail'))
    const result = await soheeDispatcher.execute({ _toolName: 'knowledge.search', query: '가격' }, scope)
    expect(result.status).toBe('FAILED')
    expect(JSON.stringify(result)).not.toContain('private database detail')
  })
})
