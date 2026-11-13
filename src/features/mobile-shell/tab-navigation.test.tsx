import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * ANI-1664 수락 기준(5탭 전환 시 스크롤·URL 복귀, 하위 경로 뒤로가기)을
 * 사용자 행동 단위로 고정한다. 순수 함수 계약은 shell.test.ts 가 이미 덮는다.
 */
const nav = vi.hoisted(() => ({ pathname: '/app', search: '', pending: false, push: vi.fn(), back: vi.fn() }))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useTransition: () => [nav.pending, (navigate: () => void) => navigate()],
}))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push, back: nav.back }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => {
    delete rest.prefetch
    return <a href={href} {...rest}>{children}</a>
  },
}))

const code = vi.hoisted(() => ({ warm: vi.fn().mockResolvedValue(true), schedule: vi.fn() }))
vi.mock('./tab-code-warmup', () => ({ warmR2TabCode: code.warm, useR2TabCodeWarmup: code.schedule }))

const buildUpdate = vi.hoisted(() => ({ navigate: vi.fn().mockReturnValue(false) }))
vi.mock('../pwa/build-update', () => ({ buildUpdateNavigation: buildUpdate }))

import { MobileAppShell } from './index'

const SCROLL_KEY = (key: string) => `sohee.shell.scroll:${key}`
const TAB_KEY = (tab: string) => `sohee.shell.tab:${tab}`

function shell(children: React.ReactNode = <p>본문</p>) {
  return <MobileAppShell>{children}</MobileAppShell>
}

function scroller(): HTMLElement {
  return document.querySelector('main')!
}

/** 실제 스크롤처럼 보이게 scrollTop 을 바꾸고 scroll 이벤트를 보낸다. */
function scrollTo(top: number) {
  const el = scroller()
  Object.defineProperty(el, 'scrollTop', { value: top, writable: true, configurable: true })
  fireEvent.scroll(el)
}

/** 다음 프레임까지 진행시켜 rAF 로 예약된 저장이 실행되게 한다. */
async function nextFrame() {
  await act(async () => { await new Promise(r => requestAnimationFrame(() => r(null))) })
}

beforeEach(() => {
  buildUpdate.navigate.mockReset().mockReturnValue(false)
  nav.pathname = '/app'
  nav.search = ''
  nav.pending = false
  nav.push.mockClear()
  nav.back.mockClear()
  code.warm.mockClear()
  code.schedule.mockClear()
  window.sessionStorage.clear()
  HTMLElement.prototype.scrollTo = vi.fn()
})

