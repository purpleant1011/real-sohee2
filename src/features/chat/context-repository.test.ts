import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
const mocks = vi.hoisted(() => ({ goals: vi.fn(), messages: vi.fn(), profile: vi.fn(), facts: vi.fn() }))
vi.mock('@/features/harness/repository', () => ({ listActiveHarnessRules: async () => [], listApprovedKnowledgeFacts: mocks.facts }))
vi.mock('@/features/sohee-studio/repository', () => ({ listGoals: mocks.goals }))
vi.mock('./repository', () => ({ listConversationMessages: mocks.messages }))
import { loadSoheeContext } from './context-repository'
const ws = '20000000-0000-4000-8000-000000000001'
const threadId = '30000000-0000-4000-8000-000000000001'
const message = { id: '40000000-0000-4000-8000-000000000001', workspaceId: ws, threadId, role: 'sohee',
  content: '확인한 자료예요.', status: 'completed', workItemId: null,
  createdAt: '2026-10-29T10:00:00Z', completedAt: '2026-10-29T10:00:00Z',
  taskTimeline: { id: 'runtime-job', kind: 'task_timeline', title: '자료 확인', totalSteps: 1, completedSteps: 1,
    steps: [{ id: 'read', title: '조회', status: 'completed' }], isLive: false } }
const client = { from: (table: string) => {
  const data = table === 'workspaces' ? { id: ws, name: '가게', timezone: 'Asia/Seoul' } : []
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit']) query[method] = () => query
  query.single = async () => ({ data, error: null })
  query.maybeSingle = async () => mocks.profile(table)
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve)
  return query
} } as unknown as ServerSupabaseClient
beforeEach(() => { vi.clearAllMocks(); mocks.goals.mockResolvedValue([]); mocks.messages.mockResolvedValue([message]); mocks.profile.mockResolvedValue({ data: null, error: null }); mocks.facts.mockResolvedValue([]) })

describe('canonical context repository DTO boundary', () => {
  it('loads the existing business profile and excludes expired knowledge from the same common context', async () => {
    mocks.profile.mockImplementation(async table => ({ data: table === 'business_profiles'
      ? { workspace_id: ws, business_name: '등록된 가게', industry: '뷰티', location: '청라', summary: '프로필에 저장된 소개' } : null, error: null }))
    mocks.facts.mockResolvedValue([{ id: '50000000-0000-4000-8000-000000000001', workspaceId: ws, category: '프로모션', content: '지난 할인', status: 'active', validUntil: '2000-01-01T00:00:00Z' }])
    const context = await loadSoheeContext({ client, workspaceId: ws, threadId, strict: true })
    expect(context.knowledgeJournal?.workspaceId).toBe(ws)
    expect(context.knowledgeJournal?.sources).toHaveLength(7)
    expect(context.businessContext?.business?.summary).toBe('프로필에 저장된 소개')
    expect(context.approvedFacts).toEqual([])
  })
  it('projects conversation UI additions instead of breaking the next turn context', async () => {
    const context = await loadSoheeContext({ client, workspaceId: ws, threadId })
    expect(context.recentMessages).toEqual([expect.objectContaining({ id: message.id, content: message.content })])
    expect(context.recentMessages[0]).not.toHaveProperty('taskTimeline')
  })
  it('does not report a failed active-goal lookup as no goals in strict worker mode', async () => {
    mocks.messages.mockResolvedValue([])
    mocks.goals.mockRejectedValueOnce(new Error('GOAL_LOOKUP_FAILED'))
    await expect(loadSoheeContext({ client, workspaceId: ws, threadId, strict: true })).rejects.toThrow('GOAL_LOOKUP_FAILED')
  })
})
