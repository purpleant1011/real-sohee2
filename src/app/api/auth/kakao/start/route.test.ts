import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

describe('GET /api/auth/kakao/start', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env = { ...originalEnv, KAKAO_LOGIN_ENABLED: 'true' }
  })

  it('카카오 환경변수가 설정되지 않은 경우 503 Service Unavailable을 반환한다', async () => {
    delete process.env.KAKAO_JS_KEY
    delete process.env.KAKAO_REST_API_KEY
    delete process.env.KAKAO_CLIENT_SECRET
    delete process.env.KAKAO_ALLOWED_ORIGINS
    delete process.env.KAKAO_REDIRECT_URIS

    const req = new NextRequest('http://localhost:3000/api/auth/kakao/start')
    const res = await GET(req)

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('service_unavailable')
  })

  it('KAKAO_STATE_SECRET이 설정되지 않은 경우 503 Service Unavailable을 반환한다 (clientSecret 재사용 금지)', async () => {
    process.env.KAKAO_JS_KEY = 'test-js-key'
    process.env.KAKAO_REST_API_KEY = 'test-rest-key'
    process.env.KAKAO_CLIENT_SECRET = 'test-secret-key-1234'
    process.env.KAKAO_ALLOWED_ORIGINS = 'http://localhost:3000'
    process.env.KAKAO_REDIRECT_URIS = 'http://localhost:3000/api/auth/kakao/callback'
    delete process.env.KAKAO_STATE_SECRET

    const req = new NextRequest('http://localhost:3000/api/auth/kakao/start')
    const res = await GET(req)

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('service_unavailable')
  })

  it('환경변수가 올바르게 설정된 경우 카카오 authorize URL로 리다이렉트하고 state 쿠키를 설정한다', async () => {
    process.env.KAKAO_JS_KEY = 'test-js-key'
    process.env.KAKAO_REST_API_KEY = 'test-rest-key'
    process.env.KAKAO_CLIENT_SECRET = 'test-secret-key-1234'
    process.env.KAKAO_STATE_SECRET = 'test-state-secret-5678'
    process.env.KAKAO_ALLOWED_ORIGINS = 'http://localhost:3000,https://example.com'
    process.env.KAKAO_REDIRECT_URIS = 'http://localhost:3000/api/auth/kakao/callback'

    const req = new NextRequest('http://localhost:3000/api/auth/kakao/start?next=/app/dashboard')
    const res = await GET(req)

    expect(res.status).toBe(307)
    const location = res.headers.get('location')
    expect(location).toBeDefined()
    const targetUrl = new URL(location!)
    expect(targetUrl.origin).toBe('https://kauth.kakao.com')
    expect(targetUrl.pathname).toBe('/oauth/authorize')
    expect(targetUrl.searchParams.get('client_id')).toBe('test-rest-key')
    expect(targetUrl.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/kakao/callback')
    expect(targetUrl.searchParams.get('response_type')).toBe('code')
    expect(targetUrl.searchParams.get('state')).toBeTruthy()

    // 쿠키 설정 확인
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    expect(setCookie).toContain('kakao_oauth_state=')
    expect(setCookie?.toLowerCase()).toContain('httponly')
    expect(setCookie?.toLowerCase()).toContain('samesite=lax')
  })

  it('허용되지 않은 redirect_uri 파라미터가 들어오면 400 Bad Request 로 거부한다', async () => {
    process.env.KAKAO_JS_KEY = 'test-js-key'
    process.env.KAKAO_REST_API_KEY = 'test-rest-key'
    process.env.KAKAO_CLIENT_SECRET = 'test-secret-key-1234'
    process.env.KAKAO_STATE_SECRET = 'test-state-secret-5678'
    process.env.KAKAO_ALLOWED_ORIGINS = 'http://localhost:3000'
    process.env.KAKAO_REDIRECT_URIS = 'http://localhost:3000/api/auth/kakao/callback'

    const req = new NextRequest(
      'http://localhost:3000/api/auth/kakao/start?redirect_uri=https://attacker.com/callback',
    )
    const res = await GET(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('disallowed_redirect_uri')
  })

  it('KAKAO_LOGIN_ENABLED 가 true 가 아니면 404 로 비활성화된다(기본 꺼짐)', async () => {
    delete process.env.KAKAO_LOGIN_ENABLED
    const res = await GET(new NextRequest('http://localhost:3000/api/auth/kakao/start'))
    expect(res.status).toBe(404)
  })
})
