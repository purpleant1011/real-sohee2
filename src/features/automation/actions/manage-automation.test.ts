import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}))

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
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { runMockAutomationAction, saveAutomationRuleAction } from './manage-automation'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const ruleId = '70000000-0000-4000-8000-000000000001'
const runId = '80000000-0000-4000-8000-000000000001'

describe('automation management actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'owner', status: 'active' }, error: null })
    mocks.rpc.mockResolvedValue({ data: ruleId, error: null })
  })

  it('saves a normalized rule through the server RPC', async () => {
    await expect(saveAutomationRuleAction({
      workspaceId,
      ruleId: null,
      kind: 'content_draft',
      active: true,
      approvalRequired: true,
    })).resolves.toEqual({ data: { ruleId } })

    expect(mocks.rpc).toHaveBeenCalledWith('save_automation_rule', {
      p_workspace_id: workspaceId,
      p_rule_id: null,
      p_kind: 'content_draft',
      p_active: true,
      p_approval_required: true,
    })
  })

  it('refuses to remove the human approval boundary from content drafts', async () => {
    await expect(saveAutomationRuleAction({
      workspaceId,
      ruleId: null,
      kind: 'content_draft',
      active: true,
      approvalRequired: false,
    })).resolves.toMatchObject({ error: { requestId: 'automation-save' } })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('records only an explicit mock outcome and returns its final state', async () => {
    mocks.rpc.mockResolvedValue({
      data: { runId, status: 'failed', errorCode: 'mock_provider_unavailable' },
      error: null,
    })

    await expect(runMockAutomationAction({
      workspaceId,
      ruleId,
      outcome: 'failure',
    })).resolves.toEqual({
      data: { runId, status: 'failed', errorCode: 'mock_provider_unavailable' },
    })
    expect(mocks.rpc).toHaveBeenCalledWith('run_mock_automation', {
      p_workspace_id: workspaceId,
      p_rule_id: ruleId,
      p_outcome: 'failure',
    })
  })
})
