import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const

for (const viewport of viewports) {
  test(`${viewport.width}px에서 기간 계획을 한 카드에서 확인하고 대화로 결정한다`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e-fixture/app-shell?screen=plan')

    await expect(page.getByRole('heading', { name: '신규 상담을 위한 14일 계획' })).toBeVisible()
    await expect(page.getByText('게시물 12개 · 이미지 18장')).toBeVisible()
    await expect(page.getByText('68 크레딧')).toBeVisible()
    await expect(page.getByText('실행 후 56')).toBeVisible()
    await expect(page.getByRole('button', { name: '범위 줄이기' })).toBeEnabled()
    await expect(page.getByRole('button', { name: '이 계획으로 시작' })).toBeEnabled()
    await expect(page.getByRole('button', { name: '지금 게시' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
  })
}

test('기간 계획 카드에 자동 감지할 수 있는 접근성 위반이 없다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e-fixture/app-shell?screen=plan')

  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})
