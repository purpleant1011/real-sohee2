import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/features/channels/dual-channel-verification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/channels/dual-channel-verification')>()
  return {
    ...actual,
    getPersistedChannelVerification: vi.fn(),
  }
})

vi.mock('@/features/channels/browser-channel-verification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/channels/browser-channel-verification')>()
  return {
    ...actual,
    getPersistedBrowserChannelState: vi.fn(),
  }
})

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getPersistedChannelVerification } from '@/features/channels/dual-channel-verification'
import { getPersistedBrowserChannelState } from '@/features/channels/browser-channel-verification'

const browserUnknown = {
  status: 'UNKNOWN' as const,
  verified: false,
  blockerMessage: '연결 상태를 확인하지 못했습니다.',
  accountLabel: null,
  connectedAccountMatches: null,
  lastCheckedAt: null,
}

describe('GET /api/channels (HF-38 Parity & Security)', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const userId = '20000000-0000-4000-8000-000000000001'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPersistedBrowserChannelState).mockResolvedValue(browserUnknown)
  })

  it('fails closed with 401 when session user is missing', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    } as any)

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toContain('인증 세션이 필요합니다')
  })

  it('fails closed with 404 when workspace membership is missing', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    } as any)

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toContain('워크스페이스를 찾을 수 없습니다')
  })

  it('calls getPersistedChannelVerification via server-only boundary without user client', async () => {
    const mockUserClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: workspaceId }], error: null }),
      }),
    }
    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockUserClient as any)

    vi.mocked(getPersistedChannelVerification).mockImplementation(async (wsId, ch) => ({
      status: 'VERIFIED',
      verified: true,
      evidence: {
        accountId: `${ch}-acc-1`,
        username: `${ch}_handle`,
        tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        scopes: [`${ch}_business_basic`],
        capabilityReceipt: { profileReadSuccess: true, publishQuotaVerified: true, probedAt: new Date().toISOString() },
      } as any,
    }))

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.dualVerified).toBe(true)
    expect(json.instagram.verified).toBe(true)
    expect(json.threads.verified).toBe(true)

    // Verify getPersistedChannelVerification was NOT called with user client (passed undefined for options/client)
    expect(getPersistedChannelVerification).toHaveBeenCalledWith(workspaceId, 'instagram')
    expect(getPersistedChannelVerification).toHaveBeenCalledWith(workspaceId, 'threads')

    // Verify sensitive properties are not returned in response
    expect(json.instagram.encrypted_access_token).toBeUndefined()
    expect(json.instagram.access_token_iv).toBeUndefined()
    expect(json.threads.encrypted_access_token).toBeUndefined()
    expect(json.threads.access_token_iv).toBeUndefined()
  })

  function mockWorkspaceSession(options?: { role?: string; workspaceId?: string }) {
    const wsId = options?.workspaceId ?? workspaceId
    const wsRole = options?.role ?? 'owner'
    const mockUserClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: wsId, role: wsRole, status: 'active' }], error: null }),
      }),
    }
    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockUserClient as any)
  }

  describe('extendedScopesAllowed server gate', () => {
    const allowlistedWs = '00000000-0000-4000-8000-0000000000a2'
    const nonAllowlistedWs = '11111111-2222-3333-4444-555555555555'

    beforeEach(() => {
      delete process.env.META_EXTENDED_SCOPE_WORKSPACE_IDS
      delete process.env.META_EXTENDED_SCOPES_FOR_ALL
      vi.mocked(getPersistedChannelVerification).mockResolvedValue({ status: 'NOT_CONNECTED', verified: false })
    })

    it('returns extendedScopesAllowed: true for allowlisted workspace owner', async () => {
      process.env.META_EXTENDED_SCOPE_WORKSPACE_IDS = allowlistedWs
      mockWorkspaceSession({ workspaceId: allowlistedWs, role: 'owner' })

      const res = await GET()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.extendedScopesAllowed).toBe(true)
    })

    it('returns extendedScopesAllowed: false for allowlisted workspace with viewer role', async () => {
      process.env.META_EXTENDED_SCOPE_WORKSPACE_IDS = allowlistedWs
      mockWorkspaceSession({ workspaceId: allowlistedWs, role: 'viewer' })

      const res = await GET()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.extendedScopesAllowed).toBe(false)
    })

    it('returns extendedScopesAllowed: false for non-allowlisted workspace with owner role', async () => {
      process.env.META_EXTENDED_SCOPE_WORKSPACE_IDS = allowlistedWs
      mockWorkspaceSession({ workspaceId: nonAllowlistedWs, role: 'owner' })

      const res = await GET()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.extendedScopesAllowed).toBe(false)
    })

    it('returns extendedScopesAllowed: true when META_EXTENDED_SCOPES_FOR_ALL=1', async () => {
      process.env.META_EXTENDED_SCOPES_FOR_ALL = '1'
      mockWorkspaceSession({ workspaceId: nonAllowlistedWs, role: 'owner' })

      const res = await GET()
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.extendedScopesAllowed).toBe(true)
    })
  })

  it('[ANI-1776] returns naver blog / naver place / daangn from persisted sources only', async () => {
    mockWorkspaceSession()
    vi.mocked(getPersistedChannelVerification).mockResolvedValue({ status: 'NOT_CONNECTED', verified: false })
    vi.mocked(getPersistedBrowserChannelState).mockImplementation(async (_wsId, channel) => (
      channel === 'naver_blog'
        ? {
            status: 'CONNECTED_UNVERIFIED',
            verified: false,
            blockerMessage: '네이버 블로그 계정 연결은 확인되었으나 게시 가능 여부는 아직 확인되지 않았습니다.',
            accountLabel: '바이름 블로그',
            connectedAccountMatches: null,
            lastCheckedAt: '2026-10-20T01:00:00.000Z',
          }
        : {
            status: 'READY_DEGRADED',
            verified: false,
            blockerMessage: '당근 연결 인증이 만료되었습니다.',
            accountLabel: null,
            connectedAccountMatches: null,
            lastCheckedAt: null,
          }
    ))

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.naverBlog).toMatchObject({
      status: 'CONNECTED_UNVERIFIED',
      verified: false,
      accountLabel: '바이름 블로그',
      lastCheckedAt: '2026-10-20T01:00:00.000Z',
    })
    expect(json.daangn).toMatchObject({ status: 'READY_DEGRADED', verified: false, lastCheckedAt: null })
    expect(getPersistedBrowserChannelState).toHaveBeenCalledWith(workspaceId, 'naver_blog')
    expect(getPersistedBrowserChannelState).toHaveBeenCalledWith(workspaceId, 'daangn_business')
  })

  it('[ANI-1776] keeps naver place UNKNOWN — no persisted server source exists', async () => {
    mockWorkspaceSession()
    vi.mocked(getPersistedChannelVerification).mockResolvedValue({ status: 'NOT_CONNECTED', verified: false })
    vi.mocked(getPersistedBrowserChannelState).mockResolvedValue({
      status: 'CONNECTED_UNVERIFIED',
      verified: false,
      accountLabel: '연결됨',
      connectedAccountMatches: null,
      lastCheckedAt: '2026-10-20T01:00:00.000Z',
    })

    const res = await GET()
    const json = await res.json()

    expect(json.naverPlace).toEqual({
      status: 'UNKNOWN',
      verified: false,
      supportedPublish: false,
      blockerMessage: '네이버 플레이스는 아직 연결 상태를 확인할 수 없습니다.',
      accountLabel: null,
      connectedAccountMatches: null,
      lastCheckedAt: null,
    })
  })

  it('[ANI-1707] supportedPublish 는 승인 정책 기준으로 채널마다 다르게 내려간다', async () => {
    mockWorkspaceSession()
    vi.mocked(getPersistedChannelVerification).mockResolvedValue({ status: 'NOT_CONNECTED', verified: false })
    vi.mocked(getPersistedBrowserChannelState).mockResolvedValue(browserUnknown)

    const res = await GET()
    const json = await res.json()

    // Meta 검증 경로가 있는 두 채널만 소희가 대신 게시하는 기능이 열려 있다.
    expect(json.instagram.supportedPublish).toBe(true)
    expect(json.threads.supportedPublish).toBe(true)
    // 연결되어 있어도 승인 정책이 외부 게시를 막는 채널.
    expect(json.naverBlog.supportedPublish).toBe(false)
    expect(json.daangn.supportedPublish).toBe(false)
    // 발행 경로 자체가 없는 채널.
    expect(json.naverPlace.supportedPublish).toBe(false)
  })

  it('[ANI-1776] never reports browser-connector channels as verified/publish-capable', async () => {
    mockWorkspaceSession()
    vi.mocked(getPersistedChannelVerification).mockResolvedValue({ status: 'NOT_CONNECTED', verified: false })
    vi.mocked(getPersistedBrowserChannelState).mockResolvedValue({
      status: 'CONNECTED_UNVERIFIED',
      verified: false,
      accountLabel: '연결됨',
      connectedAccountMatches: true,
      lastCheckedAt: '2026-10-20T01:00:00.000Z',
    })

    const res = await GET()
    const json = await res.json()

    expect(json.naverBlog.verified).toBe(false)
    expect(json.daangn.verified).toBe(false)
    expect(json.naverPlace.verified).toBe(false)
  })

  it('[ANI-1776] passes the server check time through and leaves it null when absent', async () => {
    mockWorkspaceSession()
    vi.mocked(getPersistedChannelVerification).mockImplementation(async (_wsId, channel) => (
      channel === 'instagram'
        ? { status: 'VERIFIED', verified: true, lastCheckedAt: '2026-10-21T03:04:05.000Z' }
        : { status: 'NOT_CONNECTED', verified: false }
    ))

    const res = await GET()
    const json = await res.json()

    expect(json.instagram.lastCheckedAt).toBe('2026-10-21T03:04:05.000Z')
    expect(json.threads.lastCheckedAt).toBeNull()
  })
})
