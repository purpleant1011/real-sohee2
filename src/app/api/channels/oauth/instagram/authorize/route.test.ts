import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createOAuthTransaction: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}))
vi.mock('@/lib/channels/oauth-transaction-manager', () => ({
  createOAuthTransaction: mocks.createOAuthTransaction,
}))

import { GET } from './route'

describe('GET /api/channels/oauth/instagram/authorize', () => {
  const allowlistedWorkspaceId = '00000000-0000-4000-8000-0000000000a2'
  const nonAllowlistedWorkspaceId = '22222222-3333-4444-5555-666666666666'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.APP_URL = 'https://example.com'
    process.env.INSTAGRAM_APP_ID = 'test-ig-app'
    process.env.META_EXTENDED_SCOPE_WORKSPACE_IDS = allowlistedWorkspaceId
    delete process.env.META_EXTENDED_SCOPES_FOR_ALL

    mocks.createOAuthTransaction.mockResolvedValue({
      state: 'tx-state-123',
    })
  })

  function mockSupabase(role = 'owner') {
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'test-user-id' } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { role },
                error: null,
              }),
            }),
          }),
        }),
      }),
    })
  }

  it('redirects with base publish scopes by default when extended flag is not set', async () => {
    mockSupabase('owner')
    const req = new NextRequest(
      `https://example.com/api/channels/oauth/instagram/authorize?workspaceId=${allowlistedWorkspaceId}`,
    )
    const res = await GET(req)

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('scope')).toBe(
      'instagram_business_basic,instagram_business_content_publish',
    )
    expect(mocks.createOAuthTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        requestedScopes: ['instagram_business_basic', 'instagram_business_content_publish'],
      }),
    )
  })

  it('redirects with extended scopes when extended=1 and caller is allowlisted owner', async () => {
    mockSupabase('owner')
    const req = new NextRequest(
      `https://example.com/api/channels/oauth/instagram/authorize?workspaceId=${allowlistedWorkspaceId}&extended=1`,
    )
    const res = await GET(req)

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('scope')).toBe(
      'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_messages,instagram_business_manage_insights',
    )
    expect(mocks.createOAuthTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
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

  it('redirects with base scopes when extended=1 is requested by a non-allowlisted workspace', async () => {
    mockSupabase('owner')
    const req = new NextRequest(
      `https://example.com/api/channels/oauth/instagram/authorize?workspaceId=${nonAllowlistedWorkspaceId}&extended=1`,
    )
    const res = await GET(req)

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('scope')).toBe(
      'instagram_business_basic,instagram_business_content_publish',
    )
  })
})
