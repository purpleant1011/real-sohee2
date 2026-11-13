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
}))

vi.mock('@/features/membership/grant-connected-signup-credits', () => ({
  grantConnectedSignupCredits: mocks.grantConnectedSignupCredits,
}))

import { GET } from './route'

describe('Threads OAuth Callback', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    process.env.APP_URL = 'http://localhost:3000'
    process.env.THREADS_APP_ID = 'test-threads-app'
    process.env.THREADS_APP_SECRET = 'test-secret'

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
  })

  it('redirects with SCOPE_MISSING when threads_content_publish is missing from token response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'short-lived-token',
        user_id: 'threads-user-123',
        scope: 'threads_basic', // threads_content_publish 누락
      }),
    })

    const req = new NextRequest('http://localhost:3000/api/channels/oauth/threads/callback?code=test-code&state=valid-state')
    const res = await GET(req)

    const location = res.headers.get('location')!
    expect(location).toContain('error=SCOPE_MISSING')
    expect(location).toContain('connect_error=SCOPE_MISSING')
    expect(location).toContain('connect=unavailable')
    expect(location).toContain('channel=threads')
    expect(location).not.toContain('short-lived-token')
  })

  it('redirects with ACCOUNT_ALREADY_CONNECTED when duplicate cross-workspace binding error is thrown', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'short-token',
          user_id: 'threads-user-123',
          scope: 'threads_basic,threads_content_publish',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'long-token', expires_in: 5184000 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ username: 'my_threads' }),
      })

    const { DuplicateBindingError } = await import('@/features/channels/oauth/meta-oauth')
    mocks.assertNoCrossWorkspaceBinding.mockRejectedValueOnce(
      new DuplicateBindingError('DUPLICATE_BINDING: Account already connected to workspace-xyz'),
    )

    const req = new NextRequest('http://localhost:3000/api/channels/oauth/threads/callback?code=test-code&state=valid-state')
    const res = await GET(req)

    const location = res.headers.get('location')!
    expect(location).toContain('error=ACCOUNT_ALREADY_CONNECTED')
    expect(location).toContain('connect_error=ACCOUNT_ALREADY_CONNECTED')
    expect(location).toContain('connect=unavailable')
    expect(location).toContain('channel=threads')
    expect(location).not.toContain('workspace-xyz')
  })

  it('redirects with CONNECTION_SAVE_FAILED when generic upsert error occurs', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'short-token',
          user_id: 'threads-user-123',
          scope: 'threads_basic,threads_content_publish',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'long-token', expires_in: 5184000 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ username: 'my_threads' }),
      })

    mocks.upsertChannel.mockResolvedValueOnce({ error: { message: 'DB connection timeout' } })

    const req = new NextRequest('http://localhost:3000/api/channels/oauth/threads/callback?code=test-code&state=valid-state')
    const res = await GET(req)

    const location = res.headers.get('location')!
    expect(location).toContain('error=CONNECTION_SAVE_FAILED')
    expect(location).toContain('connect_error=CONNECTION_SAVE_FAILED')
    expect(location).not.toContain('DB connection timeout')
  })

  it('queries debug_token when token response lacks scopes and succeeds if publish scope is granted', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'short-token-no-scope',
          user_id: 'threads-user-123',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            is_valid: true,
            scopes: ['threads_basic', 'threads_content_publish'],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'long-token', expires_in: 5184000 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ username: 'my_threads' }),
      })

    const req = new NextRequest('http://localhost:3000/api/channels/oauth/threads/callback?code=test-code&state=valid-state')
    const res = await GET(req)

    const location = res.headers.get('location')!
    expect(location).toContain('connect=authorized')
    expect(location).toContain('status=connected')
    expect(fetchMock.mock.calls[1]?.[0]).toContain('https://graph.threads.net/v1.0/debug_token')
  })

  it('redirects with SCOPE_VERIFICATION_UNAVAILABLE when debug_token endpoint fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'short-token-no-scope',
          user_id: 'threads-user-123',
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'service unavailable' }),
      })

    const req = new NextRequest('http://localhost:3000/api/channels/oauth/threads/callback?code=test-code&state=valid-state')
    const res = await GET(req)

    const location = res.headers.get('location')!
    expect(location).toContain('error=SCOPE_VERIFICATION_UNAVAILABLE')
    expect(location).toContain('connect_error=SCOPE_VERIFICATION_UNAVAILABLE')
    expect(location).toContain('connect=unavailable')
  })
})
