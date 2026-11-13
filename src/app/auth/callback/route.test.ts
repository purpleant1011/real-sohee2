import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { exchangeCodeForSession, rpc, adminRpc, from, maybeSingle, limit, select, eq, recordFunnelEvent, createAdminSupabaseClient } = vi.hoisted(() => {
  const adminRpc = vi.fn().mockResolvedValue({ data: { granted: true, credits_granted: 1000 }, error: null })
  return {
    exchangeCodeForSession: vi.fn(),
    rpc: vi.fn(),
    adminRpc,
    from: vi.fn(),
    maybeSingle: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    recordFunnelEvent: vi.fn().mockResolvedValue(undefined),
    createAdminSupabaseClient: vi.fn(() => ({ rpc: adminRpc })),
  }
})

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { exchangeCodeForSession },
    rpc,
    from,
  })),
}))

vi.mock('@/features/quick-start/funnel-events', () => ({ recordFunnelEvent }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient }))

import { GET } from './route'

describe('auth callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { id: 'u1', app_metadata: { provider: 'google' } } } },
      error: null,
    })
    from.mockReturnValue({ select, eq, limit, maybeSingle })
    select.mockReturnValue({ eq, limit, maybeSingle })
    eq.mockReturnValue({ eq, limit, maybeSingle })
    limit.mockResolvedValue({ data: [], error: null })
    maybeSingle.mockResolvedValue({ data: null, error: null })
    rpc.mockResolvedValue({ data: { success: true, workspace_id: 'ws-new', is_new_workspace: true }, error: null })
  })

  it('returns a valid code to the fixed admin setup path for existing members', async () => {
    limit.mockResolvedValueOnce({ data: [{ workspace_id: 'ws-existing' }], error: null })
    maybeSingle.mockResolvedValueOnce({ data: { business_name: '카페' }, error: null })
    const response = await GET(new NextRequest(
      'http://localhost:3000/auth/callback?code=valid-code&next=%2Fauth%2Fadmin-setup',
    ))

    expect(response.headers.get('location')).toBe('http://localhost:3000/auth/admin-setup')
    expect(exchangeCodeForSession).toHaveBeenCalledWith('valid-code')
  })

  it('provisions a first-time Google user, records the signup event, and sends them directly to /start', async () => {
    const response = await GET(new NextRequest(
      'http://localhost:3000/auth/callback?code=valid-code&next=%2Fsignup%3Fstep%3Dbusiness',
    ))
    expect(rpc).toHaveBeenCalledWith('provision_signup_workspace', {
      p_user_id: 'u1', p_provider: 'google',
    })
    // ANI-1761 AC-3: 구글 로그인 성공 복귀는 /start 에서 한 번 알린다.
    expect(response.headers.get('location')).toBe('http://localhost:3000/start?connected=1')
    expect(createAdminSupabaseClient).toHaveBeenCalledOnce()
    expect(recordFunnelEvent).toHaveBeenCalledWith(expect.objectContaining({
      admin: expect.anything(), workspaceId: 'ws-new', userId: 'u1', event: 'signup_completed',
      dedupeKey: 'signup_completed:u1',
    }))
  })

  it('keeps the signup redirect when funnel telemetry throws', async () => {
    recordFunnelEvent.mockRejectedValueOnce(new Error('telemetry unavailable'))
    const response = await GET(new NextRequest('http://localhost:3000/auth/callback?code=valid-code'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/start?connected=1')
  })

  it('does not record signup completion when provisioning says the workspace already existed', async () => {
    rpc.mockResolvedValueOnce({ data: { workspace_id: 'ws-existing', is_new_workspace: false }, error: null })
    const response = await GET(new NextRequest('http://localhost:3000/auth/callback?code=valid-code'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/start?connected=1')
    expect(recordFunnelEvent).not.toHaveBeenCalled()
  })

  it('keeps an existing member on their requested app route without granting again', async () => {
    limit.mockResolvedValueOnce({ data: [{ workspace_id: 'ws-existing' }], error: null })
    maybeSingle.mockResolvedValueOnce({ data: { business_name: '카페' }, error: null })
    const response = await GET(new NextRequest('http://localhost:3000/auth/callback?code=valid-code&next=%2Fapp'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/app')
    expect(rpc).not.toHaveBeenCalled()
    expect(adminRpc).toHaveBeenCalledWith('ensure_signup_starter_credits', {
      p_user_id: 'u1',
      p_workspace_id: 'ws-existing',
    })
  })

  it('calls ensure_signup_starter_credits for existing member with 0 credits and continues route', async () => {
    limit.mockResolvedValueOnce({ data: [{ workspace_id: 'ws-existing-zero-credit' }], error: null })
    maybeSingle.mockResolvedValueOnce({ data: { business_name: '카페' }, error: null })
    adminRpc.mockResolvedValueOnce({ data: { granted: true, credits_granted: 1000, already: false }, error: null })

    const response = await GET(new NextRequest('http://localhost:3000/auth/callback?code=valid-code&next=%2Fapp'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/app')
    expect(adminRpc).toHaveBeenCalledWith('ensure_signup_starter_credits', {
      p_user_id: 'u1',
      p_workspace_id: 'ws-existing-zero-credit',
    })
  })

  it('keeps login flow even if ensure_signup_starter_credits throws for existing member', async () => {
    limit.mockResolvedValueOnce({ data: [{ workspace_id: 'ws-existing-zero-credit' }], error: null })
    maybeSingle.mockResolvedValueOnce({ data: { business_name: '카페' }, error: null })
    adminRpc.mockRejectedValueOnce(new Error('RPC network fail'))

    const response = await GET(new NextRequest('http://localhost:3000/auth/callback?code=valid-code&next=%2Fapp'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/app')
  })

  it('sends an existing owner who explicitly requested /start to the quick-start wizard', async () => {
    limit.mockResolvedValueOnce({ data: [{ workspace_id: 'ws-existing' }], error: null })
    maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const response = await GET(new NextRequest('http://localhost:3000/auth/callback?code=valid-code&next=%2Fstart'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/start')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not provision a workspace for password reset callbacks', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/auth/callback?code=valid-code&next=%2Freset-password'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/reset-password')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('keeps legacy verification-in-progress signups on their existing flow', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: '기존 가입 절차를 계속 진행해 주세요. (SIGNUP_IN_PROGRESS)' } })
    const response = await GET(new NextRequest('http://localhost:3000/auth/callback?code=valid-code'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/signup?step=business')
  })

  // ANI-1761 AC-3: 구글에서 돌아왔지만 세션이 없을 때 — 취소와 실패를 구분해 넘긴다.
  describe('세션 없는 복귀', () => {
    it('취소(access_denied)는 로그인 화면에 취소로 표시해 넘긴다', async () => {
      const response = await GET(new NextRequest(
        'http://localhost:3000/auth/callback?error=access_denied&next=%2Fapp',
      ))

      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/login?oauth=cancelled&next=%2Fapp',
      )
    })

    it('그 밖의 오류는 실패로 표시해 넘긴다', async () => {
      const response = await GET(new NextRequest(
        'http://localhost:3000/auth/callback?error=server_error&next=%2Fapp',
      ))

      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/login?oauth=failed&next=%2Fapp',
      )
    })

    it('가입 흐름에서는 방금 채운 정보가 남도록 /signup 으로 되돌린다', async () => {
      const cancelled = await GET(new NextRequest(
        'http://localhost:3000/auth/callback?error=access_denied&next=%2Fstart',
      ))
      const failed = await GET(new NextRequest(
        'http://localhost:3000/auth/callback?next=%2Fstart',
      ))

      expect(cancelled.headers.get('location')).toBe(
        'http://localhost:3000/signup?error=access_denied&next=%2Fstart',
      )
      expect(failed.headers.get('location')).toBe(
        'http://localhost:3000/signup?error=server_error&next=%2Fstart',
      )
    })
  })

  it('fails closed if provisioning fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } })
    const response = await GET(new NextRequest('http://localhost:3000/auth/callback?code=valid-code'))
    expect(response.headers.get('location')).toBe('http://localhost:3000/login?error=callback_exception')
  })

  it.each([
    'https%3A%2F%2Fevil.example',
    '%2Fauth%2Fadmin-setup%3Fnext%3Dhttps%3A%2F%2Fevil.example',
  ])('falls back safely for unsafe next input: %s', async (next) => {
    limit.mockResolvedValueOnce({ data: [{ workspace_id: 'ws-existing' }], error: null })
    maybeSingle.mockResolvedValueOnce({ data: { business_name: '카페' }, error: null })
    const response = await GET(new NextRequest(
      `http://localhost:3000/auth/callback?code=valid-code&next=${next}`,
    ))

    expect(response.headers.get('location')).toBe('http://localhost:3000/app')
  })

  it('exchangeCodeForSession 실패 시 에러를 로깅하고 낡은 auth-token 쿠키를 삭제하며 리다이렉트한다', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null },
      error: { name: 'AuthApiError', message: 'invalid flow state, no code verifier found', status: 400 },
    })

    const request = new NextRequest('http://localhost:3000/auth/callback?code=bad-code', {
      headers: {
        cookie: 'sb-custom-auth-token=stale-val; sb-custom-auth-token.0=chunk0; sb-custom-auth-token-code-verifier=keep-verifier; other=123',
      },
    })

    const response = await GET(request)

    expect(response.headers.get('location')).toBe('http://localhost:3000/login?error=exchange_failed')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[auth/callback] Code exchange error:',
      expect.objectContaining({
        name: 'AuthApiError',
        message: 'invalid flow state, no code verifier found',
        status: 400,
      }),
    )

    // Set-Cookie 헤더 확인
    const setCookieHeaders = response.headers.getSetCookie()
    expect(setCookieHeaders.some((c) => c.startsWith('sb-custom-auth-token='))).toBe(true)
    expect(setCookieHeaders.some((c) => c.startsWith('sb-custom-auth-token.0='))).toBe(true)
    // verifier 쿠키는 Set-Cookie 삭제에 포함되지 않아야 함
    expect(setCookieHeaders.some((c) => c.includes('code-verifier'))).toBe(false)
    // Max-Age=0 포함 확인
    const staleCookieHeader = setCookieHeaders.find((c) => c.startsWith('sb-custom-auth-token='))
    expect(staleCookieHeader).toMatch(/Max-Age=0/i)

    consoleErrorSpy.mockRestore()
  })
})
