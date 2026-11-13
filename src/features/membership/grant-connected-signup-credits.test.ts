import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({ rpc }) }))

import { grantConnectedSignupCredits } from './grant-connected-signup-credits'

describe('deferred signup credit request', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sends the active user and workspace to the service-role-only RPC', async () => {
    rpc.mockResolvedValue({ data: { granted: true, credits_granted: 600 }, error: null })
    await expect(grantConnectedSignupCredits('owner-1', 'ws-1')).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('ensure_signup_starter_credits', {
      p_user_id: 'owner-1', p_workspace_id: 'ws-1',
    })
  })

  it('does not interrupt OAuth when the grant fails in the database', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      rpc.mockResolvedValue({ data: null, error: { message: 'temporary database failure' } })
      await expect(grantConnectedSignupCredits('owner-1', 'ws-1')).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })
})
