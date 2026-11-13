import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'

describe('GET /api/internal/meta-readiness', () => {
  const VALID_SECRET = 'a_very_long_cron_secret_key_1234567890'
  let origEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    origEnv = { ...process.env }
    process.env.CRON_SECRET = VALID_SECRET
    delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
  })

  afterEach(() => {
    process.env = origEnv
    vi.clearAllMocks()
  })

  it('returns 404 when authorization header is missing or invalid', async () => {
    const reqNoAuth = new Request('http://localhost/api/internal/meta-readiness')
    const resNoAuth = await GET(reqNoAuth)
    expect(resNoAuth.status).toBe(404)
    expect(await resNoAuth.json()).toEqual({ error: 'not_found' })

    const reqWrongToken = new Request('http://localhost/api/internal/meta-readiness', {
      headers: { authorization: 'Bearer wrong_token_value_00000000000' },
    })
    const resWrongToken = await GET(reqWrongToken)
    expect(resWrongToken.status).toBe(404)
  })

  it('returns 404 if CRON_SECRET is shorter than 20 characters', async () => {
    process.env.CRON_SECRET = 'short_secret'
    const req = new Request('http://localhost/api/internal/meta-readiness', {
      headers: { authorization: 'Bearer short_secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('returns only booleans, enums, counts, and missing secret names without leaking secrets', async () => {
    process.env.META_APP_MODE = 'live'
    process.env.META_APP_REVIEW_STATUS = 'APPROVED'
    process.env.META_ACCESS_TIER = 'advanced'
    process.env.VAULT_PUBLISH_ENABLED = '1'
    process.env.ENGAGEMENT_CYCLE_ENABLED = '0'
    process.env.ENGAGEMENT_SEND_ENABLED = '1'
    delete process.env.ENGAGEMENT_DM_INGEST_ENABLED
    process.env.META_APP_ID = 'app_id_123'
    // Intentionally omit META_APP_SECRET and encryption keys to verify missing list
    delete process.env.META_APP_SECRET
    delete process.env.INSTAGRAM_APP_SECRET
    delete process.env.THREADS_APP_SECRET
    delete process.env.META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY
    delete process.env.META_OAUTH_STATE_ENCRYPTION_KEY

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  provider: 'threads',
                  status: 'active',
                  token_expires_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
                  granted_scopes: ['threads_basic', 'threads_content_publish'],
                },
                {
                  provider: 'instagram',
                  status: 'active',
                  token_expires_at: new Date(Date.now() + 12 * 3600 * 1000).toISOString(), // expired < 24h
                  granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockSupabase as never)

    const req = new Request('http://localhost/api/internal/meta-readiness', {
      headers: { authorization: `Bearer ${VALID_SECRET}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      meta_app_mode_live: true,
      meta_app_review_approved: true,
      meta_access_tier_advanced: true,
      vault_publish_enabled: true,
      engagement_cycle_enabled: false,
      engagement_send_enabled: true,
      engagement_dm_ingest_enabled: false,
      live_allowlist_configured: false,
      live_allowlist_all: false,
      live_allowlist_count: 0,
      engagement_allowlist_configured: false,
      engagement_allowlist_all: false,
      engagement_allowlist_count: 0,
      missing_secrets: expect.arrayContaining([
        'META_APP_SECRET',
        'META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY',
        'META_OAUTH_STATE_ENCRYPTION_KEY',
      ]),
      connected_channels_count: 1, // Only threads qualifies (>24h remaining)
      engagement_comment_ready_channels_count: 0, // threads lacks threads_manage_replies; instagram token < 24h
      engagement_dm_ready_channels_count: 0,
    })

    // Assert zero secret values leak in payload
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(VALID_SECRET)
    expect(serialized).not.toContain('app_id_123')
  })

  it('reflects allowlist metrics correctly when configured with UUIDs or wildcard', async () => {
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '00000000-0000-4000-8000-0000000000a1, 00000000-0000-4000-8000-0000000000a2'

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    }
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockSupabase as never)

    const req = new Request('http://localhost/api/internal/meta-readiness', {
      headers: { authorization: `Bearer ${VALID_SECRET}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.live_allowlist_configured).toBe(true)
    expect(body.live_allowlist_all).toBe(false)
    expect(body.live_allowlist_count).toBe(2)

    // Wildcard test
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
    const resWildcard = await GET(req)
    const bodyWildcard = await resWildcard.json()
    expect(bodyWildcard.live_allowlist_configured).toBe(true)
    expect(bodyWildcard.live_allowlist_all).toBe(true)
    expect(bodyWildcard.live_allowlist_count).toBe(0)
  })

  it('reflects engagement allowlist metrics correctly when configured with UUIDs, wildcard, or unset', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    }
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockSupabase as never)

    const req = new Request('http://localhost/api/internal/meta-readiness', {
      headers: { authorization: `Bearer ${VALID_SECRET}` },
    })

    // Unset
    delete process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST
    const resUnset = await GET(req)
    const bodyUnset = await resUnset.json()
    expect(bodyUnset.engagement_allowlist_configured).toBe(false)
    expect(bodyUnset.engagement_allowlist_all).toBe(false)
    expect(bodyUnset.engagement_allowlist_count).toBe(0)

    // UUID 2개
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST =
      '00000000-0000-4000-8000-0000000000a1, 00000000-0000-4000-8000-0000000000a2'
    const resTwo = await GET(req)
    const bodyTwo = await resTwo.json()
    expect(bodyTwo.engagement_allowlist_configured).toBe(true)
    expect(bodyTwo.engagement_allowlist_all).toBe(false)
    expect(bodyTwo.engagement_allowlist_count).toBe(2)

    // Wildcard *
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*'
    const resWildcard = await GET(req)
    const bodyWildcard = await resWildcard.json()
    expect(bodyWildcard.engagement_allowlist_configured).toBe(true)
    expect(bodyWildcard.engagement_allowlist_all).toBe(true)
    expect(bodyWildcard.engagement_allowlist_count).toBe(0)
  })

  it('counts channels that hold comment/reply and DM scopes with a valid token', async () => {
    const future = new Date(Date.now() + 72 * 3600 * 1000).toISOString()
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  provider: 'instagram',
                  status: 'active',
                  token_expires_at: future,
                  // legacy scope names must be accepted through normalization
                  granted_scopes: ['instagram_business_basic', 'instagram_manage_comments', 'instagram_manage_messages'],
                },
                {
                  provider: 'threads',
                  status: 'active',
                  token_expires_at: future,
                  granted_scopes: ['threads_basic', 'threads_manage_replies'],
                },
                {
                  provider: 'instagram',
                  status: 'active',
                  token_expires_at: future,
                  granted_scopes: ['instagram_business_basic'], // no comment/DM scope
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockSupabase as never)

    const res = await GET(
      new Request('http://localhost/api/internal/meta-readiness', {
        headers: { authorization: `Bearer ${VALID_SECRET}` },
      }),
    )
    const body = await res.json()
    expect(body.engagement_comment_ready_channels_count).toBe(2) // instagram + threads
    expect(body.engagement_dm_ready_channels_count).toBe(1) // instagram only
  })

  it('reports the DM ingestion flag', async () => {
    process.env.ENGAGEMENT_DM_INGEST_ENABLED = '1'
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }) }) }),
    } as never)
    const res = await GET(new Request('http://localhost/api/internal/meta-readiness', { headers: { authorization: `Bearer ${VALID_SECRET}` } }))
    expect((await res.json()).engagement_dm_ingest_enabled).toBe(true)
  })
})
