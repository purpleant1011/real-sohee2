import { afterEach, expect, it, vi } from 'vitest'
import { verifyPostOAuthChannelCapability } from '@/features/channels/dual-channel-verification'
vi.mock('server-only', () => ({}))
vi.mock('@/features/vault/service/save', () => ({ reevaluateReleaseGates: vi.fn() }))
vi.mock('@/features/vault/model/supabase-save-repository', () => ({ SupabaseVaultSaveRepository: class {} }))
afterEach(() => vi.unstubAllGlobals())
it('verifies the canonical Instagram user_id rather than confusing the login-scoped id with another account', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 190 } }, { status: 400 }))
    .mockResolvedValueOnce(Response.json({ id: 'login-scoped-id', user_id: '17841436778506637', username: 'store' }))
  vi.stubGlobal('fetch', fetcher)
  const update = vi.fn()
  const chain: Record<string, unknown> = {}; chain.eq = () => chain; chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve)
  const client = { from: (table: string) => table === 'channel_verification_runs'
    ? { insert: () => Promise.resolve({ error: null }) }
    : { update: (value: unknown) => { update(value); return chain } } }
  const result = await verifyPostOAuthChannelCapability({ workspaceId: 'ws', channel: 'instagram', accessToken: 'test-only-token', providerAccountId: '17841436778506637', adminClient: client })
  expect(result.verified).toBe(true)
  expect(fetcher.mock.calls[1][0]).toContain('fields=id,user_id,username')
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'connected' }))
  expect(Object.keys(update.mock.calls[0][0])).not.toEqual(expect.arrayContaining(['verification_status']))
  expect(update.mock.calls[0][0]).not.toHaveProperty('provider_account_id')
  expect(update.mock.calls[0][0]).not.toHaveProperty('last_verified_at')
})
