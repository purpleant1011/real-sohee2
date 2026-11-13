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
  DESKTOP_REGRESSION_WIDTHS,
  PUBLIC_SHELL_MOBILE_BREAKPOINT,
  collectPublicMenuSnapshot,
  expectAppShellIa,
  expectPublicDesktopIa,
  expectWorkspaceAccountBoundary,
  viewportWidth,
} from './support/desktop-shell'

/**
 * ANI-1740 · Desktop/Tablet 원기능 보존 회귀 + 계정 경계 교차 점검.
 *
 * 768/820/1024/1280/1440 프로젝트에서 실행된다(.desktop.spec.ts).
 * 수락 기준: "width 390→820→1440, 동일 URL·동일 계정에서 의도한 서로 다른 IA,
 * 데이터·권한 동일, 중복 navigation/대화패널 없음".
 *
 * 390px(모바일) 쪽은 `desktop-shell.mobile.spec.ts` 가 같은 헬퍼로 검사한다 —
 * `.desktop.spec.ts` 는 데스크톱 프로젝트에서만 돌기 때문에 모바일 분기를 여기 두면
 * 영원히 실행되지 않는다(Codex 리뷰 지적).
 *
 * 계층:
 * 1) 공개 화면 — 계정 없이 지금 바로 검증 가능한 데스크톱 IA(메뉴/본문/건너뛰기).
 * 2) 앱 셸 — 실계정 세션(MOBILE_R2_STORAGE_STATE)이 있어야 한다. 없으면 skip 하고
 *    "미검증"으로 남긴다(통과로 치환하지 않는다).
 */

const storageState = process.env.MOBILE_R2_STORAGE_STATE
const PUBLIC_ROUTES = ['/', '/pricing'] as const

for (const path of PUBLIC_ROUTES) {
  test(`공개 화면 데스크톱 IA 보존: ${path}`, async ({ page, baseURL }, info) => {
    const width = viewportWidth(page)
    const probe = attachRuntimeProbe(page)
    // 정본 모바일 게이트와 동일하게, 내비게이션 **전에** 앱 오리진 밖 호출을 차단한다.
    // 프로브는 실패한 요청만 모으므로, 성공한 외부 GET 은 이 차단기 없이는 보이지 않는다.
    const blocked = await blockExternalOrigins(page, new URL(baseURL!).origin)

    const res = await page.goto(path, { waitUntil: 'networkidle' })
    expect(res?.status(), `${path} HTTP 상태`).toBeLessThan(400)

    await expectPublicDesktopIa(page)
    await expectNoHorizontalOverflow(page)
    await expectNoInternalLeak(page)
    expect(probe.pageErrors, '페이지 오류').toEqual([])
    expect(probe.writes, '조회 진입만으로 발생한 쓰기 요청').toEqual([])
    expect(blocked, '앱 오리진 밖 호출').toEqual([])

    const name = `public-desktop-ia${path === '/' ? '-home' : '-pricing'}`
    await saveScreenshot(page, info, 'ANI-1740', name)
    saveJson(info, 'ANI-1740', name, {
      route: path,
      width,
      expectedWidths: DESKTOP_REGRESSION_WIDTHS,
      blocked,
      probe,
    })
  })
}

test('같은 URL·같은 조건: 폭만 바뀌고 메뉴 정본은 동일하다', async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== 'tablet-768', '폭 교차 비교는 한 프로젝트에서 한 번만 실행합니다')

  const widths = [CONTRACT_MOBILE_WIDTH, ...DESKTOP_REGRESSION_WIDTHS] as const
  const snapshots = []

  for (const width of widths) {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } })
    const page = await context.newPage()
    await page.goto('/pricing', { waitUntil: 'networkidle' })

    // 모바일 폭에서는 햄버거를 실제로 열어 그 안의 메뉴를 읽는다.
    snapshots.push(await collectPublicMenuSnapshot(page))
    await context.close()
  }

  // 데이터·권한 동일: 폭과 무관하게 주요 목적지 집합이 같아야 한다.
  for (const snapshot of snapshots) {
    expect(snapshot.primary, `${snapshot.width}px 메뉴 정본`).toEqual(snapshots[0].primary)
  }
  expect(snapshots[0].primary, '주요 목적지가 비어 있으면 비교가 무의미하다').toHaveLength(4)

  // IA 는 폭에 따라 다르다: 700px 경계 미만만 햄버거(데스크톱 메뉴 숨김).
  expect(
    snapshots.filter((s) => s.desktopMenuVisible).map((s) => s.width),
    '데스크톱 메뉴가 보이는 폭',
  ).toEqual([...DESKTOP_REGRESSION_WIDTHS])
  expect(
    snapshots.filter((s) => !s.desktopMenuVisible).map((s) => s.width),
    '햄버거로 전환되는 폭',
  ).toEqual(widths.filter((w) => w < PUBLIC_SHELL_MOBILE_BREAKPOINT))

  // 모바일 햄버거에는 로그인 진입점이 추가로 있다 — 데스크톱에는 없어야 한다.
  const mobile = snapshots.find((s) => s.width === CONTRACT_MOBILE_WIDTH)!
  expect(mobile.extra.join(' '), '모바일 메뉴의 로그인 진입점').toMatch(/소희 로그인/u)
  for (const snapshot of snapshots.filter((s) => s.desktopMenuVisible)) {
    expect(snapshot.extra, `${snapshot.width}px 데스크톱 메뉴에는 부가 항목이 없어야 합니다`).toEqual([])
  }

  saveJson(info, 'ANI-1740', 'public-width-crosscheck', { snapshots })
})

test.describe('데스크톱 앱 셸 (실계정 필요)', () => {
  if (storageState) test.use({ storageState })

  test('앱 셸 IA·작업공간/계정 경계가 폭별로 유지된다', async ({ page, baseURL }, info) => {
    test.skip(
      !storageState,
      'ANI-1740 미검증: MOBILE_R2_STORAGE_STATE(실계정 세션)가 없어 /app 데스크톱 셸을 확인할 수 없습니다',
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

    await saveScreenshot(page, info, 'ANI-1740', 'app-shell-desktop-ia')
    saveJson(info, 'ANI-1740', 'app-shell-desktop-ia', {
      route: '/app',
      width,
      expectedWidths: DESKTOP_REGRESSION_WIDTHS,
      blocked,
      probe,
    })
  })

  test('작업공간 전환기는 서버 정본 매장만 보여준다', async ({ page }) => {
    test.fixme(
      true,
      'ANI-1740 발견: GlobalAgentBar 작업공간 드롭다운이 "우리 매장/본점/+ 새 매장 작업공간 추가"를 하드코딩한다. ' +
        '실계정 2개 교차 확인 후 서버 정본으로 교체해야 한다.',
    )

    await page.goto('/app', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /작업공간 선택/u }).click()
    await expect(page.getByRole('menu')).toBeVisible()

    // 기대(미구현): 드롭다운 항목은 현재 계정의 workspace_members 목록과 일치해야 한다.
    const items = await page.getByRole('menuitem').allTextContents()
    expect(items.join(' ')).not.toMatch(/본점|새 매장 작업공간 추가/u)
  })
})
