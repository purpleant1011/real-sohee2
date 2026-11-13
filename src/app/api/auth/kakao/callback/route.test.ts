import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exchangeKakaoCodeForToken: vi.fn(),
  fetchKakaoUserProfile: vi.fn(),
  listUsers: vi.fn(),
  createUser: vi.fn(),
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
  clientRpc: vi.fn(),
  adminRpc: vi.fn(),
  clientFrom: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn(),
  recordFunnelEvent: vi.fn(),
}))

vi.mock('@/features/kakao/oauth/token', () => ({
  exchangeKakaoCodeForToken: mocks.exchangeKakaoCodeForToken,
  fetchKakaoUserProfile: mocks.fetchKakaoUserProfile,
  sanitizeAuthErrorMessage: (msg: string) => msg,
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: any) => ({
    auth: {
      verifyOtp: vi.fn(async (params: any) => {
        const res = await mocks.verifyOtp(params)
        if (res.data?.session && options?.cookies?.setAll) {
          options.cookies.setAll([
            { name: 'sb-custom-auth-token', value: 'session-token-value', options: {} },
          ])
        }
        return res
      }),
    },
    rpc: mocks.clientRpc,
    from: mocks.clientFrom,
  })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    auth: {
      admin: {
        listUsers: mocks.listUsers,
        createUser: mocks.createUser,
        generateLink: mocks.generateLink,
      },
    },
    rpc: mocks.adminRpc,
  })),
}))

vi.mock('@/features/quick-start/funnel-events', () => ({
  recordFunnelEvent: mocks.recordFunnelEvent,
}))

import { GET } from './route'
import { createOAuthState } from '@/features/kakao/oauth/state'

