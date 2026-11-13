import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  registerOAuthTransaction: vi.fn(),
  sealOAuthState: vi.fn(),
}))

vi.mock('@/features/auth/current-workspace', () => ({
  getCurrentWorkspaceContext: mocks.getCurrentWorkspaceContext,
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}))
vi.mock('@/features/channels/oauth/oauth-transaction-repository', () => ({
  registerOAuthTransaction: mocks.registerOAuthTransaction,
}))
vi.mock('@/features/channels/oauth/oauth-state', () => ({
  sealOAuthState: mocks.sealOAuthState,
}))

import { GET } from './route'

describe('GET /api/channels/[channel]/connect', () => {
  const allowlistedWorkspaceId = '00000000-0000-4000-8000-0000000000a2'
  const otherWorkspaceId = '11111111-2222-3333-4444-555555555555'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.APP_URL = 'https://example.com'
    process.env.META_OAUTH_STATE_ENCRYPTION_KEY = 'test-state-key'
    process.env.INSTAGRAM_APP_ID = 'test-ig-app'
    process.env.THREADS_APP_ID = 'test-th-app'
    process.env.META_EXTENDED_SCOPE_WORKSPACE_IDS = allowlistedWorkspaceId
    delete process.env.META_EXTENDED_SCOPES_FOR_ALL

    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'test-user-id' } },
          error: null,
        }),
      },
    })
    mocks.sealOAuthState.mockResolvedValue('sealed-cookie-state')
    mocks.registerOAuthTransaction.mockResolvedValue(undefined)
  })

  it.each(['instagram', 'threads'])('shares %s state with the canonical callback and binds the mobile return origin', async (channel) => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: allowlistedWorkspaceId, role: 'owner' })
    const res = await GET(new NextRequest(`https://m.example.com/api/channels/${channel}/connect?returnPath=/app/channels`), { params: Promise.resolve({ channel }) })
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('redirect_uri')).toBe(`https://example.com/api/channels/${channel}/callback`)
    expect(new NextResponse(null, { headers: res.headers }).cookies.get(`sohee_meta_oauth_${channel}`)).toMatchObject({ domain: '.example.com', path: `/api/channels/${channel}/callback`, httpOnly: true, secure: true, sameSite: 'lax' })
    expect(new NextResponse(null, { headers: res.headers }).cookies.get(`sohee_meta_oauth_return_${channel}`)).toMatchObject({ domain: '.example.com' })
    expect(mocks.sealOAuthState).toHaveBeenCalledWith(expect.objectContaining({ returnOrigin: 'https://m.example.com' }), 'test-state-key')
    const legacyExpiry = res.headers.getSetCookie().filter(value => !value.toLowerCase().includes('domain=') && value.includes('Max-Age=0'))
    expect(legacyExpiry).toHaveLength(2)
    expect(legacyExpiry[0]).toContain(`Path=/api/channels/${channel}/callback`)
  })

  it('keeps local OAuth cookies host-only and never accepts an arbitrary return origin', async () => {
    process.env.APP_URL = 'http://localhost:3000'
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ workspaceId: allowlistedWorkspaceId, role: 'owner' })
    const res = await GET(new NextRequest('http://localhost:3000/api/channels/instagram/connect?returnOrigin=https://evil.example'), { params: Promise.resolve({ channel: 'instagram' }) })
    expect(new NextResponse(null, { headers: res.headers }).cookies.get('sohee_meta_oauth_instagram')?.domain).toBeUndefined()
    expect(mocks.sealOAuthState.mock.calls[0][0].returnOrigin).toBeUndefined()
  })

  it('requests only base publish scopes by default when extended flag is not set', async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({
      workspaceId: allowlistedWorkspaceId,
      role: 'owner',
    })

    const req = new NextRequest('https://example.com/api/channels/instagram/connect?returnPath=/app/channels')
    const res = await GET(req, { params: Promise.resolve({ channel: 'instagram' }) })

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('scope')).toBe(
      'instagram_business_basic,instagram_business_content_publish',
    )

    // Transaction records truthful requested scopes
    expect(mocks.registerOAuthTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'instagram',
        requestedScopes: ['instagram_business_basic', 'instagram_business_content_publish'],
      }),
    )
  })

  it('requests extended scopes when extended=1 is passed and caller is allowlisted owner', async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({
      workspaceId: allowlistedWorkspaceId,
      role: 'owner',
    })

    const req = new NextRequest(
      'https://example.com/api/channels/instagram/connect?returnPath=/app/channels&extended=1',
    )
    const res = await GET(req, { params: Promise.resolve({ channel: 'instagram' }) })

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('scope')).toBe(
      'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_messages,instagram_business_manage_insights',
    )

    // Transaction records truthful extended scopes
    expect(mocks.registerOAuthTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'instagram',
        requestedScopes: [
          'instagram_business_basic',
          'instagram_business_content_publish',
          'instagram_business_manage_comments',
          'instagram_business_manage_messages',
          'instagram_business_manage_insights',
        ],
      }),
    )
  })

  it('ignores extended=1 when workspace is not allowlisted', async () => {
    mocks.getCurrentWorkspaceContext.mockResolvedValue({
      workspaceId: otherWorkspaceId,
      role: 'owner',
    })

    const req = new NextRequest(
      'https://example.com/api/channels/threads/connect?returnPath=/app/channels&extended=1',
    )
    const res = await GET(req, { params: Promise.resolve({ channel: 'threads' }) })

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    // Safe by default: only base scopes
    expect(location.searchParams.get('scope')).toBe('threads_basic,threads_content_publish')

    expect(mocks.registerOAuthTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'threads',
        requestedScopes: ['threads_basic', 'threads_content_publish'],
      }),
    )
  })
})
