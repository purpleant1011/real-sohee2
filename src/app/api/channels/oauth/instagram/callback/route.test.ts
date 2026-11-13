import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolveDeterministicWorkspace: vi.fn(),
  consumeOAuthTransaction: vi.fn(),
  assertNoCrossWorkspaceBinding: vi.fn(),
  verifyPostOAuthChannelCapability: vi.fn(),
  grantConnectedSignupCredits: vi.fn(),
  upsertChannel: vi.fn(),
  upsertConsent: vi.fn(),
  insertAudit: vi.fn(),
  subscribeInstagramWebhooks: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: (table: string) => {
      if (table === 'channel_connections') {
        return { upsert: mocks.upsertChannel }
      }
      if (table === 'channel_consents') {
        return { upsert: mocks.upsertConsent }
      }
      if (table === 'audit_events') {
        return { insert: mocks.insertAudit }
      }
      return { upsert: vi.fn().mockResolvedValue({ error: null }) }
    },
  }),
}))

vi.mock('@/features/auth/workspace-context', () => ({
  resolveDeterministicWorkspace: mocks.resolveDeterministicWorkspace,
}))

vi.mock('@/lib/channels/oauth-transaction-manager', () => ({
  consumeOAuthTransaction: mocks.consumeOAuthTransaction,
  assertNoCrossWorkspaceBinding: mocks.assertNoCrossWorkspaceBinding,
}))

vi.mock('@/features/channels/dual-channel-verification', () => ({
  verifyPostOAuthChannelCapability: mocks.verifyPostOAuthChannelCapability,
  normalizeInstagramScopes: (scopes: readonly string[]) => [...scopes],
}))

vi.mock('@/features/membership/grant-connected-signup-credits', () => ({
  grantConnectedSignupCredits: mocks.grantConnectedSignupCredits,
}))

vi.mock('@/features/channels/oauth/webhook-subscription', () => ({
  subscribeInstagramWebhooks: mocks.subscribeInstagramWebhooks,
}))

import { GET } from './route'

describe('Instagram OAuth Callback', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    process.env.APP_URL = 'http://localhost:3000'
    process.env.INSTAGRAM_APP_ID = 'test-ig-app'
    process.env.META_APP_SECRET = 'test-ig-secret'

    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'owner@example.com' } },
      error: null,
    })
    mocks.resolveDeterministicWorkspace.mockResolvedValue({
      success: true,
      workspaceId: 'ws-1',
    })
    mocks.consumeOAuthTransaction.mockResolvedValue({
      returnPath: '/start?step=channels',
      correlationId: 'tx-1',
    })
    mocks.assertNoCrossWorkspaceBinding.mockResolvedValue(undefined)
    mocks.upsertChannel.mockResolvedValue({ error: null })
    mocks.upsertConsent.mockResolvedValue({ error: null })
    mocks.insertAudit.mockReturnValue({ catch: vi.fn() })
    mocks.verifyPostOAuthChannelCapability.mockReturnValue({ catch: vi.fn() })
    mocks.grantConnectedSignupCredits.mockResolvedValue(undefined)
    mocks.subscribeInstagramWebhooks.mockResolvedValue({ ok: true })
  })

  it('redirects with SCOPE_MISSING when content_publish is missing from token response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'short-lived-token',
        permissions: ['instagram_business_basic'], // content_publish 누락
      }),
    })

    const req = new NextRequest('http://localhost:3000/api/channels/oauth/instagram/callback?code=test-code&state=valid-state')
    const res = await GET(req)

    const location = res.headers.get('location')!
    expect(location).toContain('error=SCOPE_MISSING')
    expect(location).toContain('connect_error=SCOPE_MISSING')
    expect(location).toContain('connect=unavailable')
    expect(location).toContain('channel=instagram')
    expect(location).not.toContain('short-lived-token')
  })

  it('redirects with ACCOUNT_ALREADY_CONNECTED when duplicate cross-workspace binding error is thrown', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'short-token',
          permissions: ['instagram_business_basic', 'instagram_business_content_publish'],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'long-token', expires_in: 5184000 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'page-1',
              name: 'My Page',
              instagram_business_account: { id: 'ig-account-123', username: 'my_ig' },
            },
          ],
        }),
      })

    const { DuplicateBindingError } = await import('@/features/channels/oauth/meta-oauth')
    mocks.assertNoCrossWorkspaceBinding.mockRejectedValueOnce(
      new DuplicateBindingError('DUPLICATE_BINDING: Account already connected to workspace-xyz'),
    )

    const req = new NextRequest('http://localhost:3000/api/channels/oauth/instagram/callback?code=test-code&state=valid-state')
    const res = await GET(req)

    const location = res.headers.get('location')!
    expect(location).toContain('error=ACCOUNT_ALREADY_CONNECTED')
    expect(location).toContain('connect_error=ACCOUNT_ALREADY_CONNECTED')
    expect(location).toContain('connect=unavailable')
    expect(location).toContain('channel=instagram')
    expect(location).not.toContain('workspace-xyz')
  })

  it('triggers webhook subscription best-effort on successful connection and logs to console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'short-token',
          permissions: ['instagram_business_basic', 'instagram_business_content_publish'],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'long-token-999', expires_in: 5184000 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'page-1',
              name: 'My Page',
              instagram_business_account: { id: 'ig-account-456', username: 'my_ig' },
            },
          ],
        }),
      })

    mocks.subscribeInstagramWebhooks.mockResolvedValueOnce({ ok: true })

    const req = new NextRequest('http://localhost:3000/api/channels/oauth/instagram/callback?code=test-code&state=valid-state')
    const res = await GET(req)

    expect(mocks.subscribeInstagramWebhooks).toHaveBeenCalledWith({
      accessToken: 'long-token-999',
      igUserId: 'ig-account-456',
    })
    expect(warnSpy).toHaveBeenCalledWith('[webhook-subscribe]', {
      channel: 'instagram',
      ok: true,
      reason: undefined,
    })

    const location = res.headers.get('location')!
    expect(location).toContain('channel=instagram')
    expect(location).toContain('status=connected')
  })

  it('still completes connection successfully even if webhook subscription rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'short-token',
          permissions: ['instagram_business_basic', 'instagram_business_content_publish'],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'long-token-888', expires_in: 5184000 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'page-1',
              name: 'My Page',
              instagram_business_account: { id: 'ig-account-789', username: 'my_ig' },
            },
          ],
        }),
      })

    mocks.subscribeInstagramWebhooks.mockRejectedValueOnce(new Error('NETWORK_TIMEOUT'))

    const req = new NextRequest('http://localhost:3000/api/channels/oauth/instagram/callback?code=test-code&state=valid-state')
    const res = await GET(req)

    expect(warnSpy).toHaveBeenCalledWith('[webhook-subscribe]', {
      channel: 'instagram',
      ok: false,
      reason: 'NETWORK_TIMEOUT',
    })

    const location = res.headers.get('location')!
    expect(location).toContain('channel=instagram')
    expect(location).toContain('status=connected')
  })
})
