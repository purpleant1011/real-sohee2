import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const

for (const viewport of viewports) {
  test(`${viewport.width}px에서 일정 상태를 판단하고 정확한 실행 상세를 확인한다`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e-fixture/app-shell?screen=schedule-v08&path=/app/schedule')

    await expect(page.getByRole('heading', { name: '일정', exact: true })).toBeVisible()
    const summary = page.getByLabel('게시 상태 요약')
    await expect(summary).toContainText(/예정\s*1/)
    await expect(summary).toContainText(/진행 중\s*1/)
    await expect(summary).toContainText(/완료\s*1/)
    await expect(summary).toContainText(/복구\s*1/)

    const completed = page.locator('details').filter({ hasText: '게시를 마친 회복 안내' })
    await expect(completed).not.toHaveAttribute('open', '')

    await page.getByRole('button', { name: '잔흔 상담 전후 기록 상세 보기' }).click()
    const dialog = page.getByRole('dialog', { name: '잔흔 상담 전후 기록' })
    await expect(dialog).toContainText('Instagram · @studio_byreum')
    await expect(dialog).toContainText('정확한 게시 버전')
    await expect(dialog).toContainText('v3')
    await expect(dialog).toContainText('예약 시각')
    await expect(dialog.getByRole('link', { name: '관련 대화로 돌아가기' })).toHaveAttribute(
      'href',
      '/app?work=80000000-0000-4000-8000-000000000001',
    )
    await page.getByRole('button', { name: '상세 정보 닫기' }).click()

    await page.getByRole('button', { name: '복구 1' }).click()
    await expect(page.getByText('확인이 필요한 예약 안내')).toBeVisible()
    await expect(page.getByText('잔흔 상담 전후 기록')).toHaveCount(0)

    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
  })
}

test('일정 보드와 모바일 상세 패널에 자동 감지할 수 있는 접근성 위반이 없다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e-fixture/app-shell?screen=schedule-v08&path=/app/schedule')

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  await page.getByRole('button', { name: '잔흔 상담 전후 기록 상세 보기' }).click()
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([])
})
