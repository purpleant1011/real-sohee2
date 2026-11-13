import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { createServerClientMock, readPublicEnvMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  readPublicEnvMock: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: createServerClientMock,
}))

vi.mock('@/lib/env', () => ({
  readPublicEnv: readPublicEnvMock,
}))

import { updateSession } from './proxy'

describe('updateSession', () => {
  const getClaims = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    readPublicEnvMock.mockReturnValue({
      NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
    })
    getClaims.mockResolvedValue({ data: { claims: null }, error: null })
    createServerClientMock.mockReturnValue({ auth: { getClaims } })
  })

  afterEach(() => vi.restoreAllMocks())

  it('홈 HTML 이전의 세션 확인 소요 시간을 식별자 없이 응답한다', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100)
    getClaims.mockImplementationOnce(async () => {
      now.mockReturnValue(175.3)
      return { data: { claims: { sub: 'private-user-id' } }, error: null }
    })

    const response = await updateSession(new NextRequest('http://localhost:3000/app'))

    expect(response.headers.get('Server-Timing')).toBe('session;dur=75.3')
    expect(response.headers.get('Server-Timing')).not.toContain('private-user-id')
  })

  it('세션 갱신 쿠키와 Supabase 응답 헤더를 보존한 채 시간을 추가한다', async () => {
    getClaims.mockImplementationOnce(async () => {
      const options = createServerClientMock.mock.calls[0][2]
      options.cookies.setAll(
        [{ name: 'test-session', value: 'refreshed', options: { path: '/', httpOnly: true } }],
        { 'Cache-Control': 'private, no-store' },
      )
      return { data: { claims: null }, error: null }
    })

    const response = await updateSession(new NextRequest('http://localhost:3000/app'))

    expect(response.cookies.get('test-session')?.value).toBe('refreshed')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Server-Timing')).toMatch(/^session;dur=\d+(?:\.\d+)?$/)
  })

  it('인증 오류로 복구 화면에 이동해도 실패 전 대기 시간을 남긴다', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(200)
    getClaims.mockImplementationOnce(async () => {
      now.mockReturnValue(1200)
      throw new Error('transport failed')
    })

    const response = await updateSession(new NextRequest('http://localhost:3000/app'))

    expect(response.status).toBe(307)
    expect(response.headers.get('Server-Timing')).toBe('session;dur=1000.0')
    expect(response.headers.get('Server-Timing')).not.toContain('transport failed')
  })

  it('공개 설정이 없으면 원시 오류 대신 안전한 복구 화면으로 이동한다', async () => {
    readPublicEnvMock.mockImplementation(() => {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing')
    })

    const response = await updateSession(new NextRequest('http://localhost:3000/app'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/service-unavailable?from=%2Fapp',
    )
    expect([...response.headers.entries()].join(' ')).not.toContain('NEXT_PUBLIC_SUPABASE_URL')
  })

  it('Supabase 연결이 일시적으로 실패해도 내부 스택 대신 복구 화면을 보여 준다', async () => {
    getClaims.mockRejectedValue(new Error('transport failed'))

    const response = await updateSession(new NextRequest('http://localhost:3000/app/schedule'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/service-unavailable?from=%2Fapp%2Fschedule',
    )
  })

  it('정상 설정에서는 기존 인증 세션 갱신과 경로 전달을 유지한다', async () => {
    const response = await updateSession(
      new NextRequest('http://localhost:3000/app/schedule?view=week'),
    )

    expect(response.status).toBe(200)
    expect(getClaims).toHaveBeenCalledOnce()
    expect(response.headers.get('x-middleware-request-x-sohee-pathname')).toBe(
      '/app/schedule?view=week',
    )
  })

  it.each(['/admin', '/admin/system?tab=health', '/operator', '/operator/system?tab=health'])('관리자 경로도 권한 판정 없이 전달한다: %s', async (path) => {
    const response = await updateSession(new NextRequest(`http://localhost:3000${path}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-request-x-sohee-pathname')).toBe(path)
    expect(response.headers.get('location')).toBeNull()
  })
})

describe('updateSession 중복 쿠키 정리 (.example.com 도메인 쿠키 도입 이후)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readPublicEnvMock.mockReturnValue({
      NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key',
    })
    createServerClientMock.mockReturnValue({ auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: null }, error: null }) } })
  })

  it('같은 인증 쿠키가 호스트 전용·도메인 두 벌 오면 호스트 전용 낡은 쿠키를 만료시킨다', async () => {
    const request = new NextRequest('https://example.com/app', { headers: { host: 'example.com', cookie: 'sb-abc-auth-token.0=old; sb-abc-auth-token.1=old1; sb-abc-auth-token.0=new; sb-abc-auth-token.1=new1' } })
    const response = await updateSession(request)
    const setCookie = response.headers.getSetCookie().join('\n')
    expect(setCookie).toMatch(/sb-abc-auth-token\.0=;[^\n]*Max-Age=0/i)
    expect(setCookie).not.toMatch(/Domain=/i)
  })

  it('쿠키가 한 벌뿐이면 건드리지 않는다(로그아웃 방지)', async () => {
    const request = new NextRequest('https://example.com/app', { headers: { host: 'example.com', cookie: 'sb-abc-auth-token.0=only' } })
    const response = await updateSession(request)
    expect(response.headers.getSetCookie().join('\n')).not.toMatch(/sb-abc-auth-token/)
  })

  it('로컬호스트는 건드리지 않는다', async () => {
    const request = new NextRequest('http://localhost:3000/app', { headers: { cookie: 'sb-abc-auth-token=a; sb-abc-auth-token=b' } })
    const response = await updateSession(request)
    expect(response.headers.getSetCookie().join('\n')).not.toMatch(/sb-abc-auth-token/)
  })
})

describe('중복 쿠키 정리가 새로 쓴 도메인 쿠키를 덮어쓰지 않는다', () => {
  it('토큰 갱신으로 도메인 쿠키를 쓰는 응답에서도 두 Set-Cookie 가 모두 나간다', async () => {
    readPublicEnvMock.mockReturnValue({ NEXT_PUBLIC_SUPABASE_URL: 'https://your-project-ref.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key' })
    createServerClientMock.mockImplementation((_u: string, _k: string, options: any) => ({ auth: { getClaims: async () => {
      options.cookies.setAll([{ name: 'sb-abc-auth-token.0', value: 'fresh', options: { path: '/', domain: '.example.com' } }], {})
      return { data: { claims: null }, error: null }
    } } }))
    const request = new NextRequest('https://example.com/app', { headers: { host: 'example.com', cookie: 'sb-abc-auth-token.0=old; sb-abc-auth-token.0=new' } })
    const response = await updateSession(request)
    const all = response.headers.getSetCookie()
    expect(all.some(c => /sb-abc-auth-token\.0=fresh/.test(c) && /Domain=\.sohee\.ai\.kr/i.test(c))).toBe(true)
    expect(all.some(c => /sb-abc-auth-token\.0=;/.test(c) && /Max-Age=0/i.test(c) && !/Domain=/i.test(c))).toBe(true)
  })
})
