import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

for (const width of [320, 360, 390, 430]) {
  for (const theme of ['light', 'dark']) {
    test(`${width}px ${theme}: readable decisions and minimum touch targets`, async ({ page }) => {
      const problems: string[] = []
      const writes: string[] = []
      page.on('pageerror', error => problems.push(error.message))
      page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url()) })
      await page.setViewportSize({ width, height: 844 })
      await page.addInitScript(value => localStorage.setItem('sohee-theme', value), theme)
      await page.goto(`/e2e-fixture/mobile-decision?state=ready&theme=${theme}`)
      await expect(page.getByRole('heading', { name: '오늘, 소희와 함께' })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(page.getByRole('region', { name: '필요한 결정' }).getByRole('link').nth(1)).toBeInViewport()
      for (const element of await page.locator('a:visible, button:visible').all()) {
        const box = await element.boundingBox()
        expect(box?.width).toBeGreaterThanOrEqual(44)
        expect(box?.height).toBeGreaterThanOrEqual(44)
      }
      const a11y = await new AxeBuilder({ page }).analyze()
      expect(a11y.violations).toEqual([])
      expect(problems).toEqual([])
      expect(writes).toEqual([])
      if (width === 390) await page.screenshot({ path: `evidence/mobile-decision-r1/home-${theme}-390.png`, fullPage: true })
    })
  }
}

test('review navigation has one bottom surface and never dispatches', async ({ page }) => {
  const writes: string[] = []
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url()) })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e-fixture/mobile-decision?state=ready')
  await page.getByRole('region', { name: '필요한 결정' }).getByRole('link').nth(1).click()
  await expect(page.getByRole('heading', { name: '방문 문의 답장 검토' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '소희 업무 메뉴' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '실행 준비 확인 필요' })).toBeDisabled()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.screenshot({ path: 'evidence/mobile-decision-r1/review-390.png', fullPage: true })
  await page.getByRole('button', { name: '목록으로 돌아가기' }).click()
  await expect(page.getByRole('heading', { name: '오늘, 소희와 함께' })).toBeVisible()
  expect(writes).toEqual([])
})

test('delegation dialog restores focus and more menu theme remains selected', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e-fixture/mobile-decision?state=ready')
  const delegate = page.getByRole('button', { name: '소희에게 맡기기' })
  await delegate.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '소희 업무 메뉴' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '실제 요청은 실행되지 않아요' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(delegate).toBeFocused()
  await page.getByRole('link', { name: '더보기', exact: true }).click()
  await expect(page.getByRole('heading', { name: '더보기', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '테마 전환' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))
  })
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

for (const state of ['loading', 'error', 'partial', 'stale']) {
  test(`${state} is not reported as an empty completed workload`, async ({ page }) => {
    await page.goto(`/e2e-fixture/mobile-decision?state=${state}`)
    await expect(page.getByText('지금 확인하실 일은 없어요')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '오늘, 소희와 함께' })).toBeVisible()
  })
}

test('wide viewport and enlarged text do not overflow', async ({ page }) => {
  for (const width of [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1024 })
    await page.goto('/e2e-fixture/mobile-decision?state=ready')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addStyleTag({ content: 'html { font-size: 200%; }' })
  const overflow = await page.evaluate(() => [...document.querySelectorAll('a,button,header,nav')].filter(element => element.getBoundingClientRect().right > innerWidth + 1).map(element => ({ text: element.textContent?.slice(0, 70), width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right })))
  expect(overflow).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
