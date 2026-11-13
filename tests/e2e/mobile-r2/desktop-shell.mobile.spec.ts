import { expect, test } from '@playwright/test'
import {
  attachRuntimeProbe,
  blockExternalOrigins,
  expectNoHorizontalOverflow,
  expectNoInternalLeak,
} from './support/gates'
import { saveJson, saveScreenshot } from './support/evidence'
import {
  CONTRACT_MOBILE_WIDTH,
  PUBLIC_PRIMARY_NAV,
  PUBLIC_SHELL_MOBILE_BREAKPOINT,
  collectPublicMenuSnapshot,
  expectAppShellIa,
  expectWorkspaceAccountBoundary,
  viewportWidth,
} from './support/desktop-shell'

/**
 * ANI-1740 · 모바일 폭(320~430) 앱 셸 IA — 수락 기준 "390→820→1440" 의 390 쪽.
 *
 * `.desktop.spec.ts` 는 데스크톱 프로젝트에서만 실행되므로, 사이드바 숨김/하단탭 표시 분기는
 * 거기 두면 영원히 실행되지 않는다(Codex 리뷰 지적). 같은 헬퍼(`expectAppShellIa`)를
 * 모바일 프로젝트에서 돌려 `<760` 분기를 실제로 통과시킨다.
 *
 * `support/routes.ts` 의 `/app` 은 아직 `planned` 라 공통 라우트 게이트에서 skip 된다.
 * 이 스펙은 그 등록 상태를 건드리지 않고(다른 창 소관) 계정 세션이 있을 때만 직접 검사한다.
 */

const storageState = process.env.MOBILE_R2_STORAGE_STATE

/**
 * 390px 공개 화면 햄버거 — 계정 없이 실행되는 실검증.
 *
 * 교차 비교(tablet-768 프로젝트의 viewport override)와 별개로, **실제 iOS/Android 엔진
 * 프로젝트**에서 햄버거가 열리고 목적지가 정본과 같은지 확인한다. 엔진별로 Dialog 포커스
 * 트랩·터치 이벤트가 달라, 데스크톱 Chromium 한 번으로는 대체되지 않는다.
 */
test('390 계약: 공개 햄버거가 실제로 열리고 정본 목적지를 담는다', async ({ page, baseURL }, info) => {
  const width = viewportWidth(page)
  expect(width, '모바일 프로젝트에서만 실행').toBeLessThan(PUBLIC_SHELL_MOBILE_BREAKPOINT)

  const probe = attachRuntimeProbe(page)
  const blocked = await blockExternalOrigins(page, new URL(baseURL!).origin)

  const res = await page.goto('/pricing', { waitUntil: 'networkidle' })
  expect(res?.status(), '/pricing HTTP 상태').toBeLessThan(400)

  // 데스크톱 메뉴는 CSS 로 숨겨져 있어야 한다(보이면 IA 전환이 깨진 것).
  await expect(page.locator('nav[aria-label="주요 메뉴"]:visible')).toHaveCount(0)

  const snapshot = await collectPublicMenuSnapshot(page)
  expect(snapshot.desktopMenuVisible, '모바일 폭에서 데스크톱 메뉴가 보임').toBe(false)
  expect(snapshot.primary, '햄버거 안 주요 목적지').toEqual(
    PUBLIC_PRIMARY_NAV.map(([label, href]) => `${label} → ${href}`),
  )
  expect(snapshot.extra.join(' '), '모바일 메뉴의 로그인 진입점').toMatch(/소희 로그인/u)

  await expectNoHorizontalOverflow(page)
  await expectNoInternalLeak(page)
  expect(probe.pageErrors, '페이지 오류').toEqual([])
  expect(probe.writes, '조회 진입만으로 발생한 쓰기 요청').toEqual([])
  expect(blocked, '앱 오리진 밖 호출').toEqual([])

  await saveScreenshot(page, info, 'ANI-1740', 'public-mobile-hamburger')
  saveJson(info, 'ANI-1740', 'public-mobile-hamburger', {
    route: '/pricing',
    width,
    snapshot,
    blocked,
    probe,
  })
})

test.describe('모바일 앱 셸 IA (실계정 필요)', () => {
  if (storageState) test.use({ storageState })

  test('390 계약: 사이드바 숨김·하단탭 고정·작업공간/계정 경계', async ({ page, baseURL }, info) => {
    test.skip(
      !storageState,
      'ANI-1740 미검증: MOBILE_R2_STORAGE_STATE(실계정 세션)가 없어 /app 모바일 셸을 확인할 수 없습니다',
    )

    const width = viewportWidth(page)
    const probe = attachRuntimeProbe(page)
    const blocked = await blockExternalOrigins(page, new URL(baseURL!).origin)

    const res = await page.goto('/app', { waitUntil: 'networkidle' })
    expect(res?.status(), '/app HTTP 상태').toBeLessThan(400)

    await expectAppShellIa(page)
    await expectWorkspaceAccountBoundary(page)
    await expectNoHorizontalOverflow(page)
    await expectNoInternalLeak(page)
    expect(probe.pageErrors, '페이지 오류').toEqual([])
    expect(probe.writes, '조회 진입만으로 발생한 쓰기 요청').toEqual([])
    expect(blocked, '앱 오리진 밖 호출').toEqual([])

    const name = width === CONTRACT_MOBILE_WIDTH ? 'app-shell-mobile-ia-390' : 'app-shell-mobile-ia'
    await saveScreenshot(page, info, 'ANI-1740', name)
    saveJson(info, 'ANI-1740', name, {
      route: '/app',
      width,
      contractWidth: CONTRACT_MOBILE_WIDTH,
      blocked,
      probe,
    })
  })
})
