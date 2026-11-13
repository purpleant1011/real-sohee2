import { expect, test } from '@playwright/test'

test.skip(process.env.MOBILE_R2_WIRING_E2E !== '1', '개발 전용 배선 화면에서만 실행')
const workspaceId = '00000000-0000-4000-8000-000000000001'

function payload(path: string) {
  if (path.endsWith('/mobile-customers')) return { loadState: 'ready', customers: [], workspaceId, complete: true, checkedAt: '2026-10-28T00:00:00Z' }
  if (path.endsWith('/profile')) return { profile: { business: { businessName: '복구 검증용 예시 가게' } } }
  if (path.endsWith('/energy')) return { status: 'ACTIVE', budgetAlertStage: 'NORMAL' }
  if (path === '/api/channels') return { instagram: null }
  const period = { start: '2026-10-01T00:00:00Z', end: '2026-10-08T00:00:00Z' }
  const observed = { value: 1, state: 'OBSERVED', source: 'external_action_receipts.independent_publish_readback', period, observedAt: '2026-10-08T00:00:00Z', evidenceIds: ['test-evidence'] }
  return { workspaceId, datasetMode: 'ACTUAL', period, generatedAt: observed.observedAt, metrics: { verifiedPublishedPosts: observed, storedComments: observed, bookingConfirmed: observed, paymentCapturedVerified: observed, revenue: observed } }
}

for (const tab of ['customers', 'results', 'more']) {
  test(`${tab}: 무응답은 오류로 종료하고 같은 화면의 재시도로 복구한다`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin
    let healthy = false
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
        await route.abort('blockedbyclient')
      } else if (url.pathname.startsWith('/api/')) {
        if (!healthy) await held
        await route.fulfill({ status: 200, json: payload(url.pathname) }).catch(() => undefined)
      } else {
        await route.continue()
      }
    })
    try {
      const response = await page.goto(`/dev/mobile-r2/tab-read-wiring?tab=${tab}`)
      expect(response?.status()).toBe(200)
      await expect(page.locator('[aria-busy="true"]')).toBeVisible()
      await expect(page.getByRole('heading', { name: '불러오지 못했어요', exact: true })).toBeVisible({ timeout: 20_000 })
      healthy = true
      await page.getByRole('button', { name: '다시 확인하기', exact: true }).click()
      if (tab === 'customers') await expect(page.getByRole('heading', { name: '등록된 고객이 없어요' })).toBeVisible()
      else await expect(page.getByRole('list', { name: tab === 'results' ? '핵심 지표' : '설정 목록' })).toBeVisible()
      release()
      await expect(page.getByRole('heading', { name: '불러오지 못했어요', exact: true })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    } finally {
      release()
    }
  })
}
