import { expect, type Locator, type Page } from '@playwright/test'

/** 공개 셸 주요 목적지 정본 (public-shell.tsx 의 primaryNavigation 과 일치). */
export const PUBLIC_PRIMARY_NAV = [
  ['제품', '/product'],
  ['연결 채널', '/channels'],
  ['업종별 경험', '/industries/beauty'],
  ['요금', '/pricing'],
] as const

/**
 * ANI-1740 · Desktop/Tablet 원기능 보존 회귀 헬퍼 (QA 전용).
 *
 * 모바일 셸 도입 뒤에도 PC 가 "같은 URL·같은 계정에서 서로 다른 IA, 같은 데이터/권한"을 유지하는지
 * 브라우저에서 확인한다. 제품 코드는 건드리지 않고, 화면이 실제로 내려준 DOM/레이아웃만 판정한다.
 *
 * 폭 경계는 제품 CSS 와 같은 값을 쓴다:
 * - 앱 셸 760px — 이상이면 데스크톱 사이드바, 미만이면 하단 5탭
 * - 앱 셸 1200px — 사이드바 220px → 248px
 * - 공개 셸 700px — 이상이면 데스크톱 메뉴, 미만이면 햄버거
 *
 * 두 셸 모두 "DOM 에는 양쪽이 다 있고 CSS 로 숨긴다"는 구조이므로,
 * `:visible` 로 실제 노출된 쪽만 세는 것이 계약이다.
 */

/** ANI-1740 수락 기준 폭. */
export const DESKTOP_REGRESSION_WIDTHS = [768, 820, 1024, 1440] as const

/** 계약의 모바일 기준 폭(390→820→1440 의 시작점). */
export const CONTRACT_MOBILE_WIDTH = 390

/** 앱 셸이 데스크톱 IA 로 바뀌는 경계 (app-shell.module.css `@media (min-width: 760px)`). */
export const APP_SHELL_DESKTOP_BREAKPOINT = 760
/** 사이드바가 넓어지는 경계 (app-shell.module.css `@media (min-width: 1200px)`). */
export const APP_SHELL_WIDE_BREAKPOINT = 1200
/** 공개 셸이 햄버거로 바뀌는 경계 (marketing.module.css `@media (max-width: 700px)`). */
export const PUBLIC_SHELL_MOBILE_BREAKPOINT = 700

export interface AppShellIa {
  desktopSidebar: boolean
  /** 데스크톱일 때만 값이 있다. 모바일에서는 사이드바가 숨겨져 폭이 의미 없다. */
  sidebarWidth: number | null
  bottomNav: boolean
}

export function expectedAppShellIa(width: number): AppShellIa {
  const desktopSidebar = width >= APP_SHELL_DESKTOP_BREAKPOINT
  return {
    desktopSidebar,
    sidebarWidth: desktopSidebar ? (width >= APP_SHELL_WIDE_BREAKPOINT ? 248 : 220) : null,
    bottomNav: !desktopSidebar,
  }
}

export function viewportWidth(page: Page): number {
  const size = page.viewportSize()
  if (!size) throw new Error('viewportSize 를 읽을 수 없습니다 — 데스크톱/모바일 프로젝트에서만 실행하세요')
  return size.width
}

/**
 * 공개 셸(/, /pricing …) 데스크톱 IA.
 * 모바일 셸 작업이 공개 화면의 데스크톱 메뉴를 햄버거로 바꿔치기했는지 잡는다.
 */
export async function expectPublicDesktopIa(page: Page): Promise<void> {
  const width = viewportWidth(page)

  const desktopNav = page.locator('nav[aria-label="주요 메뉴"]:visible')
  await expect(desktopNav, `${width}px: 보이는 주요 메뉴는 정확히 하나`).toHaveCount(1)
  await expect(
    page.getByRole('button', { name: '메뉴 열기' }),
    `${width}px: 데스크톱 폭에서 햄버거 메뉴를 노출하면 안 됩니다`,
  ).toHaveCount(0)

  for (const [label, href] of PUBLIC_PRIMARY_NAV) {
    await expect(desktopNav.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href)
  }

  await expect(page.getByRole('main'), '공개 셸 본문은 하나').toHaveCount(1)
  await expect(page.locator('main')).toHaveAttribute('id', 'main-content')
  await expect(page.locator('a[href="#main-content"]'), '건너뛰기 링크').toHaveCount(1)
  // 공개 셸에는 모바일 앱 하단탭이 섞이면 안 된다.
  await expect(page.locator('[data-mobile-nav]')).toHaveCount(0)
}

export interface PublicMenuSnapshot {
  width: number
  /** 폭에 맞는 실제 메뉴에서 읽은 주요 목적지 (`라벨 → href`). */
  primary: string[]
  /** 주요 목적지 밖의 항목. 모바일 햄버거에는 로그인 진입점이 추가로 있다. */
  extra: string[]
  /** 그 폭에서 데스크톱 메뉴가 실제로 보였는지. */
  desktopMenuVisible: boolean
}

/**
 * 그 폭에서 **실제로 열리는** 메뉴에서 목적지를 읽는다.
 *
 * 데스크톱 폭에서는 `nav[aria-label="주요 메뉴"]` 를, 모바일 폭에서는 햄버거를 눌러
 * 다이얼로그 안의 `nav[aria-label="모바일 메뉴"]` 를 읽는다.
 * 숨겨진 데스크톱 nav 를 읽으면 햄버거가 없거나 열리지 않아도 초록이 되어
 * "390px 도 같은 목적지를 본다"는 거짓 증거가 남는다(Codex 리뷰 지적).
 */
