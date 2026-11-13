import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const

test.describe('customer login page', () => {
  for (const viewport of viewports) {
    test(`${viewport.width}px에서 로그인 폼이 넘치지 않고 편하게 눌린다`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/login?next=%2Fapp')

      const form = page.getByRole('form', { name: '고객사 로그인' })
      await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible()
      await expect(form).toBeVisible()
      await expect(form.getByLabel('이메일')).toBeVisible()
      await expect(form.getByLabel('비밀번호')).toBeVisible()
      await expect(form.getByRole('button', { name: '이메일로 로그인' })).toBeVisible()

      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)

      const loginControls = page.locator(
        'section[aria-labelledby="login-intro-title"] input:visible, section[aria-labelledby="login-intro-title"] a:visible, section[aria-labelledby="login-intro-title"] button:visible',
      )
      expect(await loginControls.count()).toBeGreaterThan(0)
      for (const control of await loginControls.all()) {
        const box = await control.boundingBox()
        expect(box?.height).toBeGreaterThanOrEqual(44)
      }
    })
  }

  test('데스크톱에서 안내와 로그인 카드를 나란히 보여 준다', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/login')

    const intro = page.getByRole('heading', { name: '대화에서 계획하고, 승인하고, 성장해요' })
    const form = page.getByRole('form', { name: '고객사 로그인' })
    const introBox = await intro.boundingBox()
    const formBox = await form.boundingBox()

    expect(introBox).not.toBeNull()
    expect(formBox).not.toBeNull()
    expect(formBox!.x).toBeGreaterThan(introBox!.x + introBox!.width)
  })

  test('자동 감지할 수 있는 접근성 위반이 없다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/login')

    const results = await new AxeBuilder({ page }).analyze()

    expect(results.violations).toEqual([])
  })
})
