import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn()
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn()
}))
vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn()
}))
vi.mock('@/lib/providers/meta-api', () => ({
  createInstagramProvider: vi.fn(),
  createThreadsProvider: vi.fn(),
  getPublishedMetaPostPermalink: vi.fn().mockResolvedValue('https://instagram.com/p/Cxyz123'),
}))
vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn().mockResolvedValue({ blocked: false })
}))
vi.mock('@/features/sohee-ready/admission-guard', () => ({
  requireSoheeReady: vi.fn().mockResolvedValue({
    workspaceId: '10000000-0000-4000-8000-000000000001',
    ready: true,
    facts: {},
    blockers: [],
    evaluatedAt: new Date().toISOString(),
  }),
}))

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository'
import { createInstagramProvider } from '@/lib/providers/meta-api'
import { POST } from '@/app/api/channels/test-publish/route'

describe('Connection Verification Post & Read-After-Write (ANI-618)', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const userId = '20000000-0000-4000-8000-000000000001'

  let origAllowlist: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
  })

  afterEach(() => {
    if (origAllowlist !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  it('publishes a neutral verification post using server-only credentials and records VERIFIED receipt', async () => {
    const mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null })
      },
      from: vi.fn((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: workspaceId }], error: null })
              })
            })
          }
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'conn-1',
                      channel: 'instagram',
                      status: 'authorized',
                      external_account_id: 'ig-act-123',
                      account_label: '@sohee.beauty'
                    },
                    error: null
                  })
                })
              })
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null })
              })
            })
          }
        }
        const queryChain: any = {
          select: vi.fn(() => queryChain),
          eq: vi.fn(() => queryChain),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: { id: 'act-req-1' }, error: null }),
          insert: vi.fn().mockResolvedValue({ data: [{ id: 'mock-1' }], error: null }),
          update: vi.fn(() => queryChain),
        }
        return queryChain
      })
    }

    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockSupabase as any)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockSupabase as any)
    vi.mocked(loadChannelCredentialByChannel).mockResolvedValue({
      accessToken: 'decrypted-secure-token',
      externalAccountId: 'ig-act-123',
      provider: 'instagram',
      expiresAt: null
    } as any)

    const mockPublish = vi.fn().mockResolvedValue({
      success: true,
      providerPostId: 'media-post-999',
      destinationUrl: 'https://instagram.com/p/Cxyz123',
      rawResponse: { id: 'media-post-999' }
    })
    vi.mocked(createInstagramProvider).mockReturnValue({
      publish: mockPublish
    } as any)

    const req = new Request('http://localhost/api/channels/test-publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: 'INSTAGRAM' })
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.verified).toBe(true)
    expect(json.receipt.status).toBe('VERIFIED')
    expect(json.receipt.externalUrl).toBe('https://instagram.com/p/Cxyz123')
    expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'decrypted-secure-token',
      accountId: 'ig-act-123',
    }))
  })
})
