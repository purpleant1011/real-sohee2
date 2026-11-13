import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const fixturePath = '/e2e-fixture/app-shell?view=report&screen=report-v08'
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const

test.describe('report decision briefing', () => {
  for (const viewport of viewports) {
    test(`${viewport.name} renders the briefing without horizontal overflow`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto(fixturePath)

      await expect(page.getByRole('heading', { name: '이번 주, 무엇이 달라졌나요?' })).toBeVisible()
      await expect(page.getByText('이번 주 가장 중요한 일')).toBeVisible()
      const appNavigation = page.getByRole('navigation', { name: '앱 메뉴' })
      await expect(appNavigation.getByRole('link')).toHaveCount(4)
      await expect(appNavigation.getByRole('link', { name: '작업함', exact: true })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
    })
  }

  test('opens raw evidence only after the user asks for it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(fixturePath)

    await expect(page.getByRole('tablist', { name: '원자료 보기' })).not.toBeVisible()
    await page.getByText('원자료와 게시 결과 살펴보기').click()
    await expect(page.getByRole('tablist', { name: '원자료 보기' })).toBeVisible()
    await page.getByRole('tab', { name: '고객 반응' }).click()
    await expect(page.getByRole('tabpanel')).toBeVisible()
  })

  test('renders each decision surface and preserves missing-data language', async ({ page }) => {
    const surfaces = [
      ['content', '콘텐츠 실험실'],
      ['signals', '고객 여정 레이더'],
      ['decisions', '무엇을 보고, 무엇을 바꿨는지 남겨요'],
      ['data-health', '어떤 자료를 믿고 볼 수 있는지 알려드려요'],
    ] as const
    for (const [surface, heading] of surfaces) {
      await page.goto(`${fixturePath}&surface=${surface}`)
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
    }
    await page.goto(`${fixturePath}&surface=signals`)
    await expect(page.getByText('연결 자료 없음').first()).toBeVisible()
  })

  test('shows action boundaries without creating external execution', async ({ page }) => {
    const mutationRequests: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET') mutationRequests.push(`${request.method()} ${request.url()}`)
    })
    await page.goto(`${fixturePath}&action=plan`)
    await expect(page.getByRole('heading', { name: '다음 포스팅 방향 정하기' })).toBeVisible()
    await expect(page.getByText('저장만으로 게시하거나 메시지를 보내지 않아요.')).toBeVisible()
    expect(mutationRequests).toEqual([])
  })

  test('supports keyboard focus and has no detectable mobile accessibility violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(fixturePath)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: '본문으로 바로가기' })).toBeFocused()

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
})
