import { describe, expect, it } from 'vitest'
import * as barrel from './index'

// CONTRACT §1/§6 공개 API 계약. 8개 워커 창이 배럴 경로만 보고 import 하므로,
// 여기서 빠진 이름은 "훅이 없다"와 같은 의미가 된다.
describe('public barrel API', () => {
  it('exports the documented component and hooks', () => {
    expect(typeof barrel.MobileAppShell).toBe('function')
    expect(typeof barrel.ShellScreen).toBe('function')
    expect(typeof barrel.useShellScreen).toBe('function')
    expect(typeof barrel.useKeyboard).toBe('function')
    expect(typeof barrel.useShellViewport).toBe('function')
  })
  it('exports the route map and tab contract', () => {
    expect(Array.isArray(barrel.SHELL_TABS)).toBe(true)
    expect(Array.isArray(barrel.SHELL_ROUTES)).toBe(true)
    expect(typeof barrel.resolveRoute).toBe('function')
  })
  it('exports navigation helpers and mode policy', () => {
    expect(typeof barrel.withFrom).toBe('function')
    expect(typeof barrel.safeReturnPath).toBe('function')
    expect(typeof barrel.MODE_POLICY).toBe('object')
  })
  it('keeps the shell-root-only viewport hook internal', () => {
    expect('useViewport' in barrel).toBe(false)
  })
})