describe('5탭 정적 코드 준비 — 비공개 데이터는 미리 조회하지 않는다', () => {
  function scoped() {
    return <WorkspaceProvider value={{ workspaceId: '11111111-1111-4111-8111-111111111111', workspaceName: '테스트', workspaceKind: null, membershipRole: 'owner', actorId: 'owner', resolutionSource: 'membership' }}>{shell()}</WorkspaceProvider>
  }
  it('인가된 셸의 포커스·포인터는 코드만 준비하고 이동은 클릭까지 기다린다', () => {
    render(scoped())
    fireEvent.focus(screen.getByRole('link', { name: '작업' }))
    fireEvent.pointerEnter(screen.getByRole('link', { name: '고객' }))
    expect(code.warm).toHaveBeenCalledWith('work')
    expect(code.warm).toHaveBeenCalledWith('customers')
    expect(nav.push).not.toHaveBeenCalled()
  })
  it('실제 router transition 대기 상태는 완료가 아닌 로딩으로 안내한다', () => {
    nav.pending = true
    render(scoped())
    expect(screen.getByRole('status')).toHaveTextContent('화면을 여는 중이에요.')
    expect(scroller()).toHaveAttribute('aria-busy', 'true')
    const preview = process.env.SOHEE_R2_NAV_PREVIEW_PATH
    if (preview) {
      mkdirSync(dirname(preview), { recursive: true })
      writeFileSync(preview, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><p style="position:fixed;top:0;right:0;z-index:100;font-size:9px;background:white;color:black">로컬 R2 fixture · 전환 상태 합성 · API 없음</p>${document.body.innerHTML}</body></html>`)
    }
  })
  it('검토 화면에서는 백그라운드 코드 준비를 요청하지 않는다', () => {
    nav.pathname = '/app/approvals'
    render(scoped())
    expect(code.schedule.mock.calls.at(-1)?.[0]).toBeNull()
  })
  it('인가된 workspace 컨텍스트가 없으면 포커스로 코드를 미리 받지 않는다', () => {
    render(shell())
    fireEvent.focus(screen.getByRole('link', { name: '작업' }))
    expect(code.warm).not.toHaveBeenCalled()
  })
})

describe('페이지 교체 중에도 유지되는 셸', () => {
  it('페이지가 자신의 셸을 선언해도 레이아웃 셸과 메뉴를 중복 마운트하지 않는다', () => {
    render(<MobileAppShell><MobileAppShell><p>작업 내용</p></MobileAppShell></MobileAppShell>)
    expect(document.querySelectorAll('[data-mobile-shell]')).toHaveLength(1)
    expect(screen.getAllByRole('navigation', { name: '소희 업무 메뉴' })).toHaveLength(1)
    expect(screen.getByText('작업 내용')).toBeVisible()
  })

  it('서버 응답 전에도 누른 탭을 즉시 표시하되 완료된 경로라고 주장하지 않는다', () => {
    nav.pending = true
    render(shell())
    fireEvent.click(screen.getByRole('link', { name: '작업' }))
    expect(screen.getByRole('link', { name: '작업' })).toHaveAttribute('data-pending', 'true')
    expect(screen.getByRole('link', { name: '오늘' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '작업' })).not.toHaveAttribute('aria-current')
    expect(scroller()).toHaveAttribute('aria-busy', 'true')
  })

  it('연속 입력은 마지막으로 누른 탭만 대기 표시하고 완료되면 해제한다', () => {
    nav.pending = true
    const view = render(shell())
    fireEvent.click(screen.getByRole('link', { name: '작업' }))
    fireEvent.click(screen.getByRole('link', { name: '고객' }))
    expect(screen.getByRole('link', { name: '작업' })).not.toHaveAttribute('data-pending')
    expect(screen.getByRole('link', { name: '고객' })).toHaveAttribute('data-pending', 'true')
    act(() => { nav.pathname = '/app/customers'; nav.pending = false; view.rerender(shell()) })
    expect(document.querySelector('[data-pending]')).toBeNull()
    expect(screen.getByRole('link', { name: '고객' })).toHaveAttribute('aria-current', 'page')
    expect(scroller()).toHaveAttribute('aria-busy', 'false')
  })

  it('이동이 취소돼 경로가 그대로여도 대기 표시는 남지 않는다', () => {
    nav.pending = true
    const view = render(shell())
    fireEvent.click(screen.getByRole('link', { name: '작업' }))
    act(() => { nav.pending = false; view.rerender(shell()) })
    expect(document.querySelector('[data-pending]')).toBeNull()
    expect(screen.getByRole('link', { name: '오늘' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('5탭 전환 — URL 복귀', () => {
  it('새 문서 전환이 준비되면 복원된 필터로 이동하고 구형 라우터를 실행하지 않는다', () => {
    buildUpdate.navigate.mockReturnValue(true)
    window.sessionStorage.setItem(TAB_KEY('work'), '/app/content?f=draft')
    render(shell())
    fireEvent.click(screen.getByRole('link', { name: '작업' }))
    expect(buildUpdate.navigate).toHaveBeenCalledWith('/app/content?f=draft')
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('다른 탭을 누르면 그 탭의 마지막 URL(필터 포함)로 돌아간다', () => {
    window.sessionStorage.setItem(TAB_KEY('work'), '/app/content?f=draft')
    render(shell())
    fireEvent.click(screen.getByRole('link', { name: '작업' }))
    expect(nav.push).toHaveBeenCalledWith('/app/content?f=draft')
  })

  it('마지막 위치가 없으면 탭 루트로 간다', () => {
    render(shell())
    fireEvent.click(screen.getByRole('link', { name: '성과' }))
    expect(nav.push).toHaveBeenCalledWith('/app/results')
  })

  it('같은 탭의 하위 화면에서 누르면 그 탭 루트로 간다', () => {
    nav.pathname = '/app/vault/archive'
    render(shell())
    fireEvent.click(screen.getByRole('link', { name: '작업' }))
    expect(nav.push).toHaveBeenCalledWith('/app/content')
  })

  it('같은 탭 루트에서 누르면 맨 위로만 올린다', () => {
    nav.pathname = '/app/content'
    render(shell())
    fireEvent.click(screen.getByRole('link', { name: '작업' }))
    expect(nav.push).not.toHaveBeenCalled()
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('탭을 떠났다 돌아오면 저장된 URL 을 빈 쿼리 없이 복원한다', () => {
    // '/app' 을 방문했다가 작업 탭으로 이동한 상황.
    nav.pathname = '/app'
    const view = render(shell())
    act(() => { nav.pathname = '/app/content'; view.rerender(shell()) })
    nav.push.mockClear()
    fireEvent.click(screen.getByRole('link', { name: '오늘' }))
    expect(nav.push).toHaveBeenCalledWith('/app')
  })
})

describe('5탭 전환 — 스크롤 복귀', () => {
  it('같은 경로로 돌아오면 저장된 위치로 복원한다', () => {
    window.sessionStorage.setItem(SCROLL_KEY('/app/content'), '420')
    nav.pathname = '/app/content'
    render(shell())
    expect(scroller().scrollTop).toBe(420)
  })

  it('스크롤 직후 탭을 옮겨도 마지막 위치가 저장된다', async () => {
    nav.pathname = '/app/content'
    const view = render(shell())
    scrollTo(640)
    // 저장 예약(rAF)이 실행되기 전에 화면을 떠난다 — 사용자가 스크롤하고 바로 탭을 누르는 경우.
    act(() => { nav.pathname = '/app'; view.rerender(shell()) })
    expect(window.sessionStorage.getItem(SCROLL_KEY('/app/content'))).toBe('640')
    await nextFrame()
  })

  it('스크롤 후 잠시 머무르면 위치가 저장되고, 그 탭으로 돌아오면 그 위치가 복원된다', async () => {
    nav.pathname = '/app/content'
    const view = render(shell())
    scrollTo(300)
    await nextFrame()
    expect(window.sessionStorage.getItem(SCROLL_KEY('/app/content'))).toBe('300')

    act(() => { nav.pathname = '/app'; view.rerender(shell()) })
    act(() => { nav.pathname = '/app/content'; view.rerender(shell()) })
    expect(scroller().scrollTop).toBe(300)
  })

  it('저장소가 비어 있으면 맨 위에서 시작한다', () => {
    nav.pathname = '/app/content'
    render(shell())
    expect(scroller().scrollTop).toBe(0)
  })
})

describe('하위 경로 뒤로가기', () => {
  it('직접 진입(앱 내 이력 없음)하면 라우트 fallback 으로 보낸다', () => {
    nav.pathname = '/app/work/p1'
    render(shell())
    fireEvent.click(screen.getByLabelText('뒤로'))
    expect(nav.push).toHaveBeenCalledWith('/app/content')
    expect(nav.back).not.toHaveBeenCalled()
  })

  it('앱 안에서 이동해 왔으면 브라우저 이력을 되돌린다', () => {
    nav.pathname = '/app/content'
    const view = render(shell())
    act(() => { nav.pathname = '/app/work/p1'; view.rerender(shell()) })
    fireEvent.click(screen.getByLabelText('뒤로'))
    expect(nav.back).toHaveBeenCalledOnce()
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('안전한 ?from= 이 있으면 이력이 없어도 그리로 돌아간다', () => {
    nav.pathname = '/app/work/p1'
    nav.search = 'from=%2Fapp%2Fvault'
    render(shell())
    fireEvent.click(screen.getByLabelText('뒤로'))
    expect(nav.push).toHaveBeenCalledWith('/app/vault')
  })

  it('외부 주소 ?from= 은 무시하고 라우트 fallback 을 쓴다', () => {
    nav.pathname = '/app/work/p1'
    nav.search = 'from=https%3A%2F%2Fevil.example'
    render(shell())
    fireEvent.click(screen.getByLabelText('뒤로'))
    expect(nav.push).toHaveBeenCalledWith('/app/content')
  })
})