export async function collectPublicMenuSnapshot(page: Page): Promise<PublicMenuSnapshot> {
  const width = viewportWidth(page)
  const desktopMenuVisible = (await page.locator('nav[aria-label="주요 메뉴"]:visible').count()) === 1

  let menu: Locator
  if (width >= PUBLIC_SHELL_MOBILE_BREAKPOINT) {
    menu = page.locator('nav[aria-label="주요 메뉴"]:visible')
  } else {
    const hamburger = page.getByRole('button', { name: '메뉴 열기' })
    await expect(hamburger, `${width}px: 햄버거 메뉴 버튼`).toBeVisible()
    await hamburger.click()
    menu = page.getByRole('dialog').locator('nav[aria-label="모바일 메뉴"]')
    await expect(menu, `${width}px: 햄버거를 눌러도 메뉴가 열리지 않음`).toBeVisible()
  }

  const entries = await menu
    .locator('a')
    .evaluateAll((els) => els.map((el) => `${el.textContent?.trim()} → ${el.getAttribute('href')}`))

  const primaryHrefs = new Set<string>(PUBLIC_PRIMARY_NAV.map(([, href]) => href))
  const primary = entries.filter((entry) => primaryHrefs.has(entry.split('→')[1]?.trim() ?? ''))
  const extra = entries.filter((entry) => !primary.includes(entry))

  return { width, primary, extra, desktopMenuVisible }
}

/**
 * 앱 셸 IA. 데스크톱 폭과 모바일 폭 **양쪽에서** 같은 계약을 판정한다.
 * - 760px 이상: 사이드바 표시 / 하단탭 숨김 / 사이드바 폭 220 또는 248
 * - 760px 미만: 사이드바 숨김 / 하단탭 표시
 * - 공통: 중복 내비게이션·중복 대화 패널 금지
 */
export async function expectAppShellIa(page: Page): Promise<void> {
  const width = viewportWidth(page)
  const ia = expectedAppShellIa(width)

  await expect(page.getByRole('main'), `${width}px: 앱 셸 본문은 하나`).toHaveCount(1)
  await expect(page.locator('main#app-main'), '건너뛰기 링크 대상 본문').toHaveCount(1)
  await expect(page.locator('a[href="#app-main"]')).toHaveCount(1)

  // 같은 접근성 이름("앱 메뉴")을 가진 nav 가 DOM 에는 사이드바/하단탭 둘 존재하지만,
  // 보이는 것은 정확히 하나여야 한다 — 중복 내비게이션 금지(ANI-1740 수락 기준).
  await expect(
    page.locator('nav[aria-label="앱 메뉴"]:visible'),
    `${width}px: 보이는 앱 메뉴는 정확히 하나`,
  ).toHaveCount(1)

  const sidebar = page.getByRole('complementary', { name: '주요 탐색' })
  if (ia.desktopSidebar) {
    await expect(sidebar, `${width}px: 데스크톱 사이드바 표시`).toBeVisible()
    await expect(page.locator('[data-mobile-nav]'), `${width}px: 하단탭 숨김`).not.toBeVisible()
    const box = await sidebar.boundingBox()
    expect(box, '사이드바 박스').not.toBeNull()
    expect(Math.round(box!.width), `${width}px: 사이드바 폭`).toBe(ia.sidebarWidth)
  } else {
    await expect(sidebar, `${width}px: 사이드바 숨김`).not.toBeVisible()
    const bottomNav = page.locator('[data-mobile-nav]')
    await expect(bottomNav, `${width}px: 하단탭 표시`).toBeVisible()
    // 하단탭은 화면 아래에 고정되어야 한다(콘텐츠와 겹치지 않고 스크롤을 따라온다).
    await expect(bottomNav).toHaveCSS('position', 'fixed')
  }

  // 대화 패널 중복 금지: 보이는 "최근 대화" 목록은 최대 하나.
  const visibleThreadPanels = await page.locator('nav[aria-label="최근 대화"]:visible').count()
  expect(visibleThreadPanels, `${width}px: 보이는 대화 패널 수`).toBeLessThanOrEqual(1)
}

/**
 * 작업공간·계정 경계.
 * 같은 계정이 폭만 바꿔도 동일한 작업공간 정본과 계정 진입점을 봐야 한다.
 */
export async function expectWorkspaceAccountBoundary(page: Page): Promise<void> {
  const width = viewportWidth(page)

  // 작업공간 진입점은 사이드바에만 있다 — 모바일에서는 하단탭에 섞이면 안 된다.
  const switcher = page.getByRole('link', { name: '작업공간 빠른 설정' })
  if (width >= APP_SHELL_DESKTOP_BREAKPOINT) {
    await expect(switcher, `${width}px: 작업공간 진입점은 사이드바에 정확히 하나`).toHaveCount(1)
    await expect(switcher).toHaveAttribute('href', '/app/settings/business')
  } else {
    await expect(switcher, `${width}px: 숨은 사이드바의 작업공간 진입점`).not.toBeVisible()
  }
  await expect(
    page.locator('[data-mobile-nav] a[href="/app/settings/business"]'),
    '하단탭에는 작업공간 설정이 없어야 합니다',
  ).toHaveCount(0)

  const accountToggle = page.getByRole('button', { name: '계정 메뉴 열기' })
  await expect(accountToggle, '계정 메뉴 토글은 정확히 하나').toHaveCount(1)
  await accountToggle.click()

  const accountPopover = page.locator('details')
  await expect(accountPopover.getByRole('link', { name: '나의 소희', exact: true })).toHaveAttribute(
    'href',
    '/app/account',
  )
  await expect(accountPopover.getByRole('link', { name: '작업공간 설정', exact: true })).toHaveAttribute(
    'href',
    '/app/settings/business',
  )
  await page.keyboard.press('Escape')
}
