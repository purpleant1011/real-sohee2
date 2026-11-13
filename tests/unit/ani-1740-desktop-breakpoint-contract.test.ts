import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mediaMatches, resolveDeclarations, selectorApplies } from './helpers/css-media'

vi.mock('@/features/auth/actions', () => ({
  signOutAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

import { AppShell } from '@/components/app-shell/app-shell'

/**
 * ANI-1740 · Desktop/Tablet 원기능 보존 회귀 (계약 계층).
 *
 * 모바일 셸 도입이 PC IA 를 갈아엎지 않았는지는 네 폭(768/820/1024/1440)에서
 * "어느 레이아웃 규칙이 실제로 이기는가"로 판정한다. 브라우저 없이 돌아가는 이 계약 테스트가
 * 실패하면 Playwright 데스크톱 증거를 보기 전에 이미 회귀다.
 *
 * 폭별 기대 IA:
 * - 768/820/1024: 데스크톱 사이드바(220px) + 모바일 하단탭 숨김
 * - 1440: 사이드바가 248px 로 넓어지고 나머지는 동일
 * - 390(대조군): 사이드바 숨김 + 하단탭 표시 (데스크톱 규칙이 모바일로 새지 않았는지)
 */

const APP_SHELL_CSS = readFileSync(
  join(process.cwd(), 'src/components/app-shell/app-shell.module.css'),
  'utf8',
)
const PUBLIC_SHELL_CSS = readFileSync(
  join(process.cwd(), 'src/features/marketing/marketing.module.css'),
  'utf8',
)

/** ANI-1740 수락 기준 폭. 목록 자체가 계약이므로 여기서 고정한다. */
const DESKTOP_WIDTHS = [768, 820, 1024, 1440] as const
const SIDEBAR_ONLY_WIDTHS = [768, 820, 1024] as const

describe('ANI-1740 앱 셸 폭 계약', () => {
  it.each(DESKTOP_WIDTHS)('%ipx: 데스크톱 사이드바 IA 를 쓴다', (width) => {
    const sidebar = resolveDeclarations(APP_SHELL_CSS, ['.desktopSidebar.sidebar'], width)
    const mobileNav = resolveDeclarations(APP_SHELL_CSS, ['.mobileNav'], width)
    const shell = resolveDeclarations(APP_SHELL_CSS, ['.shell'], width)

    expect(sidebar.display, `${width}px 사이드바 표시`).toBe('grid')
    expect(mobileNav.display, `${width}px 하단탭 숨김`).toBe('none')
    expect(shell.display, `${width}px 셸 그리드`).toBe('grid')
  })

  it.each(SIDEBAR_ONLY_WIDTHS)('%ipx: 사이드바는 220px 고정 폭이다', (width) => {
    const shell = resolveDeclarations(APP_SHELL_CSS, ['.shell'], width)
    expect(shell['grid-template-columns']).toBe('220px minmax(0, 1fr)')
  })

  it('1440px: 사이드바가 248px 로 확장된다 (1200px 경계)', () => {
    const shell = resolveDeclarations(APP_SHELL_CSS, ['.shell'], 1440)
    expect(shell['grid-template-columns']).toBe('248px minmax(0, 1fr)')
  })

  it('390px: 모바일 하단탭 IA 를 유지한다 (데스크톱 규칙 누출 없음)', () => {
    const sidebar = resolveDeclarations(APP_SHELL_CSS, ['.desktopSidebar.sidebar'], 390)
    const mobileNav = resolveDeclarations(APP_SHELL_CSS, ['.mobileNav'], 390)
    const shell = resolveDeclarations(APP_SHELL_CSS, ['.shell'], 390)

    expect(sidebar.display).toBe('none')
    expect(mobileNav.display).toBe('grid')
    // 모바일에는 데스크톱 2단 그리드가 적용되면 안 된다.
    expect(shell['grid-template-columns']).toBeUndefined()
  })
})

describe('ANI-1740 공개 화면 폭 계약', () => {
  it.each(DESKTOP_WIDTHS)('%ipx: 데스크톱 메뉴를 쓰고 햄버거를 숨긴다', (width) => {
    const desktopNav = resolveDeclarations(PUBLIC_SHELL_CSS, ['.desktopNav'], width)
    const menuButton = resolveDeclarations(PUBLIC_SHELL_CSS, ['.menuButton'], width)

    expect(desktopNav.display, `${width}px 데스크톱 메뉴`).toBe('flex')
    expect(menuButton.display, `${width}px 햄버거 숨김`).toBe('none')
  })

  it('390px: 햄버거 메뉴로 전환된다', () => {
    const desktopNav = resolveDeclarations(PUBLIC_SHELL_CSS, ['.desktopNav'], 390)
    const menuButton = resolveDeclarations(PUBLIC_SHELL_CSS, ['.menuButton'], 390)

    expect(desktopNav.display).toBe('none')
    expect(menuButton.display).toBe('inline-flex')
  })
})

describe('ANI-1740 검사기 자기검증 (거짓 PASS 방지)', () => {
  // 위 계약이 "항상 통과하는 검사"가 아님을 증명한다. 데스크톱 규칙을 지우면 반드시 깨져야 한다.
  const withoutDesktopRule = APP_SHELL_CSS.replace(/@media \(min-width: 760px\)/u, '@media (min-width: 99999px)')

  it('760px 규칙이 사라지면 768px 계약이 실제로 실패한다', () => {
    expect(withoutDesktopRule).not.toBe(APP_SHELL_CSS)
    const sidebar = resolveDeclarations(withoutDesktopRule, ['.desktopSidebar.sidebar'], 768)
    const mobileNav = resolveDeclarations(withoutDesktopRule, ['.mobileNav'], 768)

    expect(sidebar.display).toBe('none')
    expect(mobileNav.display).toBe('grid')
  })

  it('1200px 규칙이 사라지면 1440px 사이드바 폭 계약이 실제로 실패한다', () => {
    const withoutWideRule = APP_SHELL_CSS.replace(/@media \(min-width: 1200px\)/u, '@media (min-width: 99999px)')
    expect(withoutWideRule).not.toBe(APP_SHELL_CSS)
    expect(resolveDeclarations(withoutWideRule, ['.shell'], 1440)['grid-template-columns']).toBe(
      '220px minmax(0, 1fr)',
    )
  })

  it('문맥 선택자(.조상 .대상)도 대상에 적용되는 규칙으로 계산한다', () => {
    // 문자열 완전 일치만 보면 이 규칙을 놓쳐, 실제 DOM 에서 이기는 선언을 거짓으로 무시한다.
    const css = `
      .mobileNav { display: grid; }
      @media (min-width: 760px) { .mobileNav { display: none; } }
      @media (min-width: 760px) { .shell .mobileNav { display: grid; } }
    `
    expect(selectorApplies('.shell .mobileNav', '.mobileNav')).toBe(true)
    expect(selectorApplies('.navLink', '.mobileNav')).toBe(false)
    // 명시도 (0,2,0) 이 (0,1,0) 을 이기므로 데스크톱에서 다시 grid 가 이긴다.
    expect(resolveDeclarations(css, ['.mobileNav'], 1024).display).toBe('grid')
  })

  it('해석하지 않는 미디어 토큰은 참으로 치환하지 않는다 (fail-closed)', () => {
    expect(mediaMatches('(min-width: 760px)', 1024)).toBe(true)
    expect(mediaMatches('(max-width: 430px)', 1024)).toBe(false)
    // 화면 폭만 보면 참이지만 실제 화면 브라우저에는 적용되지 않는다.
    expect(mediaMatches('print and (min-width: 760px)', 1024)).toBe(false)
    expect(mediaMatches('not all and (min-width: 760px)', 1024)).toBe(false)
    expect(mediaMatches('screen and (min-width: 760px)', 1024)).toBe(false)
    // 미디어 목록은 OR 이다.
    expect(mediaMatches('(min-width: 2000px), (max-width: 1200px)', 1024)).toBe(true)
  })
})

describe('ANI-1740 앱 셸 경계 구조', () => {
  function renderShell() {
    return render(
      createElement(
        AppShell,
        { activePathname: '/app', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        createElement('p', null, '대화 본문'),
      ),
    )
  }

  it('내비게이션 계층이 데스크톱/모바일 하나씩만 존재한다 (중복 없음)', () => {
    const { container } = renderShell()

    const desktopLayers = container.querySelectorAll('[data-v07-column="navigation"]')
    const mobileLayers = container.querySelectorAll('[data-mobile-nav]')

    expect(desktopLayers).toHaveLength(1)
    expect(mobileLayers).toHaveLength(1)
    // 같은 접근성 이름(nav "앱 메뉴")을 가진 계층이 둘이지만, CSS 로 한쪽만 보인다.
    expect(desktopLayers[0].querySelectorAll('nav[aria-label="앱 메뉴"]')).toHaveLength(1)
    expect(mobileLayers[0].tagName.toLowerCase()).toBe('nav')
  })

  it('모바일 하단탭에는 작업공간·계정 진입점이 없다 (경계 분리)', () => {
    const { container } = renderShell()
    const mobileNav = container.querySelector('[data-mobile-nav]')
    expect(mobileNav).not.toBeNull()

    expect(mobileNav!.querySelector('[aria-label="작업공간 빠른 설정"]')).toBeNull()
    expect(mobileNav!.querySelector('[aria-label="계정 메뉴 열기"]')).toBeNull()
  })

  it('작업공간 진입점은 사이드바에 정확히 하나, 정본 설정 경로를 가리킨다', () => {
    const { container } = renderShell()
    const switchers = container.querySelectorAll('a[aria-label="작업공간 빠른 설정"]')

    expect(switchers).toHaveLength(1)
    expect(switchers[0].getAttribute('href')).toBe('/app/settings/business')
  })

  it('계정 메뉴는 정확히 하나이고 계정/작업공간 설정으로만 이어진다', () => {
    const { container } = renderShell()
    const menus = container.querySelectorAll('details')
    expect(menus).toHaveLength(1)

    const summary = menus[0].querySelector('summary')
    expect(summary?.getAttribute('aria-label')).toBe('계정 메뉴 열기')

    const links = [...menus[0].querySelectorAll('a')].map((a) => ({
      href: a.getAttribute('href'),
      label: a.textContent?.trim() ?? '',
    }))
    expect(links).toEqual([
      { href: '/app/account', label: '나의 소희' },
      { href: '/app/settings/business', label: '작업공간 설정' },
    ])
  })

  it('본문은 하나이고 건너뛰기 링크가 그 본문을 가리킨다', () => {
    const { container } = renderShell()

    expect(screen.getAllByRole('main')).toHaveLength(1)
    const main = container.querySelector('main')
    expect(main?.id).toBe('app-main')

    const skipLink = container.querySelector('a[href="#app-main"]')
    expect(skipLink?.textContent?.trim()).toBe('본문으로 바로가기')
  })
})
