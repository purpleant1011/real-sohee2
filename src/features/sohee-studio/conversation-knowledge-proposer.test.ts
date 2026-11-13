import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
const save = vi.hoisted(() => vi.fn())
vi.mock('./repository', () => ({ saveProposal: save }))
import { createConversationKnowledgeProposer } from './conversation-knowledge-proposer'
const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '30000000-0000-4000-8000-000000000001'
const threadId = '40000000-0000-4000-8000-000000000001'
const userMessageId = '50000000-0000-4000-8000-000000000001'
const jobId = '60000000-0000-4000-8000-000000000001'
const proposalId = '70000000-0000-4000-8000-000000000001'
const request = { subject: '휴무 안내', factContent: '매주 월요일 휴무로 기억해줘', memoryClass: 'semantic' as const }
const source = { id: userMessageId, workspace_id: workspaceId, thread_id: threadId, role: 'user', status: 'completed', created_by_user_id: userId }
function database(row: unknown = source) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq']) chain[method] = () => chain
  chain.maybeSingle = async () => ({ data: row, error: null })
  return { from: () => chain } as unknown as ServerSupabaseClient
}
const receipt = { id: proposalId, workspaceId, sourceMessageId: userMessageId, category: request.subject, proposedContent: request.factContent, status: 'proposed', kind: 'fact', createdAt: '2026-10-30T00:00:00Z' }
beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue(receipt) })
describe('대화 지식 후보 영속 저장', () => {
  it('같은 원문과 작업에서 네이티브 검토 후보를 멱등키로 저장하고 자동 확정하지 않는다', async () => {
    const proposer = createConversationKnowledgeProposer({ client: database(), workspaceId, userId, threadId, userMessageId, jobId, authorize: async () => 'owner' })
    const result = await proposer(request)
    expect(result).toMatchObject({ success: true, status: 'COMPLETED', data: { kind: 'knowledge_proposal', workspaceId, proposalId, sourceMessageId: userMessageId, status: 'proposed', requiresUserApproval: true } })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, sourceMessageId: userMessageId, userId, kind: 'fact', category: request.subject, content: request.factContent, idempotencyKey: expect.stringContaining(jobId) }), expect.anything())
    const key = save.mock.calls[0][0].idempotencyKey
    await proposer(request)
    expect(save.mock.calls[1][0].idempotencyKey).toBe(key)
  })
  it('다른 가게 원문과 조회 중 권한 상실은 쓰기 전에 차단한다', async () => {
    for (const client of [database({ ...source, workspace_id: '21000000-0000-4000-8000-000000000001' }), database()]) {
      const authorize = vi.fn().mockResolvedValueOnce('owner').mockResolvedValue(null)
      const result = await createConversationKnowledgeProposer({ client, workspaceId, userId, threadId, userMessageId, jobId, authorize })(request)
      expect(result.success).toBe(false)
    }
    expect(save).not.toHaveBeenCalled()
  })
  it('리뷰어·민감정보·모델 범위 인자는 후보 저장을 허용하지 않는다', async () => {
    const proposer = createConversationKnowledgeProposer({ client: database(), workspaceId, userId, threadId, userMessageId, jobId, authorize: async () => null })
    expect((await proposer(request)).success).toBe(false)
    const owner = createConversationKnowledgeProposer({ client: database(), workspaceId, userId, threadId, userMessageId, jobId, authorize: async () => 'owner' })
    expect((await owner({ ...request, factContent: 'Bearer private-access-token' })).success).toBe(false)
    expect((await owner({ ...request, workspaceId: 'foreign' } as typeof request)).success).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })
  it('쓰기 이후 오류나 다른 원문 영수증은 성공이나 자동 재시도 가능으로 바꾸지 않는다', async () => {
    for (const result of [new Error('private sql detail'), { ...receipt, sourceMessageId: jobId }]) {
      save.mockImplementationOnce(async () => { if (result instanceof Error) throw result; return result })
      const value = await createConversationKnowledgeProposer({ client: database(), workspaceId, userId, threadId, userMessageId, jobId, authorize: async () => 'manager' })(request)
      expect(value.status).toBe('RESULT_UNKNOWN')
      expect(JSON.stringify(value)).not.toContain('private sql detail')
    }
  })
})
