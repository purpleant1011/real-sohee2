// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ credential: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('@/features/channels/credential-repository', () => ({ loadChannelCredentialByChannel: mocks.credential }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({ from: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: mocks.maybeSingle }
    return q
  } }),
}))
import { loadConnectedIdentity } from './identity'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.credential.mockResolvedValue({ externalAccountId: '123', accessToken: 'private-token' })
  mocks.maybeSingle.mockResolvedValue({ data: { account_label: '@My.Shop' }, error: null })
})

describe('profile import credential capability', () => {
  it.each(['instagram', 'threads'] as const)('requests only read capability for %s', async platform => {
    const result = await loadConnectedIdentity('workspace-1', platform)
    expect(result.ownHandle).toBe('my.shop')
    expect(mocks.credential).toHaveBeenCalledWith('workspace-1', platform, undefined, undefined, 'read')
  })
})
