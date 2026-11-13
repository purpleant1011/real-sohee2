import { describe, expect, it } from 'vitest'
import type { KakaoConfig } from '../config/kakao-config'
import { buildKakaoAuthorizeUrl } from './authorize'

describe('Kakao Authorize URL Builder', () => {
  const validConfig: KakaoConfig = {
    jsKey: 'test-js-key',
    restApiKey: 'test-rest-api-key-1234',
    clientSecret: 'test-client-secret-5678',
    allowedOrigins: ['https://example.com'],
    redirectUris: [
      'https://example.com/api/auth/kakao/callback',
      'http://localhost:3000/api/auth/kakao/callback',
    ],
  }

  it('허용된 redirect URI와 유효한 state로 올바른 카카오 authorize URL을 생성한다', () => {
    const result = buildKakaoAuthorizeUrl({
      config: validConfig,
      redirectUri: 'https://example.com/api/auth/kakao/callback',
      state: 'signed-state-token',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const parsed = new URL(result.url)
    expect(parsed.origin).toBe('https://kauth.kakao.com')
    expect(parsed.pathname).toBe('/oauth/authorize')
    expect(parsed.searchParams.get('client_id')).toBe('test-rest-api-key-1234')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://example.com/api/auth/kakao/callback')
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('state')).toBe('signed-state-token')
  })

  it('isAllowedRedirect 검증을 통과하지 못하는 허용되지 않은 redirect URI는 거부한다 (오픈 리다이렉트 방지)', () => {
    const disallowedUris = [
      'https://malicious.com/callback',
      'https://example.com/api/auth/kakao/callback?extra=1',
      'http://example.com/api/auth/kakao/callback', // http non-localhost
      'javascript:alert(1)',
      '',
    ]

    for (const uri of disallowedUris) {
      const result = buildKakaoAuthorizeUrl({
        config: validConfig,
        redirectUri: uri,
        state: 'signed-state-token',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('disallowed_redirect_uri')
      }
    }
  })

  it('state가 누락되었거나 빈 문자열이면 거부한다', () => {
    const result = buildKakaoAuthorizeUrl({
      config: validConfig,
      redirectUri: 'https://example.com/api/auth/kakao/callback',
      state: '',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('missing_state')
    }
  })

  it('추가 scope 파라미터가 주어지면 URL에 포함한다', () => {
    const result = buildKakaoAuthorizeUrl({
      config: validConfig,
      redirectUri: 'https://example.com/api/auth/kakao/callback',
      state: 'signed-state-token',
      scope: ['account_email', 'profile_nickname'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const parsed = new URL(result.url)
    expect(parsed.searchParams.get('scope')).toBe('account_email profile_nickname')
  })
})
