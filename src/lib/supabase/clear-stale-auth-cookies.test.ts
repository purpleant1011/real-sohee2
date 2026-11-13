import { describe, expect, it, vi } from 'vitest'
import {
  clearSupabaseAuthCookies,
  STALE_AUTH_COOKIE_PATTERN,
} from './clear-stale-auth-cookies'

describe('STALE_AUTH_COOKIE_PATTERN', () => {
  it('일반 auth-token 쿠키명을 매칭한다', () => {
    expect(STALE_AUTH_COOKIE_PATTERN.test('sb-your-project-ref-auth-token')).toBe(true)
    expect(STALE_AUTH_COOKIE_PATTERN.test('sb-project-id-auth-token')).toBe(true)
  })

  it('청크 분할된 auth-token (.0, .1) 쿠키명을 매칭한다', () => {
    expect(STALE_AUTH_COOKIE_PATTERN.test('sb-your-project-ref-auth-token.0')).toBe(true)
    expect(STALE_AUTH_COOKIE_PATTERN.test('sb-your-project-ref-auth-token.1')).toBe(true)
    expect(STALE_AUTH_COOKIE_PATTERN.test('sb-proj-auth-token.12')).toBe(true)
  })

  it('PKCE code-verifier 쿠키는 절대 매칭하지 않는다', () => {
    expect(STALE_AUTH_COOKIE_PATTERN.test('sb-your-project-ref-auth-token-code-verifier')).toBe(false)
    expect(STALE_AUTH_COOKIE_PATTERN.test('sb-project-auth-token-code-verifier')).toBe(false)
  })

  it('기타 무관한 쿠키는 매칭하지 않는다', () => {
    expect(STALE_AUTH_COOKIE_PATTERN.test('sb-refresh-token')).toBe(false)
    expect(STALE_AUTH_COOKIE_PATTERN.test('auth-token')).toBe(false)
    expect(STALE_AUTH_COOKIE_PATTERN.test('session_id')).toBe(false)
    expect(STALE_AUTH_COOKIE_PATTERN.test('sb-auth-token')).toBe(false) // sb- 뒤에 프로젝트 ref가 있어야 함
  })
})

describe('clearSupabaseAuthCookies', () => {
  it('문서나 쿠키가 없으면 아무 작업도 하지 않고 빈 배열을 반환한다', () => {
    expect(clearSupabaseAuthCookies(null)).toEqual([])
    expect(clearSupabaseAuthCookies(undefined)).toEqual([])
    expect(clearSupabaseAuthCookies({ cookie: '' })).toEqual([])
    expect(clearSupabaseAuthCookies({ cookie: '   ' })).toEqual([])
  })

  it('낡은 auth-token 쿠키가 없으면 아무 작업도 하지 않는다', () => {
    const mockDoc = { cookie: 'foo=bar; user_id=123; sb-proj-auth-token-code-verifier=secret' }
    const setSpy = vi.spyOn(mockDoc, 'cookie', 'set')

    const cleared = clearSupabaseAuthCookies(mockDoc, 'example.com')
    expect(cleared).toEqual([])
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('낡은 auth-token 및 청크 쿠키만 삭제하고 verifier는 보존한다', () => {
    const writtenCookies: string[] = []
    const mockDoc = {
      _cookie:
        'sb-your-project-ref-auth-token=stale-token; ' +
        'sb-your-project-ref-auth-token.0=chunk0; ' +
        'sb-your-project-ref-auth-token-code-verifier=keep-this-verifier; ' +
        'normal_cookie=value',
      get cookie() {
        return this._cookie
      },
      set cookie(val: string) {
        writtenCookies.push(val)
      },
    }

    const cleared = clearSupabaseAuthCookies(mockDoc, 'example.com')

    expect(cleared).toEqual([
      'sb-your-project-ref-auth-token',
      'sb-your-project-ref-auth-token.0',
    ])
    expect(cleared).not.toContain('sb-your-project-ref-auth-token-code-verifier')

    // verifier 관련 삭제 Set은 작성되지 않았는지 검증
    for (const cookieStr of writtenCookies) {
      expect(cookieStr).not.toContain('code-verifier')
    }
  })

  it('도메인 변형 3종(도메인 없음, Domain=<hostname>, Domain=.<hostname>)을 각각 시도한다', () => {
    const writtenCookies: string[] = []
    const mockDoc = {
      _cookie: 'sb-sample-auth-token=stale-session',
      get cookie() {
        return this._cookie
      },
      set cookie(val: string) {
        writtenCookies.push(val)
      },
    }

    const cleared = clearSupabaseAuthCookies(mockDoc, 'sohee.ai')

    expect(cleared).toEqual(['sb-sample-auth-token'])
    expect(writtenCookies).toHaveLength(3)
    expect(writtenCookies).toContain('sb-sample-auth-token=; Path=/; Max-Age=0; SameSite=Lax')
    expect(writtenCookies).toContain('sb-sample-auth-token=; Path=/; Max-Age=0; Domain=sohee.ai; SameSite=Lax')
    expect(writtenCookies).toContain('sb-sample-auth-token=; Path=/; Max-Age=0; Domain=.sohee.ai; SameSite=Lax')
  })

  it('hostname이 비어있으면 도메인 속성 없는 삭제만 시도한다', () => {
    const writtenCookies: string[] = []
    const mockDoc = {
      _cookie: 'sb-sample-auth-token=stale-session',
      get cookie() {
        return this._cookie
      },
      set cookie(val: string) {
        writtenCookies.push(val)
      },
    }

    const cleared = clearSupabaseAuthCookies(mockDoc, '')

    expect(cleared).toEqual(['sb-sample-auth-token'])
    expect(writtenCookies).toEqual([
      'sb-sample-auth-token=; Path=/; Max-Age=0; SameSite=Lax',
    ])
  })
})