describe('GET /api/auth/kakao/callback', () => {
  const originalEnv = process.env
  const stateSecret = 'test-state-secret-1234'
  const clientSecret = 'test-client-secret-5678'
  const redirectUri = 'http://localhost:3000/api/auth/kakao/callback'

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = {
      ...originalEnv,
      KAKAO_LOGIN_ENABLED: 'true',
      NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dummy_key_123',
      KAKAO_JS_KEY: 'test-js-key',
      KAKAO_REST_API_KEY: 'test-rest-key',
      KAKAO_CLIENT_SECRET: clientSecret,
      KAKAO_STATE_SECRET: stateSecret,
      KAKAO_ALLOWED_ORIGINS: 'http://localhost:3000',
      KAKAO_REDIRECT_URIS: redirectUri,
    }

    mocks.exchangeKakaoCodeForToken.mockResolvedValue({
      ok: true,
      tokens: {
        access_token: 'valid_access_token',
        token_type: 'bearer',
        refresh_token: 'valid_refresh_token',
        expires_in: 3600,
      },
    })

    mocks.fetchKakaoUserProfile.mockResolvedValue({
      ok: true,
      profile: {
        id: 987654,
        kakao_account: {
          email: 'kakao_user@example.com',
          is_email_verified: true,
          is_email_valid: true,
          profile: { nickname: '카카오유저' },
        },
      },
    })

    // 기본적으로 카카오 사용자 이미 존재 (기존 회원 시나리오: createUser email_exists -> generateLink 사용자 반환)
    mocks.createUser.mockResolvedValue({
      data: null,
      error: { code: 'email_exists', message: 'User already exists' },
    })

    mocks.generateLink.mockResolvedValue({
      data: {
        user: {
          id: 'kakao-user-1',
          email: 'kakao_user@example.com',
          identities: [{ provider: 'kakao', id: '987654' }],
        },
        properties: {
          hashed_token: 'valid_hashed_token',
        },
      },
      error: null,
    })

    mocks.verifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: 'sb_access_token',
          refresh_token: 'sb_refresh_token',
          user: { id: 'kakao-user-1' },
        },
        user: { id: 'kakao-user-1' },
      },
      error: null,
    })

    const select = vi.fn().mockReturnThis()
    const eq = vi.fn().mockReturnThis()
    mocks.clientFrom.mockReturnValue({
      select,
      eq,
      limit: mocks.limit,
      maybeSingle: mocks.maybeSingle,
    })

    // 기존 워크스페이스 있음
    mocks.limit.mockResolvedValue({
      data: [{ workspace_id: 'ws-existing-123' }],
      error: null,
    })

    mocks.maybeSingle.mockResolvedValue({
      data: { business_name: '우리 카페' },
      error: null,
    })

    mocks.adminRpc.mockResolvedValue({ data: { granted: true }, error: null })
    mocks.clientRpc.mockResolvedValue({
      data: { success: true, workspace_id: 'ws-new-123', is_new_workspace: true },
      error: null,
    })
  })

  it('환경변수가 누락된 경우 503을 반환한다', async () => {
    delete process.env.KAKAO_REST_API_KEY

    const req = new NextRequest('http://localhost:3000/api/auth/kakao/callback?code=abc&state=xyz')
    const res = await GET(req)

    expect(res.status).toBe(503)
  })

  it('KAKAO_STATE_SECRET이 누락된 경우 503을 반환한다 (clientSecret 재사용 금지)', async () => {
    delete process.env.KAKAO_STATE_SECRET

    const req = new NextRequest('http://localhost:3000/api/auth/kakao/callback?code=abc&state=xyz')
    const res = await GET(req)

    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.error).toBe('service_unavailable')
  })

  it('state 쿠키가 누락되었거나 일치하지 않으면 /login?error=invalid_state 로 리다이렉트하고 쿠키를 정리한다', async () => {
    const { state } = await createOAuthState({ redirectUri, secret: stateSecret })

    const reqNoCookie = new NextRequest(
      `http://localhost:3000/api/auth/kakao/callback?code=abc&state=${state}`,
    )
    const resNoCookie = await GET(reqNoCookie)

    expect(resNoCookie.status).toBe(307)
    const location = new URL(resNoCookie.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('error')).toBe('invalid_state')

    const setCookie = resNoCookie.headers.get('set-cookie')
    expect(setCookie).toContain('kakao_oauth_state=')
    expect(setCookie).toContain('Max-Age=0')
  })

  it('만료되었거나 변조된 state는 /login?error=invalid_state 로 리다이렉트한다', async () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 400
    const { state } = await createOAuthState({
      redirectUri,
      secret: stateSecret,
      ttlSeconds: 10,
      now: pastTimestamp,
    })

    const req = new NextRequest(
      `http://localhost:3000/api/auth/kakao/callback?code=abc&state=${state}`,
      {
        headers: {
          cookie: `kakao_oauth_state=${state}`,
        },
      },
    )

    const res = await GET(req)
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('error')).toBe('invalid_state')
  })

  it('동일 이메일을 가진 다른 가입 방식(구글 등) 계정이 존재하면 계정 병합을 차단한다', async () => {
    const { state } = await createOAuthState({ redirectUri, secret: stateSecret, next: '/app' })

    mocks.createUser.mockResolvedValueOnce({
      data: null,
      error: { code: 'email_exists', message: 'User already exists' },
    })

    mocks.generateLink.mockResolvedValueOnce({
      data: {
        user: {
          id: 'google-user-123',
          email: 'kakao_user@example.com',
          app_metadata: { provider: 'google' },
          identities: [{ provider: 'google', id: 'g123' }],
        },
      },
      error: null,
    })

    const req = new NextRequest(
      `http://localhost:3000/api/auth/kakao/callback?code=abc&state=${state}`,
      {
        headers: {
          cookie: `kakao_oauth_state=${state}`,
        },
      },
    )

    const res = await GET(req)
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('error')).toBe('account_linking_prohibited')
  })

  it('createUser 일반 오류 시 /login?error=session_failed 로 리다이렉트한다', async () => {
    const { state } = await createOAuthState({ redirectUri, secret: stateSecret, next: '/app' })

    mocks.createUser.mockResolvedValueOnce({
      data: null,
      error: { code: 'unexpected_error', message: 'Supabase 500' },
    })

    const req = new NextRequest(
      `http://localhost:3000/api/auth/kakao/callback?code=abc&state=${state}`,
      {
        headers: {
          cookie: `kakao_oauth_state=${state}`,
        },
      },
    )

    const res = await GET(req)
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('error')).toBe('session_failed')
  })

  it('토큰 교환 실패 시 /login?error=token_exchange_failed 로 안전하게 리다이렉트한다', async () => {
    const { state } = await createOAuthState({ redirectUri, secret: stateSecret })

    mocks.exchangeKakaoCodeForToken.mockResolvedValue({
      ok: false,
      error: 'invalid_grant',
      reason: 'Redacted error reason',
    })

    const req = new NextRequest(
      `http://localhost:3000/api/auth/kakao/callback?code=bad_code&state=${state}`,
      {
        headers: {
          cookie: `kakao_oauth_state=${state}`,
        },
      },
    )

    const res = await GET(req)
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('error')).toBe('token_exchange_failed')
  })

  it('세션 발급(generateLink) 실패 시 /app으로 보내지 않고 /login?error=session_failed 로 안전 실패한다', async () => {
    const { state } = await createOAuthState({ redirectUri, secret: stateSecret, next: '/app' })

    // resolveKakaoUser 단계의 generateLink 성공
    mocks.generateLink.mockResolvedValueOnce({
      data: {
        user: {
          id: 'kakao-user-1',
          email: 'kakao_user@example.com',
          identities: [{ provider: 'kakao', id: '987654' }],
        },
      },
      error: null,
    })

    // issueKakaoSupabaseSession 단계의 generateLink 실패
    mocks.generateLink.mockResolvedValueOnce({
      data: null,
      error: { message: 'Link generation failed' },
    })

    const req = new NextRequest(
      `http://localhost:3000/api/auth/kakao/callback?code=valid_code&state=${state}`,
      {
        headers: {
          cookie: `kakao_oauth_state=${state}`,
        },
      },
    )

    const res = await GET(req)
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('error')).toBe('session_failed')
  })

  it('세션 발급(verifyOtp) 실패 시 /app으로 보내지 않고 /login?error=session_failed 로 안전 실패한다', async () => {
    const { state } = await createOAuthState({ redirectUri, secret: stateSecret, next: '/app' })

    mocks.verifyOtp.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Invalid OTP' },
    })

    const req = new NextRequest(
      `http://localhost:3000/api/auth/kakao/callback?code=valid_code&state=${state}`,
      {
        headers: {
          cookie: `kakao_oauth_state=${state}`,
        },
      },
    )

    const res = await GET(req)
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('error')).toBe('session_failed')
  })

  it('기존 카카오 회원 로그인 시 세션 쿠키를 굽고 요청된 next 경로로 리다이렉트하며 starter credits를 보장한다', async () => {
    const { state } = await createOAuthState({
      redirectUri,
      secret: stateSecret,
      next: '/app/posts',
    })

    const req = new NextRequest(
      `http://localhost:3000/api/auth/kakao/callback?code=valid_code&state=${state}`,
      {
        headers: {
          cookie: `kakao_oauth_state=${state}`,
        },
      },
    )

    const res = await GET(req)
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/app/posts')

    // 세션 쿠키 발급 확인
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('sb-custom-auth-token=session-token-value')

    // state 쿠키 정리 확인
    expect(setCookie).toContain('kakao_oauth_state=')
    expect(setCookie).toContain('Max-Age=0')

    // 기존 사용자 스타터 크레딧 호출 확인
    expect(mocks.adminRpc).toHaveBeenCalledWith('ensure_signup_starter_credits', {
      p_user_id: 'kakao-user-1',
      p_workspace_id: 'ws-existing-123',
    })
  })

  it('신규 카카오 회원인 경우 사용자를 생성하고 워크스페이스를 프로비저닝한 후 /start?connected=kakao 로 안내한다', async () => {
    const { state } = await createOAuthState({
      redirectUri,
      secret: stateSecret,
      next: '/start',
    })

    // 신규 회원이므로 createUser 성공
    mocks.createUser.mockResolvedValueOnce({
      data: {
        user: {
          id: 'new-kakao-user-1',
          email: 'kakao_user@example.com',
          app_metadata: { provider: 'kakao' },
        },
      },
      error: null,
    })

    mocks.verifyOtp.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'sb_new_token',
          user: { id: 'new-kakao-user-1' },
        },
        user: { id: 'new-kakao-user-1' },
      },
      error: null,
    })

    // 신규 회원이므로 기존 워크스페이스 없음
    mocks.limit.mockResolvedValueOnce({
      data: [],
      error: null,
    })

    mocks.clientRpc.mockResolvedValueOnce({
      data: { success: true, workspace_id: 'ws-newly-created', is_new_workspace: true },
      error: null,
    })

    const req = new NextRequest(
      `http://localhost:3000/api/auth/kakao/callback?code=valid_code&state=${state}`,
      {
        headers: {
          cookie: `kakao_oauth_state=${state}`,
        },
      },
    )

    const res = await GET(req)
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/start')
    expect(location.searchParams.get('connected')).toBe('kakao')

    // createUser 호출 확인
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'kakao_user@example.com',
        app_metadata: expect.objectContaining({ provider: 'kakao' }),
      }),
    )

    // provision_signup_workspace 호출 확인
    expect(mocks.clientRpc).toHaveBeenCalledWith('provision_signup_workspace', {
      p_user_id: 'new-kakao-user-1',
      p_provider: 'kakao',
    })

    // 세션 쿠키 설정 확인
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('sb-custom-auth-token=session-token-value')
  })

  it('KAKAO_LOGIN_ENABLED 가 true 가 아니면 콜백도 404 로 비활성화된다', async () => {
    delete process.env.KAKAO_LOGIN_ENABLED
    const res = await GET(new NextRequest('http://localhost:3000/api/auth/kakao/callback?code=x&state=y'))
    expect(res.status).toBe(404)
  })
})
