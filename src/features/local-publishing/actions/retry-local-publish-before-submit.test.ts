import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/features/auth/current-workspace', () => ({ getCurrentWorkspaceContext: mocks.workspace }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { retryLocalPublishBeforeSubmitAction } from './retry-local-publish-before-submit'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000002'
const actionId = '10000000-0000-4000-8000-000000000003'

describe('retryLocalPublishBeforeSubmitAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspace.mockResolvedValue({ workspaceId, role: 'owner' })
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    mocks.rpc.mockResolvedValue({ data: true, error: null })
  })

  it('uses only the guarded exact-action RPC', async () => {
    await expect(retryLocalPublishBeforeSubmitAction({ workspaceId, actionId })).resolves.toEqual({ data: { retried: true } })
    expect(mocks.rpc).toHaveBeenCalledWith('retry_local_publish_before_submit', {
      p_workspace_id: workspaceId, p_actor_user_id: userId, p_action_id: actionId,
    })
  })

  it('rejects a reviewer before the mutation', async () => {
    mocks.workspace.mockResolvedValue({ workspaceId, role: 'reviewer' })
    await expect(retryLocalPublishBeforeSubmitAction({ workspaceId, actionId })).resolves.toHaveProperty('error')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
