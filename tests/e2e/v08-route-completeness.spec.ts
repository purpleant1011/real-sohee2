import { expect, test } from '@playwright/test'

const protectedP1Routes = [
  '/app/account/knowledge',
  '/app/account/credits',
  '/app/account/billing',
  '/app/account/automation',
  '/app/work',
  '/app/account/place',
  '/app/account/daangn',
  '/app/account/channels/readiness',
  '/app/reports',
] as const

for (const viewport of [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
] as const) {
  test(`${viewport.label} reaches every protected P1 route through a safe auth handoff instead of the fallback page`, async ({ page }) => {
    const externalRequests: string[] = []
    page.on('request', (request) => {
      const hostname = new URL(request.url()).hostname
      if (hostname !== '127.0.0.1' && hostname !== 'localhost') externalRequests.push(request.url())
    })
    await page.setViewportSize(viewport)

    for (const route of protectedP1Routes) {
      const response = await page.goto(route)
      expect(response?.status()).toBeLessThan(400)
      await expect(page).toHaveURL(/\/login\?next=/)
      expect(new URL(page.url()).searchParams.get('next')).toBe(route)
      await expect(page.getByText('이 화면은 아직 준비되지 않았어요')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    }

    expect(externalRequests).toEqual([])
  })
}

test('onboarding preserves its requested route at the same safe auth handoff', async ({ page }) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const hostname = new URL(request.url()).hostname
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') externalRequests.push(request.url())
  })

  const response = await page.goto('/app/onboarding')
  expect(response?.status()).toBe(200)
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fonboarding/)
  await expect(page.getByText('이 화면은 아직 준비되지 않았어요')).toHaveCount(0)
  expect(externalRequests).toEqual([])
})
