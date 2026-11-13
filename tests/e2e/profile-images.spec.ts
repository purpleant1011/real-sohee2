import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const fixturePath = '/e2e-fixture/profile-images'
const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const

function collectRuntimeProblems(page: import('@playwright/test').Page) {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))
  return problems
}

test.describe('Sohee and user profile images', () => {
  test('keeps the Sohee face and brand mark clearly visible at compact sizes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(fixturePath)

    const messageAvatar = page.getByRole('img', { name: '소희' }).first()
    const brandMark = page.locator('[data-mobile-sohee-logo] img')
    const measurements = await Promise.all([messageAvatar, brandMark].map(async (image) => image.evaluate((node) => {
      const imageBox = node.getBoundingClientRect()
      const frameBox = node.parentElement?.getBoundingClientRect()
      return {
        frameWidth: frameBox?.width ?? 0,
        imageWidth: imageBox.width,
      }
    })))

    expect(measurements[0]?.frameWidth).toBeGreaterThanOrEqual(36)
    expect(measurements[0]?.imageWidth).toBeGreaterThanOrEqual(40)
    expect(measurements[1]?.frameWidth).toBeGreaterThanOrEqual(48)
  })

  for (const viewport of viewports) {
    test(`${viewport.width}px renders brand and profile images without overflow`, async ({ page }) => {
      const runtimeProblems = collectRuntimeProblems(page)
      await page.setViewportSize(viewport)
      const response = await page.goto(fixturePath)

      expect(response?.status()).toBe(200)
      await expect(page.getByRole('main')).toHaveCount(1)
      if (viewport.width < 760) {
        await expect(page.locator('[data-mobile-sohee-logo] img')).toBeVisible()
      } else {
        await expect(page.getByRole('img', { name: '소희 로고' })).toBeVisible()
      }
      await expect(page.getByRole('img', { name: '소희' }).first()).toBeVisible()
      await expect(page.getByRole('img', { name: '내 프로필 사진' }).first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)

      for (const image of await page.getByRole('img').all()) {
        expect(await image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      }
      for (const control of await page.locator('button:visible, label:visible').all()) {
        const box = await control.boundingBox()
        expect(box?.height).toBeGreaterThanOrEqual(44)
      }
      expect(runtimeProblems).toEqual([])
    })
  }

  test('previews a selected user image without sending it', async ({ page }) => {
    await page.goto(fixturePath)
    await page.getByLabel('프로필 사진 선택').setInputFiles({
      name: 'new-profile.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    })

    const preview = page.getByRole('img', { name: '선택한 프로필 사진 미리보기' })
    await expect(preview).toBeVisible()
    await expect(preview).toHaveAttribute('src', /^blob:/u)
    await expect(page.getByRole('button', { name: '사진 저장' })).toBeVisible()
    await expect(page.getByRole('button', { name: '사진 삭제' })).toBeVisible()
  })

  test('uses the fallback when the account has no photo', async ({ page }) => {
    await page.goto(`${fixturePath}?avatar=none`)

    await expect(page.getByLabel('기본 프로필 아이콘').first()).toBeVisible()
    await expect(page.getByRole('button', { name: '사진 삭제' })).toHaveCount(0)
  })

  test('has no automatically detectable accessibility violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(fixturePath)

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
})
