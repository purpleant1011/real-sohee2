import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const fixturePath = '/e2e-fixture/app-shell'
const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const

const expectedNavigation = [
  { label: '대화', href: '/app' },
  { label: '일정', href: '/app/schedule' },
  { label: '리포트', href: '/app/reports' },
  { label: '나의 소희', href: '/app/account' },
] as const

function collectRuntimeProblems(page: import('@playwright/test').Page) {
  const problems: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))

  return problems
}

test.describe('responsive app shell fixture', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const viewport of viewports) {
      test(`${viewport.width}px ${colorScheme} uses one main without horizontal overflow`, async ({ page }) => {
        const runtimeProblems = collectRuntimeProblems(page)
        await page.emulateMedia({ colorScheme })
        await page.setViewportSize(viewport)
        const response = await page.goto(fixturePath)

        expect(response?.status()).toBe(200)
        await expect(page.getByRole('main')).toHaveCount(1)
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)

        const visibleNavigation = page.locator('nav[aria-label="앱 메뉴"]:visible')
        const mobileNavigation = page.locator('[data-mobile-nav]')
        const desktopNavigation = page.locator('[data-v07-column="navigation"]')
        await expect(visibleNavigation).toHaveCount(1)
        await expect(visibleNavigation.getByRole('link', { name: '대화', exact: true })).toHaveAttribute('aria-current', 'page')

        for (const item of expectedNavigation) {
          await expect(visibleNavigation.getByRole('link', { name: item.label, exact: true })).toHaveAttribute('href', item.href)
        }

        if (viewport.width >= 760) {
          await expect(desktopNavigation).toBeVisible()
          await expect(mobileNavigation).not.toBeVisible()
          await expect(visibleNavigation.getByRole('link', { name: '대화', exact: true })).toBeVisible()
        } else {
          await expect(desktopNavigation).not.toBeVisible()
          const bottomNavigation = mobileNavigation
          await expect(bottomNavigation).toBeVisible()
          await expect(bottomNavigation).toHaveCSS('position', 'fixed')
          await expect(bottomNavigation.getByRole('link')).toHaveCount(4)

          for (const item of expectedNavigation) {
            await expect(bottomNavigation.getByRole('link', { name: item.label, exact: true })).toBeVisible()
          }
        }

        await expect(page.getByRole('button', { name: '검색 준비 중' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: '대화 준비 중' })).toHaveCount(0)
        const notifications = page.getByRole('link', { name: '알림 열기' })
        await expect(notifications).toBeVisible()
        await expect(notifications).toHaveAttribute('href', '/app/notifications')

        for (const control of await page.locator('a:visible, button:visible').all()) {
          const box = await control.boundingBox()
          expect(box?.height).toBeGreaterThanOrEqual(44)
        }

        expect(runtimeProblems).toEqual([])
      })
    }
  }

  test('distinguishes loading, empty, error, and ready data states without raw errors', async ({ page }) => {
    await page.goto(`${fixturePath}?state=loading`)
    await expect(page.getByText('데이터 확인 중')).toBeVisible()
    await expect(page.getByText('0', { exact: true })).toHaveCount(0)

    await page.goto(fixturePath)
    await expect(page.getByRole('heading', { name: '무엇부터 함께 해볼까요?' })).toBeVisible()

    await page.goto(`${fixturePath}?state=error`)
    await expect(page.getByText('데이터를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.')).toBeVisible()
    await expect(page.getByText('provider internal error')).toHaveCount(0)

    await page.goto(`${fixturePath}?state=ready`)
    await expect(page.getByText('오늘 확인할 작업')).toBeVisible()
    await expect(page.getByText(/확인 시각:/)).toBeVisible()
  })

  test('keeps compatibility routes outside the four primary navigation items', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${fixturePath}?path=work-content`)

    const bottomNavigation = page.getByRole('navigation', { name: '앱 메뉴' })
    await expect(bottomNavigation.getByRole('link', { name: '작업함', exact: true })).toHaveCount(0)
    await expect(bottomNavigation.getByRole('link', { name: '대화', exact: true })).not.toHaveAttribute('aria-current')
  })

  test('has no automatically detectable accessibility violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(fixturePath)

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
})
