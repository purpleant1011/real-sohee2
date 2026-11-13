import { describe, expect, it } from 'vitest'
import { resolveStoredTheme } from './theme-preference'

describe('resolveStoredTheme', () => {
  it('일반 브라우저는 저장된 선택(없으면 기본값)을 따른다', () => {
    expect(resolveStoredTheme({ saved: 'dark', defaultTheme: 'light', iosStandalone: false })).toBe('dark')
    expect(resolveStoredTheme({ saved: null, defaultTheme: 'light', iosStandalone: false })).toBe('light')
  })
  it('iOS 홈 화면 앱은 상태바가 시스템 색을 따르므로 앱 테마도 시스템을 따른다(상태바 흰 띠 방지)', () => {
    expect(resolveStoredTheme({ saved: 'dark', defaultTheme: 'light', iosStandalone: true })).toBe('system')
    expect(resolveStoredTheme({ saved: 'light', defaultTheme: 'light', iosStandalone: true })).toBe('system')
  })
})
