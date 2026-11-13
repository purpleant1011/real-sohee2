import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ pathname: '/app', push: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: nav.push, back: nav.back }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => {
    // next/link 전용 prop 은 실제 DOM 으로 넘기지 않는다.
    delete rest.prefetch
    return <a href={href} {...rest}>{children}</a>
  },
}))

import { MobileAppShell, ShellScreen } from './index'
import { MobileR2Provider } from './r2-gate'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'

beforeEach(() => {
  nav.pathname = '/app'
  nav.push.mockClear()
  nav.back.mockClear()
  window.sessionStorage.clear()
  HTMLElement.prototype.scrollTo = vi.fn()
})

describe('MobileAppShell', () => {
  it('BROWSE: header command + five tabs, no CTA', () => {
    render(<MobileAppShell><p>본문</p></MobileAppShell>)
    expect(screen.getByRole('navigation', { name: '소희 업무 메뉴' }).querySelectorAll('a')).toHaveLength(5)
    expect(screen.getByLabelText('소희와 채팅')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '오늘' })).toHaveAttribute('aria-current', 'page')
    expect(document.querySelector('[data-shell-cta]')).toBeNull()
  })
  it('opens the canonical conversation from the mobile header only when its workspace rollout is enabled', () => {
    render(<WorkspaceProvider value={{ workspaceId: 'workspace-a', workspaceName: null, workspaceKind: null, membershipRole: 'owner', actorId: 'user-a', resolutionSource: 'membership', conversationWorkbenchEnabled: true }}><MobileAppShell><p>본문</p></MobileAppShell></WorkspaceProvider>)
    fireEvent.click(screen.getByLabelText('소희와 채팅'))
    expect(nav.push).toHaveBeenCalledWith('/app/conversations')
  })
  it('REVIEW: hides tabs and shows exactly one CTA', async () => {
    nav.pathname = '/app/approvals'
    const onPress = vi.fn()
    render(<MobileAppShell><ShellScreen title="승인 확인" cta={{ label: '승인하기', onPress }}>내용</ShellScreen></MobileAppShell>)
    expect(screen.queryByRole('navigation', { name: '소희 업무 메뉴' })).toBeNull()
    expect(document.querySelectorAll('[data-shell-cta]')).toHaveLength(1)
    expect(document.querySelector('[data-mobile-shell]')).toHaveAttribute('data-mode', 'REVIEW')
    fireEvent.click(screen.getByRole('button', { name: '승인하기' }))
    expect(onPress).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByLabelText('뒤로'))
    expect(nav.push).toHaveBeenCalledWith('/app')
  })
  it('tab press on another tab navigates; on current root it does not', async () => {
    render(<MobileAppShell>x</MobileAppShell>)
    fireEvent.click(screen.getByRole('link', { name: '고객' }))
    expect(nav.push).toHaveBeenCalledWith('/app/customers')
    nav.push.mockClear()
    fireEvent.click(screen.getByRole('link', { name: '오늘' }))
    expect(nav.push).not.toHaveBeenCalled()
  })
  it('CHAT owns one composer slot, with no tabs or CTA', () => {
    nav.pathname = '/app/command'
    render(<MobileAppShell><ShellScreen composer={<input aria-label="메시지" />}>대화</ShellScreen></MobileAppShell>)
    expect(document.querySelectorAll('[data-shell-composer]')).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: '메시지' })).toBeInTheDocument()
    expect(document.querySelector('[data-shell-cta]')).toBeNull()
    expect(screen.queryByRole('navigation', { name: '소희 업무 메뉴' })).toBeNull()
  })
  it('uses the registered internal back destination', () => {
    nav.pathname = '/app/customers/123'
    render(<MobileAppShell><ShellScreen backHref="/app/engagement">고객</ShellScreen></MobileAppShell>)
    fireEvent.click(screen.getByLabelText('뒤로'))
    expect(nav.push).toHaveBeenCalledWith('/app/engagement')
  })
  it('화면이 바뀌어 포커스가 사라지면 본문으로 옮긴다', () => {
    nav.pathname = '/app/customers/123'
    const { rerender } = render(<MobileAppShell><ShellScreen backHref="/app/engagement">고객</ShellScreen></MobileAppShell>)
    screen.getByLabelText('뒤로').focus()
    expect(document.activeElement).toBe(screen.getByLabelText('뒤로'))

    // 루트로 돌아오면 뒤로 버튼이 사라지고, 누르고 있던 요소가 없어져 포커스가 body 로 떨어진다.
    nav.pathname = '/app'
    rerender(<MobileAppShell><p>본문</p></MobileAppShell>)

    expect(screen.queryByLabelText('뒤로')).toBeNull()
    expect(document.activeElement).toBe(document.querySelector('[data-mobile-shell] main'))
  })

  it('누른 요소가 아직 화면에 있으면 포커스를 옮기지 않는다', () => {
    nav.pathname = '/app'
    const { rerender } = render(<MobileAppShell><p>본문</p></MobileAppShell>)
    const today = screen.getByRole('link', { name: '오늘' })
    today.focus()

    nav.pathname = '/app/customers'
    rerender(<MobileAppShell><p>본문</p></MobileAppShell>)

    // 탭바는 화면이 바뀌어도 남아 있으므로 키보드 사용자의 위치를 빼앗지 않는다.
    expect(document.activeElement).toBe(today)
  })

  it('첫 진입에서는 본문으로 포커스를 옮기지 않는다', () => {
    render(<MobileAppShell><p>본문</p></MobileAppShell>)
    expect(document.activeElement).toBe(document.body)
  })

  it('hides tabs while keyboard is open', () => {
    const vv = Object.assign(new EventTarget(), { height: 500, offsetTop: 0, scale: 1 })
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    render(<MobileAppShell>x</MobileAppShell>)
    act(() => { vv.dispatchEvent(new Event('resize')) })
    expect(document.querySelector('[data-mobile-shell]')).toHaveAttribute('data-keyboard', 'open')
    expect(screen.queryByRole('navigation', { name: '소희 업무 메뉴' })).toBeNull()
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true })
  })

  it('marks data-force-mobile attribute reflecting forceMobile status', () => {
    const { rerender } = render(
      <MobileR2Provider enabled={true} forceMobile={false}>
        <MobileAppShell><p>기본 셸</p></MobileAppShell>
      </MobileR2Provider>
    )
    expect(document.querySelector('[data-mobile-shell]')).toHaveAttribute('data-force-mobile', 'false')

    rerender(
      <MobileR2Provider enabled={true} forceMobile={true}>
        <MobileAppShell><p>강제 모바일 셸</p></MobileAppShell>
      </MobileR2Provider>
    )
    expect(document.querySelector('[data-mobile-shell]')).toHaveAttribute('data-force-mobile', 'true')
  })
})
