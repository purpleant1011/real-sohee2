import { Suspense } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ pathname: '/app', active: true }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => {
  delete rest.prefetch
  return <a href={href} {...rest}>{children}</a>
} }))
vi.mock('./r2-gate', () => ({ useMobileR2Active: () => nav.active, useIsForceMobile: () => false }))
vi.mock('./tab-code-warmup', () => ({ useR2TabCodeWarmup: vi.fn(), warmR2TabCode: vi.fn() }))

import { MobileAppShell, PersistentMobileShell } from './mobile-app-shell'

beforeEach(() => { nav.pathname = '/app'; nav.active = true })

describe('인가된 R2 루트의 공유 레이아웃', () => {
  it('페이지 Suspense가 로딩으로 바뀌어도 같은 메뉴 DOM을 보존한다', async () => {
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    function Waiting(): never { throw waiting }
    const tree = (loading: boolean) => <PersistentMobileShell><Suspense fallback={<p>데이터 확인 중</p>}>{loading ? <Waiting /> : <MobileAppShell><p>오늘 본문</p></MobileAppShell>}</Suspense></PersistentMobileShell>
    const view = render(tree(false))
    const menu = screen.getByRole('navigation', { name: '소희 업무 메뉴' })
    act(() => { nav.pathname = '/app/content'; view.rerender(tree(true)) })
    expect(screen.getByText('데이터 확인 중')).toBeVisible()
    expect(screen.getByRole('navigation', { name: '소희 업무 메뉴' })).toBe(menu)
    expect(document.querySelectorAll('[data-mobile-shell]')).toHaveLength(1)
    await act(async () => { view.unmount(); release() })
  })

  it.each(['/app', '/app/content', '/app/customers', '/app/results', '/app/system'])('%s 루트는 페이지보다 위에 셸을 둔다', pathname => {
    nav.pathname = pathname
    render(<PersistentMobileShell><p>본문</p></PersistentMobileShell>)
    expect(screen.getByRole('navigation', { name: '소희 업무 메뉴' })).toBeVisible()
  })

  it.each(['/app/schedule', '/app/schedule/availability', '/app/missions', '/app/missions/m1', '/app/opportunities', '/app/campaigns', '/app/account/billing', '/app/trial-summary'])('%s 는 자체 셸이 없는 PC 기능 화면이라 모바일 셸(헤더·뒤로가기)에 올린다', pathname => {
    nav.pathname = pathname
    render(<PersistentMobileShell><p>PC 기능 본문</p></PersistentMobileShell>)
    expect(document.querySelector('[data-mobile-shell]')).not.toBeNull()
    expect(screen.getByText('PC 기능 본문')).toBeVisible()
  })

  it.each(['/app/onboarding', '/app/work/id/edit', '/app/unknown'])('%s 에는 새 셸을 강제하지 않는다', pathname => {
    nav.pathname = pathname
    render(<PersistentMobileShell><p>원래 화면</p></PersistentMobileShell>)
    expect(document.querySelector('[data-mobile-shell]')).toBeNull()
    expect(screen.getByText('원래 화면')).toBeVisible()
  })

  it('PC·플래그 OFF에서는 기존 화면만 렌더한다', () => {
    nav.active = false
    render(<PersistentMobileShell><p>PC 본문</p></PersistentMobileShell>)
    expect(document.querySelector('[data-mobile-shell]')).toBeNull()
    expect(screen.getByText('PC 본문')).toBeVisible()
  })
})
