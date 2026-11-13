import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = { getUser: vi.fn(), updateUser: vi.fn() }
const rpc = vi.fn()
const { getCurrentOperatorSetupContext } = vi.hoisted(() => ({ getCurrentOperatorSetupContext: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth, rpc })),
}))
vi.mock('./setup-context', () => ({ getCurrentOperatorSetupContext }))

import { activateInvitedOperatorAction, updateInvitedOperatorPasswordAction } from './actions'

describe('invited operator password action', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    auth.getUser.mockResolvedValue({ data: { user: { id: 'user-id' } }, error: null })
    auth.updateUser.mockResolvedValue({ error: null })
    rpc.mockResolvedValue({ error: null })
    getCurrentOperatorSetupContext.mockResolvedValue({
      status: 'active', emailConfirmed: true, passwordSet: true,
      hasVerifiedTotp: true, hasRole: true, currentAal: 'aal2',
    })
  })

  it('rejects invalid input before any provider call', async () => {
    await expect(updateInvitedOperatorPasswordAction({ password: 'short', passwordConfirmation: 'short' }))
      .resolves.toMatchObject({ error: { requestId: 'admin-setup-password' } })
    expect(auth.getUser).not.toHaveBeenCalled()
  })

  it('rejects mismatched confirmation before Auth update', async () => {
    await expect(updateInvitedOperatorPasswordAction({ password: 'safe-password', passwordConfirmation: 'different-password' }))
      .resolves.toMatchObject({ error: { requestId: 'admin-setup-password' } })
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not update Auth or RPC without a session', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('not logged in') })
    await expect(updateInvitedOperatorPasswordAction({ password: 'safe-password', passwordConfirmation: 'safe-password' }))
      .resolves.toMatchObject({ error: { requestId: 'admin-setup-password' } })
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('stops before RPC when Auth rejects the password', async () => {
    auth.updateUser.mockResolvedValue({ error: new Error('raw provider detail') })
    await expect(updateInvitedOperatorPasswordAction({ password: 'safe-password', passwordConfirmation: 'safe-password' }))
      .resolves.toMatchObject({ error: { requestId: 'admin-setup-password' } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('records password setup only after Auth update succeeds', async () => {
    await expect(updateInvitedOperatorPasswordAction({ password: 'safe-password', passwordConfirmation: 'safe-password' }))
      .resolves.toEqual({ data: { code: 'password_recorded' } })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'safe-password' })
    expect(rpc).toHaveBeenCalledWith('record_current_invited_operator_password_set')
  })

  it('returns a safe result when the record RPC rejects', async () => {
    rpc.mockResolvedValue({ error: new Error('ADMIN_SETUP_NOT_ALLOWED') })
    const result = await updateInvitedOperatorPasswordAction({ password: 'safe-password', passwordConfirmation: 'safe-password' })
    expect(result).toMatchObject({ error: { requestId: 'admin-setup-password' } })
    expect(JSON.stringify(result)).not.toContain('ADMIN_SETUP_NOT_ALLOWED')
  })

  it('activates only after the RPC and a fresh active AAL2 context recheck', async () => {
    const result = await activateInvitedOperatorAction()
    expect(result).toEqual({ data: { code: 'mfa_activated' } })
    expect(rpc).toHaveBeenCalledWith('activate_current_invited_operator')
    expect(getCurrentOperatorSetupContext).toHaveBeenCalledTimes(1)
  })

  it('does not report activation success when the fresh context is not active AAL2', async () => {
    getCurrentOperatorSetupContext.mockResolvedValue({
      status: 'invited', emailConfirmed: true, passwordSet: true,
      hasVerifiedTotp: true, hasRole: true, currentAal: 'aal1',
    })
    const result = await activateInvitedOperatorAction()
    expect(result).toMatchObject({ error: { requestId: 'admin-setup-mfa' } })
  })
})
