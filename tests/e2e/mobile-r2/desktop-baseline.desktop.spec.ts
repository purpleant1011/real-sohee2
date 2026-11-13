import { expect, test, type Page } from '@playwright/test'
import { attachRuntimeProbe, expectAxeClean, expectNoHorizontalOverflow } from './support/gates'
import { pcBaselineRoutes } from './support/routes'

/**
 * Desktop/Tablet 회귀 기준선 (ANI-1740).
 * - 기준선 스냅샷은 `npm run mobile-r2:baseline:update` 로 "변경 전(main 기준)" 에서 한 번 생성하고 커밋한다.
 * - 이후 PR 은 이 스냅샷과 비교해 PC 화면이 의도치 않게 바뀌었는지 잡는다.
 * - 인증 필요 PC 셸은 MOBILE_R2_STORAGE_STATE 가 있을 때 별도 spec 으로 추가한다 (아직 없음).
 */

/**
 * 캡처 결정성 (W2 ANI-1671 과 동일 규약).
 *
 * - Next.js dev 오버레이의 컴파일 이슈 배지(`[data-next-badge-root]`)는 편집 중 스스로
 *   나타났다 사라져 기준선과의 diff 를 만든다. 포털을 숨긴다(운영 빌드에는 없다).
 * - 웹폰트 교체(FOUT) 완료 전에 캡처하면 실행마다 글자 폭/줄바꿈이 달라져 높이가 변한다.
 *   실제로 이것 없이 잡은 기준선은 같은 코드에서도 16px 높이 차이를 냈다.
 * - 무한 애니메이션은 플레이토이트 설정의 `toHaveScreenshot.animations: 'disabled'` 가 고정한다.
 */
async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
}

async function settleForCapture(page: Page) {
  await hideDevOverlay(page)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  // 폰트 교체 후 레이아웃이 한 프레임 더 흔들릴 수 있어 paint 를 한 번 기다린다.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))
}

for (const route of pcBaselineRoutes()) {
  test(`PC 회귀 기준선: ${route.id}`, async ({ page }) => {
    const probe = attachRuntimeProbe(page)
    await page.goto(route.path, { waitUntil: 'networkidle' })
    await expectNoHorizontalOverflow(page)
    await expectAxeClean(page)
    expect(probe.pageErrors).toEqual([])
    await settleForCapture(page)
    await expect(page).toHaveScreenshot(`${route.id}.png`, { fullPage: true })
  })
}
