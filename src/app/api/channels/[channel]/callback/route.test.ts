import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  saveConnectedChannel: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  consumeOAuthTransaction: vi.fn(),
  openOAuthState: vi.fn(),
  verifyPostOAuthChannelCapability: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  recordFunnelEvent: vi.fn().mockResolvedValue(undefined),
  adminRpc: vi.fn(),
  adminFrom: vi.fn(),
}))

vi.mock('@/features/auth/current-workspace', () => ({ getCurrentWorkspaceContext: mocks.getCurrentWorkspaceContext }))
vi.mock('@/features/channels/credential-repository', () => ({ saveConnectedChannel: mocks.saveConnectedChannel }))
vi.mock('@/features/channels/oauth/meta-oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/channels/oauth/meta-oauth')>()
  return {
    ...actual,
    exchangeAuthorizationCode: mocks.exchangeAuthorizationCode,
  }
})
vi.mock('@/features/channels/oauth/oauth-transaction-repository', () => ({ consumeOAuthTransaction: mocks.consumeOAuthTransaction }))
vi.mock('@/features/channels/oauth/oauth-state', () => ({ openOAuthState: mocks.openOAuthState }))
vi.mock('@/features/channels/dual-channel-verification', () => ({ verifyPostOAuthChannelCapability: mocks.verifyPostOAuthChannelCapability }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }))
vi.mock('@/features/quick-start/funnel-events', () => ({ recordFunnelEvent: mocks.recordFunnelEvent }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({ rpc: mocks.adminRpc, from: mocks.adminFrom }) }))

import { GET } from './route'

