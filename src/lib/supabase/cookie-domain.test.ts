import { describe, expect, it } from 'vitest'
import { getCookieDomain, getSharedCookieOptions } from './cookie-domain'

describe('getCookieDomain', () => {
  it('production 환경에서 example.com 및 서브도메인은 .example.com을 반환한다', () => {
    expect(getCookieDomain('example.com')).toBe('.example.com')
    expect(getCookieDomain('m.example.com')).toBe('.example.com')
    expect(getCookieDomain('www.example.com')).toBe('.example.com')
    expect(getCookieDomain('m.example.com:443')).toBe('.example.com')
  })

  it('localhost 또는 IP 환경에서는 domain을 지정하지 않는다 (undefined)', () => {
    expect(getCookieDomain('localhost')).toBeUndefined()
    expect(getCookieDomain('localhost:3000')).toBeUndefined()
    expect(getCookieDomain('127.0.0.1')).toBeUndefined()
    expect(getCookieDomain(undefined)).toBeUndefined()
  })

  it('기타 개발/테스트 도메인은 적절히 서브도메인을 처리하거나 undefined를 반환한다', () => {
    expect(getCookieDomain('custom-domain.com')).toBeUndefined()
  })
})

describe('getSharedCookieOptions', () => {
  it('도메인 옵션이 주어지면 cookie options에 domain을 병합한다', () => {
    const opts = getSharedCookieOptions({ path: '/', httpOnly: true }, 'm.example.com')
    expect(opts).toEqual({
      path: '/',
      httpOnly: true,
      domain: '.example.com',
    })
  })

  it('localhost인 경우 domain 속성을 추가하지 않는다', () => {
    const opts = getSharedCookieOptions({ path: '/', httpOnly: true }, 'localhost:3000')
    expect(opts).toEqual({
      path: '/',
      httpOnly: true,
    })
  })
})
