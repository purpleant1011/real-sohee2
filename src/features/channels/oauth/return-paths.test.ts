import { describe, expect, it } from 'vitest'
import { parseReturnPath } from './return-paths'

describe('parseReturnPath (Open Redirect 방지 및 안전한 경로 보존)', () => {
  it('기본값: null, undefined, 빈 문자열인 경우 /app/channels를 반환한다', () => {
    expect(parseReturnPath(null)).toBe('/app/channels')
    expect(parseReturnPath(undefined)).toBe('/app/channels')
    expect(parseReturnPath('')).toBe('/app/channels')
  })

  it('안전한 시작 경로 및 쿼리스트링(?step=channels)을 온전히 보존한다', () => {
    expect(parseReturnPath('/start?step=channels')).toBe('/start?step=channels')
    expect(parseReturnPath('/start')).toBe('/start')
    expect(parseReturnPath('/start/preview')).toBe('/start/preview')
    expect(parseReturnPath('/app/channels?view=card')).toBe('/app/channels?view=card')
    expect(parseReturnPath('/app/settings/channels')).toBe('/app/settings/channels')
    expect(parseReturnPath('/onboarding/channels?from=wizard')).toBe('/onboarding/channels?from=wizard')
  })

  it('허용되지 않은 임의 경로인 경우 기본값 /app/channels로 폴백한다', () => {
    expect(parseReturnPath('/admin/users')).toBe('/app/channels')
    expect(parseReturnPath('/secret')).toBe('/app/channels')
    expect(parseReturnPath('/login')).toBe('/app/channels')
  })

  it('Open Redirect 시도: 절대 URL (http/https)은 기본값으로 차단한다', () => {
    expect(parseReturnPath('https://evil.com')).toBe('/app/channels')
    expect(parseReturnPath('http://evil.com/start')).toBe('/app/channels')
    expect(parseReturnPath('javascript:alert(1)')).toBe('/app/channels')
  })

  it('Open Redirect 시도: 프로토콜 상대 URL (//evil.com)은 기본값으로 차단한다', () => {
    expect(parseReturnPath('//evil.com')).toBe('/app/channels')
    expect(parseReturnPath('//evil.com/start')).toBe('/app/channels')
  })

  it('Open Redirect 시도: 백슬래시 우회(/\\evil.com)는 기본값으로 차단한다', () => {
    expect(parseReturnPath('/\\evil.com')).toBe('/app/channels')
    expect(parseReturnPath('/\\evil.com/start')).toBe('/app/channels')
    expect(parseReturnPath('/start\\evil.com')).toBe('/app/channels')
  })
})
