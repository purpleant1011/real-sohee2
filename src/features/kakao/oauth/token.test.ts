import { describe, expect, it, vi } from 'vitest'
import type { KakaoConfig } from '../config/kakao-config'
import {
  exchangeKakaoCodeForToken,
  fetchKakaoUserProfile,
  sanitizeAuthErrorMessage,
} from './token'

describe('Kakao OAuth Token & User Profile', () => {
  const config: KakaoConfig = {
    jsKey: 'test-js-key',
    restApiKey: 'test-rest-api-key-secret-1234',
    clientSecret: 'super-confidential-client-secret-9999',
    allowedOrigins: ['https://example.com'],
    redirectUris: ['https://example.com/api/auth/kakao/callback'],
  }

  const mockTokenResponse = {
    access_token: 'kakao_access_token_abc123',
    token_type: 'bearer',
    refresh_token: 'kakao_refresh_token_xyz789',
    expires_in: 21599,
    scope: 'account_email profile_nickname',
    refresh_token_expires_in: 5183999,
  }

  it('fetch 주입을 통해 인가 코드를 토큰으로 정상 교환한다', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockTokenResponse,
    })

    const result = await exchangeKakaoCodeForToken({
      code: 'auth_code_123',
      redirectUri: 'https://example.com/api/auth/kakao/callback',
      config,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.tokens.access_token).toBe('kakao_access_token_abc123')
    expect(result.tokens.refresh_token).toBe('kakao_refresh_token_xyz789')
    expect(result.tokens.expires_in).toBe(21599)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://kauth.kakao.com/oauth/token')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded;charset=utf-8')

    const bodyParams = new URLSearchParams(init.body)
    expect(bodyParams.get('grant_type')).toBe('authorization_code')
    expect(bodyParams.get('client_id')).toBe('test-rest-api-key-secret-1234')
    expect(bodyParams.get('client_secret')).toBe('super-confidential-client-secret-9999')
    expect(bodyParams.get('code')).toBe('auth_code_123')
    expect(bodyParams.get('redirect_uri')).toBe('https://example.com/api/auth/kakao/callback')
  })

  it('카카오 서버 에러 응답 시 에러 메시지에서 토큰이나 시크릿이 절대 노출되지 않는다', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'invalid_grant',
        error_description: 'authorization code not found for secret super-confidential-client-secret-9999',
      }),
    })

    const result = await exchangeKakaoCodeForToken({
      code: 'invalid_code',
      redirectUri: 'https://example.com/api/auth/kakao/callback',
      config,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).not.toContain('super-confidential-client-secret-9999')
      expect(result.reason).not.toContain('test-rest-api-key-secret-1234')
      expect(result.error).toBe('invalid_grant')
    }
  })

  it('네트워크 예외 발생 시 안전하게 실패를 반환하며 시크릿을 누출하지 않는다', async () => {
    const mockFetch = vi.fn().mockRejectedValue(
      new Error('fetch failed with client_secret super-confidential-client-secret-9999'),
    )

    const result = await exchangeKakaoCodeForToken({
      code: 'code',
      redirectUri: 'https://example.com/api/auth/kakao/callback',
      config,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).not.toContain('super-confidential-client-secret-9999')
      expect(result.error).toBe('network_error')
    }
  })

  it('fetch 주입을 통해 사용자 프로필을 정상 조회한다', async () => {
    const mockProfile = {
      id: 12345678,
      connected_at: '2026-11-05T00:00:00Z',
      kakao_account: {
        email: 'user@kakao.com',
        is_email_verified: true,
        is_email_valid: true,
        profile: {
          nickname: '카카오사용자',
          profile_image_url: 'https://example.com/profile.jpg',
        },
      },
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockProfile,
    })

    const result = await fetchKakaoUserProfile({
      accessToken: 'kakao_access_token_abc123',
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.profile.id).toBe(12345678)
    expect(result.profile.kakao_account?.email).toBe('user@kakao.com')
    expect(result.profile.kakao_account?.profile?.nickname).toBe('카카오사용자')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://kapi.kakao.com/v2/user/me')
    expect(init.headers['Authorization']).toBe('Bearer kakao_access_token_abc123')
  })

  it('사용자 프로필 조회 실패 시 안전하게 처리하고 토큰을 노출하지 않는다', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        msg: 'this access token does not exist: kakao_access_token_abc123',
        code: -401,
      }),
    })

    const result = await fetchKakaoUserProfile({
      accessToken: 'kakao_access_token_abc123',
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).not.toContain('kakao_access_token_abc123')
    }
  })

  it('sanitizeAuthErrorMessage 는 민감한 시크릿과 토큰을 [REDACTED] 로 치환한다', () => {
    const sanitized = sanitizeAuthErrorMessage(
      'Auth failed for client_secret=secret123 and token=bearer_tok456',
      ['secret123', 'bearer_tok456'],
    )
    expect(sanitized).toBe('Auth failed for client_secret=[REDACTED] and token=[REDACTED]')
  })
})
