import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const fixturePath = '/e2e-fixture/app-shell?view=report&screen=report-v08'
const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const

for (const viewport of viewports) {
  test(`${viewport.width}px에서 실제 성과와 다음 판단을 한 흐름으로 확인한다`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(fixturePath)

    await expect(page.getByRole('heading', { name: '리포트', exact: true })).toBeVisible()
    const summary = page.getByLabel('리포트 운영 판단 요약')
    await expect(summary).toContainText(/게시 결과\s*1건/)
    await expect(summary).toContainText(/고객 반응\s*2건/)
    await expect(summary).toContainText(/예약 전환\s*1건/)
    await expect(summary).toContainText(/확인 필요\s*1건/)
    await expect(summary).toContainText('다음 확인 2026.08.12 14:00')

    const card = page.getByLabel('여름 관리 안내 포스트 분석')
    await expect(card).toContainText('인스타그램 · 게시 버전 v3')
    await expect(card).toContainText('예약 가치')
    await expect(card.getByRole('link', { name: '관련 대화에서 개선하기' })).toHaveAttribute(
      'href',
      '/app?work=80000000-0000-4000-8000-000000000001',
    )

    await page.getByRole('tab', { name: '고객 반응' }).click()
    await expect(page.getByText('예약 가능한가요?')).toBeVisible()
    await expect(page.getByText('DM으로 가격을 문의했어요.')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
  })
}

test('리포트 판단 화면에 자동 감지할 수 있는 접근성 위반이 없다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(fixturePath)

  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})
