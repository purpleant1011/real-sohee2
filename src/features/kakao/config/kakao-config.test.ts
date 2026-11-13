import { describe, expect, it } from 'vitest'
import {
  isAllowedRedirect,
  loadKakaoConfig,
  toPublicKakaoConfig,
  type KakaoConfig,
} from './kakao-config'

describe('loadKakaoConfig', () => {
  const validEnv: Record<string, string> = {
    KAKAO_JS_KEY: 'test-js-key-12345',
    KAKAO_REST_API_KEY: 'test-rest-key-67890',
    KAKAO_CLIENT_SECRET: 'test-client-secret-abcde',
    KAKAO_ALLOWED_ORIGINS: 'https://example.com, https://sub.example.com,http://localhost:3000',
    KAKAO_REDIRECT_URIS:
      'https://example.com/oauth/kakao/callback, http://localhost:3000/oauth/kakao/callback',
  }

  it('parses valid environment variables into KakaoConfig', () => {
    const result = loadKakaoConfig(validEnv)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.config.jsKey).toBe('test-js-key-12345')
    expect(result.config.restApiKey).toBe('test-rest-key-67890')
    expect(result.config.clientSecret).toBe('test-client-secret-abcde')
    expect(result.config.allowedOrigins).toEqual([
      'https://example.com',
      'https://sub.example.com',
      'http://localhost:3000',
    ])
    expect(result.config.redirectUris).toEqual([
      'https://example.com/oauth/kakao/callback',
      'http://localhost:3000/oauth/kakao/callback',
    ])
  })

  it('returns explicit error result with reason when required keys are missing', () => {
    const missingKeys: (keyof typeof validEnv)[] = [
      'KAKAO_JS_KEY',
      'KAKAO_REST_API_KEY',
      'KAKAO_CLIENT_SECRET',
      'KAKAO_ALLOWED_ORIGINS',
      'KAKAO_REDIRECT_URIS',
    ]

    for (const key of missingKeys) {
      const invalidEnv = { ...validEnv }
      delete invalidEnv[key]

      const result = loadKakaoConfig(invalidEnv)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain(key)
      }
    }
  })

  it('returns explicit error result with reason when a key is empty or whitespace', () => {
    const result = loadKakaoConfig({
      ...validEnv,
      KAKAO_JS_KEY: '   ',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('KAKAO_JS_KEY')
    }
  })

  it('does not throw an exception on invalid inputs', () => {
    expect(() => loadKakaoConfig(undefined as unknown as Record<string, string>)).not.toThrow()
    expect(() => loadKakaoConfig({})).not.toThrow()
  })

  it('rejects insecure http redirect URIs that are not localhost', () => {
    const insecureEnv = {
      ...validEnv,
      KAKAO_REDIRECT_URIS: 'http://insecure.example.com/oauth/kakao/callback',
    }
    const result = loadKakaoConfig(insecureEnv)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/localhost|http/i)
    }
  })
})

describe('toPublicKakaoConfig', () => {
  const sampleConfig: KakaoConfig = {
    jsKey: 'public-js-key',
    restApiKey: 'secret-rest-api-key',
    clientSecret: 'secret-client-secret',
    allowedOrigins: ['https://example.com'],
    redirectUris: ['https://example.com/oauth/kakao/callback'],
  }

  it('exposes only jsKey and strictly omits secret keys', () => {
    const publicConfig = toPublicKakaoConfig(sampleConfig)

    expect(publicConfig).toEqual({
      jsKey: 'public-js-key',
    })
    expect('restApiKey' in publicConfig).toBe(false)
    expect('clientSecret' in publicConfig).toBe(false)
    expect((publicConfig as unknown as Record<string, unknown>).restApiKey).toBeUndefined()
    expect((publicConfig as unknown as Record<string, unknown>).clientSecret).toBeUndefined()
  })
})

describe('isAllowedRedirect', () => {
  const config: KakaoConfig = {
    jsKey: 'test-js-key',
    restApiKey: 'test-rest-key',
    clientSecret: 'test-client-secret',
    allowedOrigins: ['https://example.com', 'http://localhost:3000'],
    redirectUris: [
      'https://example.com/oauth/kakao/callback',
      'http://localhost:3000/oauth/kakao/callback',
      'http://127.0.0.1:8799/oauth/kakao/callback',
    ],
  }

  it('allows exact matches for registered https and localhost http URIs', () => {
    expect(isAllowedRedirect('https://example.com/oauth/kakao/callback', config)).toBe(true)
    expect(isAllowedRedirect('http://localhost:3000/oauth/kakao/callback', config)).toBe(true)
    expect(isAllowedRedirect('http://127.0.0.1:8799/oauth/kakao/callback', config)).toBe(true)
  })

  it('rejects partial matches, prefixes, and path extensions', () => {
    expect(isAllowedRedirect('https://example.com/oauth/kakao/callback/extra', config)).toBe(false)
    expect(isAllowedRedirect('https://example.com/oauth/kakao', config)).toBe(false)
    expect(isAllowedRedirect('https://example.com', config)).toBe(false)
  })

  it('rejects query parameter or hash tamperings not in the configured uri', () => {
    expect(isAllowedRedirect('https://example.com/oauth/kakao/callback?tamper=1', config)).toBe(
      false,
    )
    expect(isAllowedRedirect('https://example.com/oauth/kakao/callback#token=1', config)).toBe(
      false,
    )
  })

  it('rejects non-localhost http uris even if they match partially or structurally', () => {
    expect(isAllowedRedirect('http://example.com/oauth/kakao/callback', config)).toBe(false)
    expect(isAllowedRedirect('http://attacker.com/oauth/kakao/callback', config)).toBe(false)
  })

  it('rejects open redirect and host spoofing attacks', () => {
    expect(isAllowedRedirect('https://example.com.attacker.com/oauth/kakao/callback', config)).toBe(
      false,
    )
    expect(isAllowedRedirect('https://attacker.com/example.com/oauth/kakao/callback', config)).toBe(
      false,
    )
    expect(isAllowedRedirect('https://example.com@attacker.com/oauth/kakao/callback', config)).toBe(
      false,
    )
    expect(isAllowedRedirect('//attacker.com/oauth/kakao/callback', config)).toBe(false)
    expect(isAllowedRedirect('javascript:alert(1)', config)).toBe(false)
  })

  it('rejects wildcard and invalid URI strings', () => {
    expect(isAllowedRedirect('*', config)).toBe(false)
    expect(isAllowedRedirect('https://*.example.com/oauth/kakao/callback', config)).toBe(false)
    expect(isAllowedRedirect('', config)).toBe(false)
    expect(isAllowedRedirect('not-a-valid-url', config)).toBe(false)
  })
})