describe('channel OAuth callback funnel tracking', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.META_OAUTH_STATE_ENCRYPTION_KEY = 'state-key'
    process.env.APP_URL = 'http://localhost:3000'
    process.env.INSTAGRAM_APP_ID = 'app-id'
    process.env.INSTAGRAM_APP_SECRET = 'app-secret'
    mocks.openOAuthState.mockResolvedValue({ channel: 'instagram', state: 'state-value', workspaceId: 'ws-1', userId: 'user-1' })
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: 'ws-1', role: 'owner' })
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) } })
    mocks.consumeOAuthTransaction.mockResolvedValue(undefined)
    mocks.exchangeAuthorizationCode.mockResolvedValue({
      externalAccountId: 'account-1', accountLabel: '@sohee', accessToken: 'secret-token',
      expiresInSeconds: null, grantedScopes: ['instagram_business_basic'],
    })
    mocks.saveConnectedChannel.mockResolvedValue({ connectionId: 'connection-1' })
    mocks.verifyPostOAuthChannelCapability.mockResolvedValue(undefined)
    mocks.adminRpc.mockResolvedValue({ data: { granted: false, credits_granted: 0, reason: 'CHANNELS_NOT_CONNECTED' }, error: null })
    mocks.adminFrom.mockReturnValue({ update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) })
  })

  it.each(['success', 'cancelled', 'failed'])('returns a mobile reconnect %s to its bound origin and clears shared cookies', async (outcome) => {
    process.env.APP_URL = 'https://example.com'
    mocks.openOAuthState.mockResolvedValueOnce({ channel: 'instagram', state: 'state-value', workspaceId: 'ws-1', userId: 'user-1', returnPath: '/app/channels', returnOrigin: 'https://m.example.com' })
    if (outcome === 'failed') mocks.exchangeAuthorizationCode.mockRejectedValueOnce(new Error('provider failed'))
    const query = outcome === 'cancelled' ? 'state=state-value&error=access_denied' : 'state=state-value&code=oauth-code'
    const res = await GET(new NextRequest(`https://example.com/api/channels/instagram/callback?${query}`, { headers: { cookie: 'sohee_meta_oauth_instagram=sealed-state' } }), { params: Promise.resolve({ channel: 'instagram' }) })
    const destination = new URL(res.headers.get('location')!)
    expect(destination.origin).toBe('https://m.example.com')
    expect(destination.pathname).toBe('/app/channels')
    expect(new NextResponse(null, { headers: res.headers }).cookies.get('sohee_meta_oauth_instagram')).toMatchObject({ domain: '.example.com', path: '/api/channels/instagram/callback', expires: new Date(0) })
    expect(res.headers.getSetCookie().filter(value => !value.toLowerCase().includes('domain=') && value.includes('Max-Age=0'))).toHaveLength(2)
    if (outcome !== 'success') expect(mocks.saveConnectedChannel).not.toHaveBeenCalled()
  })

  it('does not redirect to a forged return origin or save on provider rejection', async () => {
    mocks.openOAuthState.mockResolvedValueOnce({ channel: 'instagram', state: 'other-state', returnOrigin: 'https://evil.example' })
    const res = await GET(new NextRequest('http://localhost:3000/api/channels/instagram/callback?state=state-value&error=access_denied', { headers: { cookie: 'sohee_meta_oauth_instagram=sealed-state' } }), { params: Promise.resolve({ channel: 'instagram' }) })
    expect(new URL(res.headers.get('location')!).origin).toBe('http://localhost:3000')
    expect(mocks.saveConnectedChannel).not.toHaveBeenCalled()
  })

  it('ignores a tampered return-path cookie before redirecting', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/channels/instagram/callback?error=access_denied', {
        headers: { cookie: 'sohee_meta_oauth_return_instagram=https%3A%2F%2Fevil.example' },
      }),
      { params: Promise.resolve({ channel: 'instagram' }) },
    )
    expect(response.headers.get('location')).toBe('http://localhost:3000/app/channels?connect=cancelled&channel=instagram')
  })

  it('records channel connection only after the credential has been saved', async () => {
    const sequence: string[] = []
    mocks.saveConnectedChannel.mockImplementation(async () => { sequence.push('saved') })
    mocks.recordFunnelEvent.mockImplementation(async () => { sequence.push('tracked') })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/channels/instagram/callback?state=state-value&code=oauth-code', {
        headers: { cookie: 'sohee_meta_oauth_instagram=sealed-state' },
      }),
      { params: Promise.resolve({ channel: 'instagram' }) },
    )

    expect(response.headers.get('location')).toContain('connect=authorized')
    expect(sequence).toEqual(['saved', 'tracked'])
    expect(mocks.recordFunnelEvent).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1', userId: 'user-1', event: 'channel_connected',
      properties: { channel: 'instagram' }, dedupeKey: 'channel_connected:ws-1:instagram',
    }))
  })

  it('requests deferred signup credits only after the saved SNS connection', async () => {
    const sequence: string[] = []
    mocks.saveConnectedChannel.mockImplementation(async () => { sequence.push('saved') })
    mocks.adminFrom.mockImplementation(() => ({ update: () => ({ eq: () => ({ eq: async () => { sequence.push('connected'); return { error: null } } }) }) }))
    mocks.adminRpc.mockImplementation(async () => { sequence.push('grant'); return { data: { credits_granted: 600 }, error: null } })
    const response = await GET(
      new NextRequest('http://localhost:3000/api/channels/instagram/callback?state=state-value&code=oauth-code', {
        headers: { cookie: 'sohee_meta_oauth_instagram=sealed-state' },
      }),
      { params: Promise.resolve({ channel: 'instagram' }) },
    )
    expect(response.headers.get('location')).toContain('connect=authorized')
    expect(sequence).toEqual(['saved', 'connected', 'grant'])
    expect(mocks.adminRpc).toHaveBeenCalledWith('ensure_signup_starter_credits', {
      p_user_id: 'user-1', p_workspace_id: 'ws-1',
    })
  })

  it('does not record the connection when credential persistence fails', async () => {
    mocks.saveConnectedChannel.mockRejectedValueOnce(new Error('credential persistence failed'))

    const response = await GET(
      new NextRequest('http://localhost:3000/api/channels/instagram/callback?state=state-value&code=oauth-code', {
        headers: { cookie: 'sohee_meta_oauth_instagram=sealed-state' },
      }),
      { params: Promise.resolve({ channel: 'instagram' }) },
    )

    expect(response.headers.get('location')).toContain('connect=unavailable')
    expect(mocks.recordFunnelEvent).not.toHaveBeenCalled()
  })

  it('does not change the successful callback when funnel tracking throws', async () => {
    mocks.recordFunnelEvent.mockRejectedValueOnce(new Error('telemetry unavailable'))

    const response = await GET(
      new NextRequest('http://localhost:3000/api/channels/instagram/callback?state=state-value&code=oauth-code', {
        headers: { cookie: 'sohee_meta_oauth_instagram=sealed-state' },
      }),
      { params: Promise.resolve({ channel: 'instagram' }) },
    )

    expect(response.headers.get('location')).toContain('connect=authorized')
    expect(response.headers.get('location')).toContain('channel=instagram')
  })

  it('redirects with SCOPE_MISSING when essential publish scope is missing, keeping raw error message off URL', async () => {
    const { ScopeMissingError } = await import('@/features/channels/oauth/meta-oauth')
    mocks.saveConnectedChannel.mockRejectedValueOnce(new ScopeMissingError('SCOPE_MISSING: sensitive-token-xyz missing content_publish'))

    const response = await GET(
      new NextRequest('http://localhost:3000/api/channels/instagram/callback?state=state-value&code=oauth-code', {
        headers: { cookie: 'sohee_meta_oauth_instagram=sealed-state' },
      }),
      { params: Promise.resolve({ channel: 'instagram' }) },
    )

    const location = response.headers.get('location')!
    expect(location).toContain('connect=unavailable')
    expect(location).toContain('channel=instagram')
    expect(location).toContain('connect_error=SCOPE_MISSING')
    expect(location).toContain('error=SCOPE_MISSING')
    expect(location).not.toContain('sensitive-token-xyz')
    expect(location).not.toContain('missing content_publish')
  })

  it('redirects with ACCOUNT_ALREADY_CONNECTED when duplicate cross-workspace binding is detected', async () => {
    const { DuplicateBindingError } = await import('@/features/channels/oauth/meta-oauth')
    mocks.saveConnectedChannel.mockRejectedValueOnce(new DuplicateBindingError('DUPLICATE_BINDING: Account 123 is already connected to another workspace-abc'))

    const response = await GET(
      new NextRequest('http://localhost:3000/api/channels/instagram/callback?state=state-value&code=oauth-code', {
        headers: { cookie: 'sohee_meta_oauth_instagram=sealed-state' },
      }),
      { params: Promise.resolve({ channel: 'instagram' }) },
    )

    const location = response.headers.get('location')!
    expect(location).toContain('connect=unavailable')
    expect(location).toContain('channel=instagram')
    expect(location).toContain('connect_error=ACCOUNT_ALREADY_CONNECTED')
    expect(location).toContain('error=ACCOUNT_ALREADY_CONNECTED')
    expect(location).not.toContain('workspace-abc')
  })

  it('tolerates partial grant when user declines extended scopes (still has publish scopes)', async () => {
    // User declined comments/messages/insights, granting only publish scopes
    const partialScopes = ['instagram_business_basic', 'instagram_business_content_publish']
    mocks.exchangeAuthorizationCode.mockResolvedValueOnce({
      externalAccountId: 'account-1',
      accountLabel: '@sohee',
      accessToken: 'secret-token',
      expiresInSeconds: 3600,
      grantedScopes: partialScopes,
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/channels/instagram/callback?state=state-value&code=oauth-code', {
        headers: { cookie: 'sohee_meta_oauth_instagram=sealed-state' },
      }),
      { params: Promise.resolve({ channel: 'instagram' }) },
    )

    expect(response.headers.get('location')).toContain('connect=authorized')
    expect(mocks.saveConnectedChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        grantedScopes: partialScopes,
      }),
    )
  })

  it('redirects with SCOPE_VERIFICATION_UNAVAILABLE when scope verification cannot be completed', async () => {
    process.env.THREADS_APP_ID = 'threads-app-id'
    process.env.THREADS_APP_SECRET = 'threads-app-secret'
    mocks.openOAuthState.mockResolvedValueOnce({ channel: 'threads', state: 'state-value', workspaceId: 'ws-1', userId: 'user-1' })

    const { ScopeVerificationUnavailableError } = await import('@/features/channels/oauth/meta-oauth')
    mocks.exchangeAuthorizationCode.mockRejectedValueOnce(
      new ScopeVerificationUnavailableError('SCOPE_VERIFICATION_UNAVAILABLE: Meta verification timeout'),
    )

    const response = await GET(
      new NextRequest('http://localhost:3000/api/channels/threads/callback?state=state-value&code=oauth-code', {
        headers: { cookie: 'sohee_meta_oauth_threads=sealed-state' },
      }),
      { params: Promise.resolve({ channel: 'threads' }) },
    )

    const location = response.headers.get('location')!
    expect(location).toContain('connect=unavailable')
    expect(location).toContain('channel=threads')
    expect(location).toContain('connect_error=SCOPE_VERIFICATION_UNAVAILABLE')
    expect(location).toContain('error=SCOPE_VERIFICATION_UNAVAILABLE')
    expect(location).not.toContain('timeout')
  })
})
