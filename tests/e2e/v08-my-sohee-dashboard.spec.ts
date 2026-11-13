import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const fixturePath = '/e2e-fixture/app-shell?screen=my-sohee-v08&path=/app/account'
const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const

for (const viewport of viewports) {
  test(`${viewport.width}px에서 운영 기준과 다음 설정을 확인한다`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(fixturePath)

    await expect(page.getByRole('heading', { name: '나의 소희', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '나의 소희', exact: true })).toHaveAttribute('aria-current', 'page')
    const status = page.getByLabel('나의 소희 운영 상태')
    await expect(status).toContainText('4/6 준비')
    await expect(status).toContainText('다음 설정')
    await expect(status).toContainText('지식 자료')
    await expect(page.getByRole('link', { name: '지식 자료 설정하기' })).toHaveAttribute('href', '/app/account/knowledge')
    await expect(page.getByRole('link', { name: '소희와 운영 점검하기' })).toHaveAttribute('href', '/app?resume=account')

    const settings = page.getByLabel('준비 항목')
    await expect(settings).toContainText('사업 정보')
    await expect(settings).toContainText('브랜드 기준')
    await expect(settings).toContainText('채널 연결')
    await expect(settings).toContainText('자동화')
    await expect(page.getByRole('link', { name: /^크레딧 사용 내역/ })).toHaveAttribute('href', '/app/account/credits')
    await expect(page.getByRole('link', { name: /^외부 실행 준비도/ })).toHaveAttribute('href', '/app/account/channels/readiness')

    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
  })
}

test('나의 소희 운영 제어 화면에 자동 감지할 수 있는 접근성 위반이 없다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(fixturePath)

  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})
