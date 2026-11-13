import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  rpc: vi.fn(),
  getUser: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/features/auth/current-workspace', () => ({ getCurrentWorkspaceContext: mocks.workspace }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { createPairingCodeAction } from './create-pairing-code'
import { revokeDeviceAction } from './revoke-device'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000002'
const deviceId = '10000000-0000-4000-8000-000000000003'

describe('connector device actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspace.mockResolvedValue({ workspaceId, role: 'owner' })
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
  })

  it('creates a one-time high-entropy code while storing only its digest', async () => {
    mocks.rpc.mockResolvedValue({ data: '10000000-0000-4000-8000-000000000004', error: null })
    const result = await createPairingCodeAction()
    expect(result.code).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(mocks.rpc).toHaveBeenCalledWith('create_connector_pairing_code', expect.objectContaining({
      p_workspace_id: workspaceId,
      p_actor_user_id: userId,
      p_code_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(mocks.rpc.mock.calls[0]?.[1].p_code_digest).not.toBe(result.code)
  })

  it('does not create or revoke devices for a viewer', async () => {
    mocks.workspace.mockResolvedValue({ workspaceId, role: 'viewer' })
    await expect(createPairingCodeAction()).resolves.toMatchObject({ code: null, error: expect.any(String) })
    const form = new FormData()
    form.set('deviceId', deviceId)
    await revokeDeviceAction(form)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('revokes only the selected device through the service RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    const form = new FormData()
    form.set('deviceId', deviceId)
    await revokeDeviceAction(form)
    expect(mocks.rpc).toHaveBeenCalledWith('revoke_connector_device', {
      p_workspace_id: workspaceId,
      p_actor_user_id: userId,
      p_device_id: deviceId,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/settings/channels/naver')
  })
})
