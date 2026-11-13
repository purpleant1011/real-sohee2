import { expect, test } from '@playwright/test'

const publicRoutes = [
  ['/', '여러 마케팅 채널을 돌아다니지 마세요.'],
  ['/product', '고객 반응에서 다음 성장 행동까지.'],
  ['/pricing', '내 매장의 운영 범위에 맞춰 시작하세요.'],
  ['/terms', '이용약관'],
  ['/privacy', '개인정보 처리방침'],
  ['/refund', '환불 안내'],
  ['/payment-info', '결제 안내'],
  ['/business-info', '사업자 정보'],
] as const

test.describe('public navigation', () => {
  for (const [path, heading] of publicRoutes) {
    test(`${path} returns a public heading`, async ({ page }) => {
      const response = await page.goto(path)

      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    })
  }

  test('mobile menu navigates to product, pricing, and login', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto('/')

    await page.getByRole('button', { name: '메뉴 열기' }).click()
    await expect(page.getByRole('dialog', { name: '메뉴' })).toBeVisible()
    await page.getByRole('dialog', { name: '메뉴' }).getByRole('link', { name: '제품', exact: true }).click()
    await expect(page).toHaveURL(/\/product$/)

    await page.getByRole('button', { name: '메뉴 열기' }).click()
    await page.getByRole('dialog', { name: '메뉴' }).getByRole('link', { name: '요금', exact: true }).click()
    await expect(page).toHaveURL(/\/pricing$/)

    await page.getByRole('button', { name: '메뉴 열기' }).click()
    await page.getByRole('dialog', { name: '메뉴' }).getByRole('link', { name: '로그인', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await context.close()
  })

  test('skip link moves focus to the main content', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: '본문으로 바로가기' }).focus()
    await page.keyboard.press('Enter')

    await expect(page.locator('main')).toBeFocused()
  })

  test('visible primary CTA opens the private preliminary diagnosis', async ({ page }) => {
    const browserErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    page.on('pageerror', (error) => browserErrors.push(error.message))

    await page.goto('/')
    const cta = page.locator('a[data-primary-cta]:visible').last()

    await expect(cta).toHaveAttribute('href', '/diagnosis')
    await expect(cta).toHaveText('내 매장으로 무료 진단하기')
    await cta.click()
    await expect(page).toHaveURL(/\/diagnosis$/)
    await expect(page.getByRole('heading', { name: '내 매장의 첫 마케팅 기회를 먼저 확인하세요.' })).toBeVisible()
    expect(browserErrors).toEqual([])
  })

  test('history navigation closes the mobile menu without leaving an expanded state', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto('/')
    await page.getByRole('link', { name: '실제 운영 화면 보기' }).click()
    await expect(page).toHaveURL(/\/product#operations$/)

    const opener = page.getByRole('button', { name: '메뉴 열기' })
    await opener.focus()
    await opener.click()
    await expect(page.getByRole('dialog', { name: '메뉴' })).toBeVisible()
    await page.goBack()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('dialog', { name: '메뉴' })).toBeHidden()
    await expect(opener).toHaveAttribute('aria-expanded', 'false')
    await context.close()
  })

  test('mobile menu locks background scrolling until it closes', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto('/')

    await page.getByRole('button', { name: '메뉴 열기' }).click()
    const beforeScrollAttempt = await page.evaluate(() => window.scrollY)
    await page.mouse.wheel(0, 700)
    await page.keyboard.press('PageDown')
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScrollAttempt)

    await page.getByRole('button', { name: '닫기' }).click()
    await expect(page.getByRole('dialog', { name: '메뉴' })).toBeHidden()
    await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe('')
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
    await page.keyboard.press('PageDown')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforeScrollAttempt)
    await context.close()
  })

  test('home has no horizontal overflow, tap-safe calls to action, and loaded images', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) {
        window.scrollTo(0, y)
        await new Promise((resolve) => setTimeout(resolve, 60))
      }
    })

    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
    for (const link of await page.locator('a[data-cta]:visible').all()) {
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    }
    for (const image of await page.locator('img').all()) {
      await expect(image).toHaveJSProperty('complete', true)
      expect(await image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    }
  })

  test('production manifest serves declared PNG install icons at their natural dimensions', async ({ page }) => {
    const manifestResponse = await page.request.get('/manifest.webmanifest')
    expect(manifestResponse.status()).toBe(200)
    expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json')

    const manifest = (await manifestResponse.json()) as {
      icons?: Array<{ src: string; sizes: string; type: string; purpose?: string }>
    }
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icons/sohee-192.png', sizes: '192x192', type: 'image/png' }),
        expect.objectContaining({ src: '/icons/sohee-512.png', sizes: '512x512', type: 'image/png' }),
      ]),
    )

    await page.goto('/')
    for (const icon of manifest.icons ?? []) {
      const [width, height] = icon.sizes.split('x').map(Number)
      const iconResponse = await page.request.get(icon.src)
      expect(iconResponse.status()).toBe(200)
      expect(iconResponse.headers()['content-type']).toContain('image/png')
      expect(icon.purpose).toMatch(/\b(any|maskable)\b/)
      await expect
        .poll(() =>
          page.evaluate(async (source) => {
            const image = new Image()
            image.src = source
            await image.decode()
            return { width: image.naturalWidth, height: image.naturalHeight }
          }, icon.src),
        )
        .toEqual({ width, height })
    }
  })

  test('public header cycles the visible theme control without duplicating it in the mobile menu', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' })
    await context.addInitScript(() => window.localStorage.removeItem('sohee-theme'))
    const page = await context.newPage()
    await page.goto('/')

    const themeToggle = page.getByRole('button', { name: '현재 테마: 시스템 설정. 다음 테마로 변경' })
    const menuButton = page.getByRole('button', { name: '메뉴 열기' })
    await expect(themeToggle).toBeVisible()
    await expect(menuButton).toBeVisible()
    expect((await themeToggle.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    expect((await menuButton.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    expect((await page.locator('header').first().boundingBox())?.height).toBeLessThanOrEqual(80)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)

    await themeToggle.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('sohee-theme'))).toBe('light')
    await expect(page.getByRole('button', { name: '현재 테마: 밝은 테마. 다음 테마로 변경' })).toBeVisible()

    await page.getByRole('button', { name: '현재 테마: 밝은 테마. 다음 테마로 변경' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('sohee-theme'))).toBe('dark')
    await expect(page.getByRole('button', { name: '현재 테마: 어두운 테마. 다음 테마로 변경' })).toBeVisible()

    await page.getByRole('button', { name: '현재 테마: 어두운 테마. 다음 테마로 변경' }).click()
    await expect(page.locator('html')).not.toHaveAttribute('data-theme')
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('sohee-theme'))).toBe('system')

    await menuButton.click()
    await expect(page.getByRole('dialog', { name: '메뉴' })).toBeVisible()
    await expect(page.getByRole('button', { name: /현재 테마:/ })).toHaveCount(1)
    await context.close()
  })
})
