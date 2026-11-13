import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn(() => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: mocks.maybeSingle,
      }
      return query
    }),
    rpc: mocks.rpc,
  })),
}))

import { reviewKnowledgeAction } from './review-knowledge'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const knowledgeId = '30000000-0000-4000-8000-000000000001'

describe('reviewKnowledgeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({
      data: { user: { id: '10000000-0000-4000-8000-000000000001' } },
      error: null,
    })
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'manager', status: 'active' }, error: null })
    mocks.rpc.mockResolvedValue({ data: knowledgeId, error: null })
  })

  it('uses the transactional review RPC after verifying a manager', async () => {
    const result = await reviewKnowledgeAction({ workspaceId, knowledgeId, decision: 'approved' })

    expect(result).toEqual({ data: { knowledgeId, status: 'approved' } })
    expect(mocks.rpc).toHaveBeenCalledWith('review_knowledge_item', {
      p_workspace_id: workspaceId,
      p_knowledge_id: knowledgeId,
      p_decision: 'approved',
    })
  })

  it('does not call the RPC for a reviewer', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'reviewer', status: 'active' }, error: null })

    const result = await reviewKnowledgeAction({ workspaceId, knowledgeId, decision: 'approved' })

    expect(result.error?.message).toBe('지식 자료를 검토할 권한이 없습니다.')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
