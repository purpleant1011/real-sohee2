import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const

for (const viewport of viewports) {
  test(`${viewport.width}px에서 승인된 버전의 실행 방식을 안전하게 선택한다`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e-fixture/app-shell?screen=execution')

    const card = page.getByRole('region', { name: '승인 후 실행 선택' })
    await expect(card).toContainText('@studio_byreum')
    await expect(card).toContainText('v3')
    await expect(card).toContainText('이미지 1장')

    await page.getByRole('button', { name: '지금 게시' }).click()
    await expect(page.getByRole('button', { name: '승인한 v3 지금 게시' })).toBeDisabled()
    await page.getByRole('checkbox', { name: '승인한 v3을 @studio_byreum 계정에 지금 게시합니다' }).check()
    await expect(page.getByRole('button', { name: '승인한 v3 지금 게시' })).toBeEnabled()

    await page.getByRole('button', { name: '예약 게시' }).click()
    await expect(page.getByRole('button', { name: '승인한 v3 예약 게시' })).toBeDisabled()
    await page.getByLabel('예약 시각 · Asia/Seoul').fill('2030-08-21T10:30')
    await expect(page.getByRole('button', { name: '승인한 v3 예약 게시' })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
  })
}

test('실패 복구 카드가 보존 버전과 크레딧 반환을 먼저 보여준다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e-fixture/app-shell?screen=recovery')

  await expect(page.getByText('Instagram v3 승인 버전은 보관됐어요.')).toBeVisible()
  await expect(page.getByText('외부 실행 0 사용 · 4 반환')).toBeVisible()
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeEnabled()
  await expect(page.getByText('중복 실행 금지')).toHaveCount(0)
})

test('실행 선택과 복구 화면에 자동 감지할 수 있는 접근성 위반이 없다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const screen of ['execution', 'recovery']) {
    await page.goto(`/e2e-fixture/app-shell?screen=${screen}`)
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  }
})
