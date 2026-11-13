import { expect, test, type Page } from '@playwright/test'
import {
  attachRuntimeProbe,
  expectAxeClean,
  expectNoHorizontalOverflow,
  expectNoInternalLeak,
  expectViewportMeta,
} from './support/gates'
import { saveJson, saveScreenshot } from './support/evidence'
import { desktopOnlyRoutes } from './support/routes'

/**
 * 데스크톱 폭 전용 화면 게이트 (ANI-1740).
 *
 * 768/820/1024/1280/1440 프로젝트에서만 실행된다. 여기서 검사하는 것은 "PC 셸" 이 아니라
 * 모바일 셸 프리뷰 프레임이다 — 프리뷰 프레임은 320~480px 모바일 셸을 데스크톱 화면 가운데에
 * 놓고 보는 도구이므로, 데스크톱 폭에서 페이지가 넘치지 않고 iframe 폭이 요청값으로 고정되는지를 본다.
 *
 * 개발 전용 라우트가 운영 빌드에서 404 이면 통과가 아니라 "미검증"으로 남긴다.
 */

const REQUESTED_FRAME_WIDTH = 390

async function readFrameWidth(page: Page): Promise<number> {
  const box = await page.locator('[data-mobile-r2-frame]').boundingBox()
  expect(box, '프리뷰 iframe 이 렌더되지 않음').not.toBeNull()
  return Math.round(box?.width ?? 0)
}

for (const route of desktopOnlyRoutes()) {
  test(`데스크톱 전용 화면: ${route.id}`, async ({ page }, info) => {
    const probe = attachRuntimeProbe(page)
    const res = await page.goto(route.path, { waitUntil: 'networkidle' })
    if (route.devOnly && res?.status() === 404) {
      test.skip(true, `${route.id}: 개발 서버 필요 (운영 빌드 404, 미검증) — ${route.issue}`)
    }
    expect(res?.status(), `${route.path} HTTP 상태`).toBeLessThan(400)
    await expect(page.locator('main, [role=main]').first()).toBeVisible()

    await expectNoHorizontalOverflow(page)
    await expectViewportMeta(page)
    await expectNoInternalLeak(page)
    await expectAxeClean(page)

    // 프리뷰 iframe 은 요청한 모바일 폭(390)으로 고정되어야 한다.
    expect(await readFrameWidth(page), '프리뷰 iframe 폭').toBe(REQUESTED_FRAME_WIDTH)
    await expect(page.locator('[data-mobile-r2-frame]')).toHaveAttribute('src', '/dev/mobile-r2')

    expect(probe.pageErrors, '페이지 오류').toEqual([])
    expect(probe.writes, '진입만으로 발생한 쓰기 요청').toEqual([])

    await saveScreenshot(page, info, route.issue, `${route.id}-desktop-preview`)
    saveJson(info, route.issue, `${route.id}-desktop-preview`, {
      route: route.path,
      status: res?.status() ?? null,
      frameWidth: await readFrameWidth(page),
      viewport: info.project.use.viewport ?? null,
      probe,
    })
  })
}

test('프리뷰 프레임은 데스크톱 폭을 흉내 내지 않는다 (허용 상한 480 고정)', async ({ page }, info) => {
  const res = await page.goto('/dev/mobile-r2/frame?w=900', { waitUntil: 'networkidle' })
  if (res?.status() === 404) {
    test.skip(true, 'dev-mobile-r2-frame: 개발 서버 필요 (운영 빌드 404, 미검증) — ANI-1740')
  }
  expect(res?.status()).toBeLessThan(400)
  // 480 초과 요청은 480 으로 보정된다. 즉 이 프레임은 768/1024/1440 데스크톱 레이아웃 검증용이 아니다.
  expect(await readFrameWidth(page), '프리뷰 iframe 폭 상한').toBe(480)
  await saveJson(info, 'ANI-1740', 'dev-mobile-r2-frame-clamp', { requested: 900, actual: await readFrameWidth(page) })
})
