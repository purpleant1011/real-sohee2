import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const demoPath = '/demo'

function collectRuntimeProblems(page: import('@playwright/test').Page) {
  const problems: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))

  return problems
}

test.describe('browser-only five-step demo', () => {
  test('a fresh direct demo visit loads the favicon without console or page errors', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const runtimeProblems = collectRuntimeProblems(page)

    const response = await page.goto(demoPath)
    const faviconPage = await context.newPage()
    const faviconResponse = await faviconPage.goto('/favicon.ico')

    expect(response?.status()).toBe(200)
    expect(faviconResponse?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: '5단계 무료 체험' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(runtimeProblems).toEqual([])
    await faviconPage.close()
    await context.close()
  })

  test('opens directly, completes five steps, and resets after refresh without runtime errors', async ({ page }) => {
    const runtimeProblems = collectRuntimeProblems(page)
    const response = await page.goto(demoPath)

    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: '5단계 무료 체험' })).toBeVisible()
    await expect(page.getByText('0 / 5')).toBeVisible()

    for (let step = 1; step <= 5; step += 1) {
      await page.getByRole('button', { name: '다음 단계' }).click()
      await expect(page.getByText(`${step} / 5`, { exact: true })).toBeVisible()
      await expect(page.getByRole('status')).toHaveText(`5단계 중 ${step}단계 완료`)
    }

    await expect(page.getByText('예시 데이터 · 외부 전송 없음')).toBeVisible()
    await expect(page.getByText('저장되지 않음')).toBeVisible()
    await page.reload()
    await expect(page.getByText('0 / 5', { exact: true })).toBeVisible()
    expect(runtimeProblems).toEqual([])
  })

  test('public header and hero CTAs enter the demo', async ({ page }) => {
    await page.goto('/')

    for (const cta of await page.locator('a[data-primary-cta]:visible').all()) {
      await expect(cta).toHaveAttribute('href', demoPath)
      await expect(cta).toHaveText('무료 체험하기')
    }

    await page.locator('a[data-primary-cta]:visible').last().click()
    await expect(page).toHaveURL(/\/demo$/)
  })

  test('uses no Supabase, external, or browser storage traffic', async ({ page }) => {
    const unexpectedRequests: string[] = []
    const localOrigin = new URL(test.info().project.use.baseURL as string).origin

    page.on('request', (request) => {
      const requestUrl = new URL(request.url())

      if (requestUrl.origin !== localOrigin || requestUrl.pathname.includes('storage')) {
        unexpectedRequests.push(request.url())
      }
    })

    await page.goto(demoPath)
    await page.getByRole('button', { name: '다음 단계' }).click()

    expect(unexpectedRequests).toEqual([])
    expect(await page.context().storageState()).toMatchObject({ cookies: [], origins: [] })
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 820, height: 900 },
    { width: 1440, height: 960 },
  ]) {
    test(`${viewport.width}px keeps the progress controls in view without horizontal overflow`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto(demoPath)

      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
      await expect(page.getByText('0 / 5', { exact: true })).toBeInViewport()
      expect((await page.getByRole('button', { name: '다음 단계' }).boundingBox())?.height).toBeGreaterThanOrEqual(44)
    })
  }

  test('has no automatically detectable accessibility violations', async ({ page }) => {
    await page.goto(demoPath)

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
})
