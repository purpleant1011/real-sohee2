import { useEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider, useMobileR2Active } from './r2-gate'

function Probe() { return <p>{useMobileR2Active() ? 'R2 첫 화면' : '구형 화면'}</p> }
afterEach(() => vi.unstubAllGlobals())

describe('설치 앱의 첫 페인트', () => {
  it('서버가 휴대폰으로 판정한 허용 요청은 JS 다운로드 전부터 R2다', () => {
    const html = renderToString(<MobileR2Provider enabled initialMobile><Probe /></MobileR2Provider>)
    expect(html).toContain('R2 첫 화면')
    expect(html).not.toContain('구형 화면')
  })

  it('휴대폰 힌트는 R2 허용 플래그를 우회하지 않는다', () => {
    const html = renderToString(<MobileR2Provider enabled={false} initialMobile><Probe /></MobileR2Provider>)
    expect(html).toContain('구형 화면')
  })

  it('서버 힌트와 다른 실제 폭은 hydration 오류 없이 보정한다', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const tree = <MobileR2Provider enabled initialMobile><Probe /></MobileR2Provider>
    const container = document.createElement('div')
    container.innerHTML = renderToString(tree)
    document.body.append(container)
    const errors = vi.fn()
    let root!: ReturnType<typeof hydrateRoot>
    try {
      await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError: errors }) })
      expect(container.textContent).toBe('구형 화면')
      expect(errors).not.toHaveBeenCalled()
    } finally {
      await act(async () => root?.unmount())
      container.remove()
    }
  })

  it('iPhone hydration은 구형 홈을 마운트하거나 초기 조회를 시작하지 않는다', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const legacyMount = vi.fn()
    function LegacyHome() {
      useEffect(legacyMount, [])
      return <p>구형 홈</p>
    }
    function Home() { return useMobileR2Active() ? <p>R2 홈</p> : <LegacyHome /> }
    const tree = <MobileR2Provider enabled initialMobile><Home /></MobileR2Provider>
    const container = document.createElement('div')
    container.innerHTML = renderToString(tree)
    document.body.append(container)
    const errors = vi.fn()
    let root!: ReturnType<typeof hydrateRoot>
    try {
      await act(async () => { root = hydrateRoot(container, tree, { onRecoverableError: errors }) })
      expect(container.textContent).toBe('R2 홈')
      expect(legacyMount).not.toHaveBeenCalled()
      expect(errors).not.toHaveBeenCalled()
    } finally {
      await act(async () => root?.unmount())
      container.remove()
    }
  })

  it('휴대폰 힌트가 없어도 실제 좁은 화면은 R2를 사용한다', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    render(<MobileR2Provider enabled><Probe /></MobileR2Provider>)
    expect(screen.getByText('R2 첫 화면')).toBeVisible()
  })
})
