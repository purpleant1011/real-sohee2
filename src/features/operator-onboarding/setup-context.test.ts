import { describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ rpc })),
}))

import { getCurrentOperatorSetupContext, parseOperatorSetupContext } from './setup-context'

const validContext = {
  status: 'invited', emailConfirmed: true, passwordSet: false,
  hasVerifiedTotp: false, hasRole: true, currentAal: 'aal1',
}

describe('operator setup context', () => {
  it('rejects extra or malformed fields without inferring authorization', () => {
    expect(parseOperatorSetupContext({ ...validContext, user_metadata: { role: 'admin' } })).toBeNull()
    expect(parseOperatorSetupContext({ ...validContext, status: 'unknown' })).toBeNull()
  })

  it('returns unavailable when the setup RPC is malformed or fails', async () => {
    rpc.mockResolvedValueOnce({ data: { ...validContext, extra: true }, error: null })
    await expect(getCurrentOperatorSetupContext()).resolves.toBeNull()
    rpc.mockResolvedValueOnce({ data: null, error: new Error('raw rpc detail') })
    await expect(getCurrentOperatorSetupContext()).resolves.toBeNull()
  })

  it('returns only the strictly parsed setup facts', async () => {
    rpc.mockResolvedValueOnce({ data: validContext, error: null })
    await expect(getCurrentOperatorSetupContext()).resolves.toEqual(validContext)
  })
})
