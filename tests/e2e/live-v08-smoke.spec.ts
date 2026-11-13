import { expect, test } from '@playwright/test'

const storageState = process.env.SOHEE_LIVE_STORAGE_STATE
const liveOrigin = new URL(process.env.SOHEE_LIVE_BASE_URL ?? 'https://example.com').origin

function captureUnexpectedRequests(page: import('@playwright/test').Page) {
  const unexpected: string[] = []
  page.on('request', (request) => {
    if (['GET', 'HEAD'].includes(request.method())) return
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.origin === liveOrigin && url.pathname === '/cdn-cgi/rum') return
    unexpected.push(`${request.method()} ${request.url()}`)
  })
  return unexpected
}

test('checks public V0.8 entry points without mutation or 5xx responses', async ({ page }) => {
  const unexpected = captureUnexpectedRequests(page)
  const home = await page.goto('/')
  expect(home?.status()).toBeLessThan(500)
  const login = await page.goto('/login')
  expect(login?.status()).toBeLessThan(500)
  const app = await page.goto('/app')
  expect(app?.status()).toBeLessThan(500)
  await expect(page).toHaveURL(/\/login\?next=%2Fapp|\/app\/onboarding|\/app$/)
  expect(unexpected).toEqual([])
})

test('reads V0.8 protected surfaces only when a provided storage state enables it', async ({ browser }) => {
  test.skip(!storageState, 'SOHEE_LIVE_STORAGE_STATE가 제공된 읽기 전용 환경에서만 실행합니다.')
  const context = await browser.newContext({ storageState })
  const page = await context.newPage()
  const unexpected = captureUnexpectedRequests(page)
  for (const path of ['/app', '/app/account/knowledge', '/app/account/credits']) {
    const response = await page.goto(path)
    expect(response?.status()).toBeLessThan(500)
    await expect(page).not.toHaveURL(/\/login/)
  }
  expect(unexpected).toEqual([])
  await context.close()
})
