import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getWorkspaceCanonicalReadModel } from './server'

const workspaceId = '10000000-0000-4000-8000-000000000001'
function client(overrides: Record<string, { data: any; error?: any }> = {}) {
  const rows: Record<string, any> = {
    channel_connections: [{ id: 'connection-1', channel: 'instagram', status: 'connected', external_account_id: 'account-1', webhook_status: 'healthy' }],
    meta_channel_credentials: [{ channel_connection_id: 'connection-1', provider: 'instagram', status: 'active', token_expires_at: null, granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'] }],
    channel_consents: [{ channel: 'instagram', status: 'ACTIVE', consent_tier: 'AUTONOMOUS_DELEGATION', capabilities: { publish: true, reply_comments: true, reply_dm: true, insights: true } }],
    external_action_receipts: [{ id: 'unrelated-receipt', receipt_kind: 'observed_result', recorded_at: new Date().toISOString() }],
    external_action_requests: [],
  }
  return { from: vi.fn((table: string) => {
    const result = overrides[table] ?? { data: rows[table] ?? [], error: null }
    const query: any = { then: (resolve: any) => Promise.resolve(result).then(resolve) }
    for (const method of ['select', 'eq', 'order', 'limit', 'in']) query[method] = vi.fn(() => query)
    query.maybeSingle = vi.fn(async () => result)
    return query
  }) }
}

function configure() {
  vi.stubEnv('META_APP_MODE', 'live')
  vi.stubEnv('META_APP_REVIEW_STATUS', 'approved')
  vi.stubEnv('META_ACCESS_TIER', 'advanced')
  vi.stubEnv('META_LIVE_WORKSPACE_ALLOWLIST', workspaceId)
  vi.stubEnv('ENGAGEMENT_WORKSPACE_ALLOWLIST', workspaceId)
  vi.stubEnv('ENGAGEMENT_SEND_ENABLED', '1')
  vi.stubEnv('KILL_SWITCH', '0')
  vi.stubEnv('CAPABILITY_KILL_SWITCH', '0')
}
afterEach(() => vi.unstubAllEnvs())

describe('canonical Meta capability evidence', () => {
  it('does not invent optional token scopes from a connected account', async () => {
    configure()
    const model = await getWorkspaceCanonicalReadModel(workspaceId, client())
    expect(model.capabilities.find(c => c.id === 'instagram_feed_publish')?.isExecutable).toBe(true)
    for (const id of ['instagram_comment_reply', 'instagram_dm_reply', 'instagram_insights']) {
      expect(model.capabilities.find(c => c.id === id)).toMatchObject({ isExecutable: false, isProven: false })
    }
  })

  it('never turns unrelated or submission-only receipts into proven capabilities', async () => {
    configure()
    const model = await getWorkspaceCanonicalReadModel(workspaceId, client())
    expect(model.capabilities.every(c => !c.isProven && !c.isAutonomous)).toBe(true)
  })

  it('blocks execution when credentials are expired', async () => {
    configure()
    const model = await getWorkspaceCanonicalReadModel(workspaceId, client({ meta_channel_credentials: { data: [{
      channel_connection_id: 'connection-1', provider: 'instagram', status: 'active', token_expires_at: '2000-01-01T00:00:00Z',
      granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
    }] } }))
    expect(model.capabilities.every(c => !c.isExecutable)).toBe(true)
  })

  it('honors the runtime kill switch and workspace rollout', async () => {
    configure()
    vi.stubEnv('KILL_SWITCH', '1')
    let model = await getWorkspaceCanonicalReadModel(workspaceId, client())
    expect(model.capabilities.every(c => !c.isExecutable)).toBe(true)
    vi.stubEnv('KILL_SWITCH', '0')
    vi.stubEnv('META_LIVE_WORKSPACE_ALLOWLIST', '')
    model = await getWorkspaceCanonicalReadModel(workspaceId, client())
    expect(model.capabilities.every(c => !c.isExecutable)).toBe(true)
  })

  it('requires the complete runtime scope contract, not just the feature permission', async () => {
    configure()
    for (const [provider, scopes, capability] of [
      ['instagram', ['instagram_business_content_publish'], 'instagram_feed_publish'],
      ['threads', ['threads_basic', 'threads_manage_replies'], 'threads_reply'],
    ] as const) {
      const model = await getWorkspaceCanonicalReadModel(workspaceId, client({
        channel_connections: { data: [{ id: 'connection-1', channel: provider, status: 'connected', webhook_status: 'healthy' }] },
        meta_channel_credentials: { data: [{ channel_connection_id: 'connection-1', provider, status: 'active', token_expires_at: null, granted_scopes: [...scopes] }] },
        channel_consents: { data: [{ channel: provider, status: 'ACTIVE', capabilities: { publish: true, reply_comments: true } }] },
      }))
      expect(model.capabilities.find(c => c.id === capability)?.isExecutable).toBe(false)
    }
  })

  it('does not hide permission lookup errors as successful readiness', async () => {
    configure()
    await expect(getWorkspaceCanonicalReadModel(workspaceId, client({
      meta_channel_credentials: { data: null, error: { message: 'database unavailable' } },
    }))).rejects.toThrow()
  })
})
