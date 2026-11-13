import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('@/features/auth/current-workspace', () => ({ getCurrentWorkspaceContext: mocks.workspace }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { reconfirmLocalPublishAction } from './reconfirm-local-publish'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000002'
const actionId = '10000000-0000-4000-8000-000000000003'

describe('reconfirmLocalPublishAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspace.mockResolvedValue({ workspaceId, role: 'manager' })
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
    mocks.rpc.mockResolvedValue({ data: true, error: null })
  })

  it('reconfirms only the action id through the server-owned exact-version RPC', async () => {
    await expect(reconfirmLocalPublishAction({ workspaceId, actionId })).resolves.toEqual({ data: { reconfirmed: true } })
    expect(mocks.rpc).toHaveBeenCalledWith('reconfirm_local_publish', {
      p_workspace_id: workspaceId,
      p_actor_user_id: userId,
      p_action_id: actionId,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/schedule')
  })

  it('rejects a different workspace and a reviewer before the mutation', async () => {
    await expect(reconfirmLocalPublishAction({ workspaceId: '20000000-0000-4000-8000-000000000001', actionId })).resolves.toHaveProperty('error')
    mocks.workspace.mockResolvedValue({ workspaceId, role: 'reviewer' })
    await expect(reconfirmLocalPublishAction({ workspaceId, actionId })).resolves.toHaveProperty('error')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
