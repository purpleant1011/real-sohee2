import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPersistedChannelVerification, verifyPostOAuthChannelCapability } from '@/features/channels/dual-channel-verification'

const { loadCredential } = vi.hoisted(() => ({ loadCredential: vi.fn() }))
vi.mock('@/features/channels/credential-repository', () => ({ loadChannelCredentialByChannel: loadCredential }))
vi.mock('@/features/vault/service/save', () => ({ reevaluateReleaseGates: vi.fn() }))
vi.mock('@/features/vault/model/supabase-save-repository', () => ({ SupabaseVaultSaveRepository: class {} }))

function database({ age = 8, expired = false, invalidExpiry = false, queryError = false, missingScope = false, changedDuringProbe = false, connectionChangedAtWrite = false, receiptAccount = 'account-a' } = {}) {
  const writes: Array<{ table: string; payload: any }> = []
  const expiresAt = new Date(Date.now() + (expired ? -1 : 30) * 86400000).toISOString()
  const filters: Array<[string, string, unknown]> = []
  const client = { from: vi.fn((table: string) => {
    let write = false
    const query: any = {
      select: () => query, eq: (key: string, value: unknown) => { filters.push([table, key, value]); return query }, in: () => query, order: () => query, limit: () => query,
      insert: (payload: any) => { write = true; writes.push({ table, payload }); return query },
      update: (payload: any) => { write = true; writes.push({ table, payload }); return query },
      maybeSingle: async () => table === 'channel_connections'
        ? { data: connectionChangedAtWrite ? null : { id: 'connection-a' }, error: null }
        : table === 'meta_channel_credentials'
        ? { data: { status: 'active', token_expires_at: invalidExpiry ? 'invalid' : expiresAt,
          granted_scopes: missingScope ? ['threads_basic'] : ['threads_basic', 'threads_content_publish'], channel_connections: { external_account_id: changedDuringProbe && vi.mocked(fetch).mock.calls.length > 0 ? 'account-b' : 'account-a' } }, error: null }
        : { data: { status: 'VERIFIED', verification_code: `CAPABILITY_PROBE_${receiptAccount}`, created_at: new Date(Date.now() - age * 86400000).toISOString() }, error: queryError ? { message: 'unavailable' } : null },
      then: (resolve: any) => Promise.resolve({ data: write ? {} : null, error: null }).then(resolve),
    }
    return query
  }) }
  return { client, writes, filters }
}

beforeEach(() => {
  loadCredential.mockReset().mockResolvedValue({ accessToken: 'test-secret', externalAccountId: 'account-a' })
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'account-a', username: 'store' })))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('expired receipt reconciliation', () => {
  it('renews a stale receipt using profile GET only, without changing credentials', async () => {
    const { client, writes } = database()
    const result = await getPersistedChannelVerification('workspace-a', 'threads', { adminClient: client })
    expect(result.verified).toBe(true)
    expect(writes.find(w => w.table === 'channel_verification_runs')?.payload.status).toBe('VERIFIED')
    expect(writes.every(w => ['channel_verification_runs', 'channel_connections'].includes(w.table))).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe('GET')
  })
  it.each([{ age: 1 }, { expired: true }, { invalidExpiry: true }, { queryError: true }, { missingScope: true }])('does not probe fresh, expired-token, unknown, or insufficient-scope evidence: %j', async options => {
    const { client } = database(options)
    await getPersistedChannelVerification('workspace-a', 'threads', { adminClient: client })
    expect(loadCredential).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not reconcile credentials for an account changed since the readiness read', async () => {
    loadCredential.mockResolvedValue({ accessToken: 'test-secret', externalAccountId: 'account-b' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'account-b' })))
    const { client, writes } = database()
    const result = await getPersistedChannelVerification('workspace-a', 'threads', { adminClient: client })
    expect(result.verified).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
  it('does not persist or verify an account replaced while the profile probe is in flight', async () => {
    const { client, writes } = database({ changedDuringProbe: true })
    const result = await getPersistedChannelVerification('workspace-a', 'threads', { adminClient: client })
    expect(result.verified).toBe(false)
    expect(writes).toEqual([])
  })
  it('fails closed when the account-scoped connection update no longer matches a row', async () => {
    const { client, filters } = database({ connectionChangedAtWrite: true })
    const result = await getPersistedChannelVerification('workspace-a', 'threads', { adminClient: client })
    expect(result.verified).toBe(false)
    expect(filters).toContainEqual(['channel_connections', 'workspace_id', 'workspace-a'])
    expect(filters).toContainEqual(['channel_connections', 'channel', 'threads'])
    expect(filters).toContainEqual(['channel_connections', 'external_account_id', 'account-a'])
  })
  it('does not reuse a fresh capability receipt belonging to the previous account', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('provider unavailable') }))
    const { client } = database({ age: 1, receiptAccount: 'previous-account' })
    const result = await getPersistedChannelVerification('workspace-a', 'threads', { adminClient: client })
    expect(result.verified).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('never verifies a different provider account', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'account-b' })))
    const { client, writes } = database()
    const result = await getPersistedChannelVerification('workspace-a', 'threads', { adminClient: client })
    expect(result.verified).toBe(false)
    expect(writes.find(w => w.table === 'channel_verification_runs')?.payload.status).toBe('FAILED')
    expect(JSON.stringify(writes)).not.toContain('account-b')
    expect(JSON.stringify(result)).not.toContain('test-secret')
  })
  it.each(['instagram', 'threads'] as const)('uses bounded GET-only probes for %s', async channel => {
    const { client } = database()
    const result = await verifyPostOAuthChannelCapability({ workspaceId: 'workspace-a', channel,
      accessToken: 'test-secret', providerAccountId: 'account-a', adminClient: client })
    expect(result.verified).toBe(true)
    const options = vi.mocked(fetch).mock.calls[0][1]
    expect(options?.method).toBe('GET')
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })
  it('preserves a stale blocker when the read-only probe fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('provider unavailable') }))
    const { client, writes } = database()
    const result = await getPersistedChannelVerification('workspace-a', 'threads', { adminClient: client })
    expect(result).toMatchObject({ status: 'READY_DEGRADED', verified: false, evidence: null })
    expect(result.lastCheckedAt).toBeTruthy()
    expect(writes.find(w => w.table === 'channel_verification_runs')?.payload.status).toBe('FAILED')
  })
  it('does not accept a successful response with no account identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
    const { client } = database()
    const result = await verifyPostOAuthChannelCapability({ workspaceId: 'workspace-a', channel: 'threads',
      accessToken: 'test-secret', providerAccountId: 'account-a', adminClient: client })
    expect(result.verified).toBe(false)
  })
})
