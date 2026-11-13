import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const fixturePath = '/e2e-fixture/app-shell'
const viewports = [
  { name: 'mobile', width: 390, height: 844, columns: 1 },
  { name: 'tablet', width: 820, height: 1180, columns: 2 },
  { name: 'desktop', width: 1440, height: 900, columns: 3 },
] as const

const navigationLabels = ['대화', '일정', '리포트', '나의 소희'] as const

test.describe('V0.7 responsive conversation shell', () => {
  for (const viewport of viewports) {
    test(`${viewport.name} keeps conversation, navigation, and the approved column count`, async ({ page }) => {
      const browserErrors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text())
      })
      page.on('pageerror', (error) => browserErrors.push(error.message))
      await page.setViewportSize(viewport)
      await page.goto(`${fixturePath}?screen=M-01`)

      await expect(page.locator('[data-v07-contract="D-01 D-02 D-03"]')).toBeVisible()
      await expect(page.getByRole('region', { name: '소희와의 대화' })).toBeVisible()
      await expect(page.getByRole('article', { name: '최근 콘텐츠 반응 보고' })).toHaveAttribute(
        'data-v07-screen',
        'M-01',
      )
      await expect(page.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toBeVisible()
      await expect(page.getByRole('link', { name: '고객 대화 7건' })).toHaveAttribute(
        'href',
        '/app/reports?view=reactions',
      )
      await expect(page.getByRole('link', { name: '리포트 전체 보기' })).toHaveAttribute('href', '/app/reports')
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)

      const visibleColumns = page.locator('[data-v07-column]:visible')
      await expect(visibleColumns).toHaveCount(viewport.columns)

      const visibleNavigation = page.locator('nav[aria-label="앱 메뉴"]:visible')
      for (const label of navigationLabels) {
        await expect(visibleNavigation.getByRole('link', { name: label, exact: true })).toBeVisible()
      }

      if (viewport.name === 'mobile') {
        const composer = page.locator('form').filter({ has: page.getByRole('textbox', { name: '소희에게 메시지 보내기' }) })
        const bottomNavigation = page.locator('[data-mobile-nav]')
        const composerBox = await composer.boundingBox()
        const navigationBox = await bottomNavigation.boundingBox()
        expect(composerBox).not.toBeNull()
        expect(navigationBox).not.toBeNull()
        expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(navigationBox!.y)
      }

      if (viewport.name === 'tablet') {
        await expect(page.getByText('현재 대화 문맥 보기')).toBeVisible()
        const sidebarBox = await page.getByRole('complementary', { name: '주요 탐색' }).boundingBox()
        expect(sidebarBox?.width).toBe(220)
      }

      if (viewport.name === 'desktop') {
        await expect(page.getByRole('complementary', { name: '업무 문맥' })).toBeVisible()
        await expect(page.getByText('고객 반응을 살펴보고 있어요').first()).toBeVisible()
        const sidebarBox = await page.getByRole('complementary', { name: '주요 탐색' }).boundingBox()
        expect(sidebarBox?.width).toBe(248)
      }

      expect(browserErrors).toEqual([])
    })
  }

  test('M-01 composer provides an honest local interaction before a server is connected', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${fixturePath}?screen=M-01`)

    const reportLink = page.getByRole('link', { name: '고객 대화 7건' })
    await reportLink.scrollIntoViewIfNeeded()
    await expect(reportLink).toBeVisible()

    const composer = page.getByRole('textbox', { name: '소희에게 메시지 보내기' })
    await composer.fill('이번 주 반응을 자세히 보여줘')
    await composer.press('Enter')

    await expect(composer).toHaveValue('')
    await expect(page.getByText('입력 내용은 저장하거나 전송하지 않았어요.', { exact: false })).toBeVisible()
  })

  test('skip navigation moves keyboard focus to the conversation workspace', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(fixturePath)
    await page.keyboard.press('Tab')

    await expect(page.getByRole('link', { name: '본문으로 바로가기' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('main')).toBeFocused()
  })

  test('conversation shell has no automatically detectable accessibility violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${fixturePath}?screen=M-01`)

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })

  test('captures the M-01 and D-01 through D-03 contracts at all approved viewports', async ({ page }) => {
    await mkdir('artifacts/v07-phase2', { recursive: true })

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await page.goto(`${fixturePath}?screen=M-01`)
      await expect(page.getByRole('region', { name: '소희와의 대화' })).toBeVisible()
      await page.screenshot({
        fullPage: true,
        path: `artifacts/v07-phase2/${viewport.name}-conversation.png`,
      })
    }
  })
})
