import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const

for (const viewport of viewports) {
  test(`${viewport.width}px에서 정확한 게시 버전과 근거를 검토한다`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e-fixture/app-shell?screen=review')

    await expect(page.getByRole('heading', { name: 'Instagram 게시 전 최종 확인' })).toBeVisible()
    const summary = page.getByRole('region', { name: '정확한 버전 승인 요약' })
    await expect(summary).toContainText('@studio_byreum')
    await expect(summary).toContainText('v3')
    await expect(summary).toContainText('이미지 3장')
    await expect(page.getByRole('button', { name: '이 v3 버전 승인' })).toBeDisabled()
    await page.getByRole('button', { name: '다음 이미지, 2 / 3' }).click()
    await page.getByRole('button', { name: '다음 이미지, 3 / 3' }).click()
    await expect(page.getByRole('button', { name: '이 v3 버전 승인' })).toBeEnabled()
    await expect(page.getByRole('button', { name: '지금 게시' })).toHaveCount(0)

    await page.getByRole('button', { name: '근거 보기' }).click()
    const dialog = page.getByRole('dialog', { name: '이 버전의 근거' })
    await expect(dialog).toContainText('승인된 브랜드 말투')
    await expect(dialog).toContainText('실제 게시 반응은 아직 수집 전이에요.')
    await expect(dialog).toContainText('행사 종료일을 확인해 주세요.')
    await page.getByRole('button', { name: '상세 정보 닫기' }).click()
    await expect(dialog).toHaveCount(0)

    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
  })
}

test('채널 결과 검토 카드에 자동 감지할 수 있는 접근성 위반이 없다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e-fixture/app-shell?screen=review')

  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})
