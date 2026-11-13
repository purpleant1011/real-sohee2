import { expect, test } from '@playwright/test'

const workspaceId = '00000000-0000-4000-8000-000000000000'

test('작업 조회 시간 초과 → 재조회 복구 → 후속 실패 시 이전 작업 보존', async ({ page }) => {
  let mode: 'hang' | 'ready' | 'error' = 'hang'
  const methods: string[] = []
  await page.route(`**/api/workspaces/${workspaceId}/content`, async route => {
    methods.push(route.request().method())
    if (mode === 'hang') return // Leave headers pending until the hook's real deadline aborts.
    if (mode === 'error') return route.fulfill({ status: 503, json: { success: false } })
    return route.fulfill({ json: { success: true, contents: [
      { contentId: 'local-fixture', workspaceId, title: '회귀 확인용 원고', status: 'draft', channel: 'threads' },
    ] } })
  })
  await page.goto('/dev/mobile-r2/work-list-wiring')
  await expect(page.getByRole('status')).toContainText('작업을 불러오고 있어요.')
  await expect(page.getByRole('status')).toContainText('작업을 불러오지 못했어요.', { timeout: 20_000 })
  // Development StrictMode mounts effects twice; neither request may perform a write.
  expect(methods.length).toBeGreaterThan(0)
  expect(methods.every(method => method === 'GET')).toBe(true)
  mode = 'ready'
  await page.getByRole('button', { name: '다시 확인하기' }).click()
  await expect(page.getByRole('link', { name: /회귀 확인용 원고/ })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('확인된 작업 1건')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  mode = 'error'
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('status')).toContainText('마지막으로 확인한 작업이에요.')
  await expect(page.getByRole('link', { name: /회귀 확인용 원고/ })).toBeVisible()
  expect(methods.every(method => method === 'GET')).toBe(true)
})
