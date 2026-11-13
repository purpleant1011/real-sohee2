import { expect, test } from '@playwright/test'

const protectedRoutes = [
  '/app',
  '/app/work',
  '/app/work/new',
  '/app/schedule',
  '/app/reports',
  '/app/account',
  '/app/settings/business',
  '/app/settings/brand',
  '/app/settings/channels',
  '/app/account/knowledge',
  '/app/account/automation',
  '/app/settings/members',
  '/app/notifications',
] as const

const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const

test.describe('V0.7 rebuild baseline', () => {
  for (const route of protectedRoutes) {
    test(`${route} keeps the protected destination and never renders a blank document`, async ({ page }) => {
      await page.goto(route)

      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(route)}`))
      await expect(page.getByRole('main')).toBeVisible()
      await expect(page.getByRole('heading', { name: /소희와 함께 마케팅 작업을 이어가세요/ })).toBeVisible()
    })
  }

  for (const viewport of viewports) {
    test(`${viewport.width}x${viewport.height} app shell has one main and no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/e2e-fixture/app-shell')

      await expect(page.getByRole('main')).toHaveCount(1)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
      ).toBe(false)
    })
  }

  test('mobile home is conversation first', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/e2e-fixture/app-shell')
    await expect(page.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toBeVisible()
  })

  test('desktop shell exposes the V0.7 three-column workspace', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/e2e-fixture/app-shell')
    await expect(page.locator('[data-v07-column]')).toHaveCount(3)
  })
})
