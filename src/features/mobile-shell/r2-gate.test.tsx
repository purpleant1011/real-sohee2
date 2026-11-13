import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider, useIsForceMobile, useMobileR2Active } from './r2-gate'
import { resolveMobileR2Enabled, resolveMobileR2LandingEnabled } from './r2-flag'

function Probe() { return <p>{useMobileR2Active() ? 'r2' : 'legacy'}</p> }
function ForceMobileProbe() { return <p>{useIsForceMobile() ? 'forced-mobile' : 'normal'}</p> }
function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}
afterEach(() => vi.unstubAllGlobals())

describe('resolveMobileR2Enabled', () => {
  it('전체 공개 모드는 allowlist 밖의 가게에도 열되 가게 없는 요청은 열지 않는다', () => {
    expect(resolveMobileR2Enabled('all', 'ws1', 'ws2')).toBe(true)
    expect(resolveMobileR2Enabled('all', undefined, 'new-workspace')).toBe(true)
    expect(resolveMobileR2Enabled('all', '*', '')).toBe(false)
    expect(resolveMobileR2Enabled('ALL', 'ws1', 'ws2')).toBe(false)
  })
  it('기본 OFF · 별표 불가 · allowlist 매장만 ON', () => {
    expect(resolveMobileR2Enabled(undefined, 'ws1', 'ws1')).toBe(false)
    expect(resolveMobileR2Enabled('1', '*', 'ws1')).toBe(false)
    expect(resolveMobileR2Enabled('1', 'ws2', 'ws1')).toBe(false)
    expect(resolveMobileR2Enabled('1', '', 'ws1')).toBe(false)
    expect(resolveMobileR2Enabled('1', 'ws2, ws1', 'ws1')).toBe(true)
  })
})

describe('resolveMobileR2LandingEnabled', () => {
  it('기본 OFF · 1 만 ON', () => {
    expect(resolveMobileR2LandingEnabled(undefined)).toBe(false)
    expect(resolveMobileR2LandingEnabled('')).toBe(false)
    expect(resolveMobileR2LandingEnabled('true')).toBe(false)
    expect(resolveMobileR2LandingEnabled('0')).toBe(false)
    expect(resolveMobileR2LandingEnabled('1')).toBe(true)
  })
})

describe('useMobileR2Active', () => {
  it('provider 없이는 기존 화면', () => {
    narrow(true)
    render(<Probe />)
    expect(screen.getByText('legacy')).toBeVisible()
  })
  it('플래그 ON 이어도 넓은 화면이면 기존 화면', () => {
    narrow(false)
    render(<MobileR2Provider enabled><Probe /></MobileR2Provider>)
    expect(screen.getByText('legacy')).toBeVisible()
  })
  it('플래그 OFF 면 좁은 화면도 기존 화면', () => {
    narrow(true)
    render(<MobileR2Provider enabled={false}><Probe /></MobileR2Provider>)
    expect(screen.getByText('legacy')).toBeVisible()
  })
  it('서버가 PC 호스트 표현(example.com)을 지정하면 좁은 화면에서도 PC 버전 레이아웃을 사용한다', () => {
    narrow(true)
    render(<MobileR2Provider enabled forcePc><Probe /></MobileR2Provider>)
    expect(screen.getByText('legacy')).toBeVisible()
  })
  it('서버가 모바일 호스트 표현을 지정하면 넓은 화면에서도 같은 R2 셸을 사용한다', () => {
    narrow(false)
    render(<MobileR2Provider enabled forceMobile><Probe /></MobileR2Provider>)
    expect(screen.getByText('r2')).toBeVisible()
  })
  it('모바일 호스트라도 서버 기능 허용을 우회하지 않는다', () => {
    narrow(false)
    render(<MobileR2Provider enabled={false} forceMobile><Probe /></MobileR2Provider>)
    expect(screen.getByText('legacy')).toBeVisible()
  })
  it('플래그 ON + 좁은 화면에서만 R2', () => {
    narrow(true)
    render(<MobileR2Provider enabled><Probe /></MobileR2Provider>)
    expect(screen.getByText('r2')).toBeVisible()
  })

  it('useIsForceMobile 은 forceMobile 이 true 일 때만 true 를 반환한다', () => {
    render(<MobileR2Provider enabled forceMobile><ForceMobileProbe /></MobileR2Provider>)
    expect(screen.getByText('forced-mobile')).toBeVisible()

    render(<MobileR2Provider enabled forceMobile={false}><ForceMobileProbe /></MobileR2Provider>)
    expect(screen.getByText('normal')).toBeVisible()
  })
})

