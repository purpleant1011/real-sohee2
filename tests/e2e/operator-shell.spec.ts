import { expect, test } from '@playwright/test'

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 900 },
  { name: 'compact-tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
] as const

test.describe('LOCAL_UI_FIXTURE_ONLY — operator shell viewport safety', () => {
  for (const viewport of viewports) {
    test(`${viewport.name} renders the real operator shell without fake data`, async ({ page }) => {
      const pageErrors: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/e2e-fixture/operator-shell')

      await expect(page.getByRole('heading', { name: '운영 현황' })).toBeVisible()
      const visibleBrand = viewport.width >= 1025
        ? page.getByRole('complementary').getByText('소희 관리자', { exact: true })
        : page.locator('header').getByText('소희 관리자', { exact: true })
      const visibleBadge = viewport.width >= 1025
        ? page.getByRole('complementary').getByText('운영사 전용', { exact: true })
        : page.locator('header').getByText('운영사 전용', { exact: true })
      await expect(visibleBrand).toBeVisible()
      await expect(visibleBadge).toBeVisible()
      await expect(page.getByText(/즉시 확인이 필요한/u).first()).toBeVisible()
      await expect(page.getByRole('heading', { name: '게시 성공률과 API 비용' })).toBeVisible()
      await expect(page.getByRole('heading', { name: '우선 처리 업무' })).toBeVisible()
      if (viewport.width >= 1025) {
        const sidebar = page.getByRole('complementary').first()
        const sidebarBox = await sidebar.boundingBox()
        const titleBox = await page.getByRole('heading', { name: '운영 현황' }).boundingBox()
        expect(sidebarBox?.width).toBe(256)
        expect(titleBox?.y).toBeLessThan(100)
      }
      const visibleNavigation = page.locator('nav[aria-label="운영사 메뉴"]:visible')
      if (viewport.width < 1025) {
        await page.getByRole('button', { name: '운영사 메뉴 열기' }).click()
        await expect(page.getByRole('dialog', { name: '운영사 메뉴' })).toBeVisible()
      }
      await expect(visibleNavigation.getByRole('link')).toHaveCount(9)
      await expect(visibleNavigation.getByRole('link', { name: '운영 현황' })).toHaveAttribute('aria-current', 'page')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(pageErrors).toEqual([])
      await expect(page.locator('body')).not.toContainText(/token|secret|password|provider body|고객사 [A-Z0-9]/i)

      if (viewport.width >= 1025) {
        await page.getByRole('button', { name: '오른쪽 패널 테스트 열기' }).click()
        const main = await page.locator('#operator-main').boundingBox()
        const panel = await page.getByTestId('operator-right-panel').boundingBox()
        expect(main).not.toBeNull()
        expect(panel).not.toBeNull()
        expect(panel!.x).toBeGreaterThanOrEqual(main!.x + main!.width)
        await expect(page.getByRole('dialog', { name: '운영사 패널' })).toHaveCount(0)
      } else {
        await expect(page.getByTestId('operator-right-panel')).toHaveCount(0)
        const menuDialog = page.getByRole('dialog', { name: '운영사 메뉴' })
        await expect(menuDialog.getByRole('link')).toHaveCount(9)
        await expect(menuDialog.getByRole('link', { name: '운영 현황' })).toHaveAttribute('aria-current', 'page')
        await menuDialog.getByRole('button', { name: '닫기' }).click()
        await expect(menuDialog).toHaveCount(0)
        await page.getByRole('button', { name: '오른쪽 패널 테스트 열기' }).click()
        await expect(page.getByRole('dialog', { name: '운영사 패널' })).toBeVisible()
      }
    })
  }
})
