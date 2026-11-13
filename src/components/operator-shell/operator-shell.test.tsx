import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OperatorShell } from './operator-shell'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push }),
}))

describe('OperatorShell', () => {
  beforeEach(() => {
    push.mockClear()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })

  it('renders only permitted navigation with landmarks and a safe operator label', async () => {
    render(
      <OperatorShell permissions={['dashboard.read', 'workspace.read']} pathname="/admin/workspaces">
        <p>본문 테스트 영역</p>
      </OperatorShell>,
    )

    expect(screen.getByRole('navigation', { name: '운영사 메뉴' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(document.getElementById('operator-main')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /운영 현황/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^고객사$/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole("link", { name: /결제·구독/ })).not.toBeInTheDocument()
    expect(screen.getByText('운영사 관리자')).toBeInTheDocument()
    expect(screen.getAllByText(/소희 관리자/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/운영자 콘솔/).length).toBeGreaterThan(0)
    expect(screen.getByText('본문 테스트 영역')).toBeInTheDocument()
  })

  it('uses the shared Dialog for the mobile navigation drawer and restores focus', async () => {
    render(<OperatorShell permissions={['dashboard.read', 'workspace.read']} pathname="/admin" />)

    const trigger = screen.getByRole('button', { name: '운영사 메뉴 열기' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '소희 관리자 메뉴' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    expect(within(dialog).getByRole('link', { name: /운영 현황/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole("link", { name: /결제·구독/ })).not.toBeInTheDocument()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '소희 관리자 메뉴' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('traps Tab and Shift+Tab and locks document scrolling while the drawer is open', async () => {
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'clip'
    document.body.style.overflow = 'scroll'
    render(<OperatorShell permissions={['dashboard.read', 'workspace.read']} pathname="/admin" />)

    const trigger = screen.getByRole('button', { name: '운영사 메뉴 열기' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '소희 관리자 메뉴' })
    const closeButton = within(dialog).getByRole('button', { name: '닫기' })
    const lastLink = within(dialog).getByRole('link', { name: /AI 비용/ })
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.body.style.overflow).toBe('hidden')
    closeButton.focus()
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })
    expect(lastLink).toHaveFocus()
    fireEvent.keyDown(lastLink, { key: 'Tab' })
    expect(closeButton).toHaveFocus()
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })
    expect(lastLink).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(document.documentElement.style.overflow).toBe('clip')
    expect(document.body.style.overflow).toBe('scroll')
    document.documentElement.style.overflow = previousHtmlOverflow
    document.body.style.overflow = previousBodyOverflow
  })

  it('closes the drawer after a route link is selected and keeps a fixed safe label', async () => {
    render(<OperatorShell permissions={['dashboard.read', 'workspace.read']} pathname="/admin" />)
    const trigger = screen.getByRole('button', { name: '운영사 메뉴 열기' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '소희 관리자 메뉴' })
    const routeLink = within(dialog).getByRole('link', { name: /^고객사$/ })
    routeLink.addEventListener('click', (event) => event.preventDefault(), { once: true })
    fireEvent.click(routeLink)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '소희 관리자 메뉴' })).not.toBeInTheDocument())
    expect(screen.getByText('운영사 관리자')).toBeInTheDocument()
    expect(screen.queryByText(/operator@example\.com|password=secret/)).not.toBeInTheDocument()
  })

  it('mounts only the resolved desktop grid panel branch', async () => {
    render(
      <OperatorShell
        permissions={['dashboard.read']}
        rightPanel={<p>오른쪽 패널 테스트 영역</p>}
        rightPanelOpen
      />,
    )

    await waitFor(() => expect(screen.getByTestId('operator-right-panel')).toHaveAttribute('data-right-panel-mode', 'desktop-grid'))
    expect(screen.queryByRole('dialog', { name: '운영사 패널' })).not.toBeInTheDocument()
  })

  it('mounts only the resolved mobile Dialog branch and removes the media listener', async () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener,
      removeEventListener,
    }))
    const { unmount } = render(
      <OperatorShell permissions={['dashboard.read']} rightPanel={<p>오른쪽 패널 테스트 영역</p>} rightPanelOpen />,
    )

    await waitFor(() => expect(screen.getByRole('dialog', { name: '운영사 패널' })).toBeInTheDocument())
    expect(screen.queryByTestId('operator-right-panel')).not.toBeInTheDocument()
    unmount()
    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('shows group headings in the sidebar and drawer and no fake status badges', async () => {
    render(<OperatorShell permissions={['dashboard.read', 'workspace.read']} pathname="/admin" />)
    expect(screen.getByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '고객사' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '채널' })).not.toBeInTheDocument()
    expect(screen.queryByText(/AAL2|SOHEE CONTROL PLANE/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '운영사 메뉴 열기' }))
    const dialog = screen.getByRole('dialog', { name: '소희 관리자 메뉴' })
    expect(within(dialog).getByRole('heading', { name: '고객사' })).toBeInTheDocument()
  })

  it('opens the command palette with Ctrl+K, filters menus and navigates', async () => {
    render(<OperatorShell permissions={['dashboard.read', 'workspace.read']} pathname="/admin" />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const dialog = await screen.findByRole('dialog', { name: '빠른 이동' })
    const input = within(dialog).getByRole('combobox', { name: '메뉴 또는 고객사 검색' })
    fireEvent.change(input, { target: { value: '코호트' } })
    expect(within(dialog).getByRole('option', { name: /^코호트/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole('option', { name: /운영 현황/ })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('option', { name: /^코호트/ }))
    expect(push).toHaveBeenCalledWith('/admin/cohort')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '빠른 이동' })).not.toBeInTheDocument())
  })

  it('offers a workspace search entry that routes with an encoded query', async () => {
    render(<OperatorShell permissions={['dashboard.read', 'workspace.read']} pathname="/admin" />)
    fireEvent.click(screen.getByRole('button', { name: '빠른 이동 열기' }))
    const dialog = await screen.findByRole('dialog', { name: '빠른 이동' })
    const input = within(dialog).getByRole('combobox')
    fireEvent.change(input, { target: { value: '김 소희' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(push).toHaveBeenCalledWith('/admin/workspaces?query=%EA%B9%80%20%EC%86%8C%ED%9D%AC')
  })

  it('hides workspace search without workspace permission', async () => {
    render(<OperatorShell permissions={['dashboard.read']} pathname="/admin" />)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    const dialog = await screen.findByRole('dialog', { name: '빠른 이동' })
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '소희' } })
    expect(within(dialog).queryByRole('option', { name: /고객사 검색/ })).not.toBeInTheDocument()
  })
})
