import { describe, expect, it } from 'vitest'
import {
  createOAuthState,
  verifyOAuthState,
} from './state'

describe('Kakao OAuth State Manager', () => {
  const secret = 'test-kakao-client-secret-1234567890'
  const redirectUri = 'https://example.com/api/auth/kakao/callback'

  it('올바른 서명과 만료 시간을 포함하는 state와 쿠키 바인딩 값을 생성한다', async () => {
    const result = await createOAuthState({
      redirectUri,
      next: '/app/dashboard',
      secret,
      ttlSeconds: 300,
    })

    expect(result.state).toBeTypeOf('string')
    expect(result.cookieValue).toBeTypeOf('string')
    expect(result.cookieValue).toBe(result.state)
    expect(result.maxAge).toBe(300)
    expect(result.state.split('.')).toHaveLength(2)
  })

  it('동일한 state와 쿠키 값, 비밀키로 성공적으로 검증된다', async () => {
    const created = await createOAuthState({
      redirectUri,
      next: '/app/settings',
      secret,
      ttlSeconds: 600,
    })

    const verified = await verifyOAuthState({
      state: created.state,
      cookieState: created.cookieValue,
      secret,
    })

    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    expect(verified.payload.redirectUri).toBe(redirectUri)
    expect(verified.payload.next).toBe('/app/settings')
    expect(verified.payload.exp).toBeGreaterThan(verified.payload.iat)
  })

  it('쿠키 값이 누락되었거나 일치하지 않으면 cookie_mismatch 로 실패한다', async () => {
    const created = await createOAuthState({
      redirectUri,
      secret,
    })

    const noCookie = await verifyOAuthState({
      state: created.state,
      cookieState: undefined,
      secret,
    })
    expect(noCookie.ok).toBe(false)
    if (!noCookie.ok) {
      expect(noCookie.reason).toBe('cookie_mismatch')
    }

    const wrongCookie = await verifyOAuthState({
      state: created.state,
      cookieState: 'different-cookie-state',
      secret,
    })
    expect(wrongCookie.ok).toBe(false)
    if (!wrongCookie.ok) {
      expect(wrongCookie.reason).toBe('cookie_mismatch')
    }
  })

  it('state 서명이 변조되었거나 비밀키가 다르면 tampered 로 실패한다', async () => {
    const created = await createOAuthState({
      redirectUri,
      secret,
    })

    const [payloadPart] = created.state.split('.')
    const tamperedState = `${payloadPart}.invalidSignature123`

    const tampered = await verifyOAuthState({
      state: tamperedState,
      cookieState: tamperedState,
      secret,
    })
    expect(tampered.ok).toBe(false)
    if (!tampered.ok) {
      expect(tampered.reason).toBe('tampered')
    }

    const wrongSecret = await verifyOAuthState({
      state: created.state,
      cookieState: created.cookieValue,
      secret: 'wrong-secret-key-99999999',
    })
    expect(wrongSecret.ok).toBe(false)
    if (!wrongSecret.ok) {
      expect(wrongSecret.reason).toBe('tampered')
    }
  })

  it('만료 시간이 지난 state는 expired 로 실패한다', async () => {
    const now = Math.floor(Date.now() / 1000)
    const created = await createOAuthState({
      redirectUri,
      secret,
      ttlSeconds: 10,
      now: now - 100, // 과거에 생성
    })

    const result = await verifyOAuthState({
      state: created.state,
      cookieState: created.cookieValue,
      secret,
      now,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('expired')
    }
  })

  it('형식이 잘못된 state(점 없음, 유효하지 않은 base64url 등)는 malformed 로 실패한다', async () => {
    const malformed1 = await verifyOAuthState({
      state: 'not-a-valid-token',
      cookieState: 'not-a-valid-token',
      secret,
    })
    expect(malformed1.ok).toBe(false)
    if (!malformed1.ok) {
      expect(malformed1.reason).toBe('malformed')
    }
  })
})
