import { expect, test } from '@playwright/test'
import type { MobileHomeDto } from '../../../src/features/mobile-decision/contracts'

// 개발 전용 배선 화면에서 실제 TodayHome/R2Today/useMobileHome을 검증한다.
// 인증·SSR·운영 데이터·실물 PWA 검증이 아니며, 운영 404 경계를 풀지 않는다.
test.skip(process.env.MOBILE_R2_WIRING_E2E !== '1', '개발 서버에서 MOBILE_R2_WIRING_E2E=1로만 실행')

const workspaceId = '00000000-0000-4000-8000-000000000001'
const unknown = { state: 'unknown' as const, data: null, observedAt: null, validUntil: null }
const fixture: MobileHomeDto = {
  workspaceId,
  businessName: '복구 검증용 예시 가게',
  timeZone: 'Asia/Seoul',
  generatedAt: '2026-10-28T00:00:00Z',
  agent: unknown,
  decisions: { state: 'ready', data: { items: [], total: 0, complete: true }, observedAt: '2026-10-28T00:00:00Z', validUntil: null },
  activity: unknown,
  results: unknown,
}

const endpoint = `**/api/workspaces/${workspaceId}/mobile-home`

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  // API는 모두 테스트 응답으로 종결한다. 개발 화면이 운영 DB를 읽거나 쓰지 못하게 한다.
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
      await route.abort('blockedbyclient')
    } else if (url.pathname.startsWith('/api/')) {
      await route.fulfill({ status: 503, json: { error: '테스트에서 연결하지 않는 조회' } })
    } else {
      await route.continue()
    }
  })
})

test('홈 조회 실패는 빈 성공이 아니며 재시도로 실제 본문을 표시한다', async ({ page }) => {
  let healthy = false
  await page.route(endpoint, route => route.fulfill(healthy
    ? { status: 200, json: fixture }
    : { status: 503, json: { error: '검증용 조회 실패' } }))

  const response = await page.goto('/dev/mobile-r2/today-wiring?r2=1')
  expect(response?.status(), '개발 전용 배선 화면이어야 한다').toBe(200)
  await expect(page.getByText('오늘의 업무를 불러오지 못했어요.', { exact: true })).toBeVisible()
  await expect(page.getByText('지금 확인하실 일은 없어요', { exact: true })).toHaveCount(0)

  healthy = true
  await page.getByRole('button', { name: '다시 확인하기', exact: true }).click()
  await expect(page.getByRole('heading', { name: '오늘, 소희와 함께', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '지금 확인하실 일은 없어요', exact: true })).toBeVisible()
  await expect(page.getByText('오늘의 업무를 불러오지 못했어요.', { exact: true })).toHaveCount(0)
})

test('응답이 끝나지 않아도 로딩을 종료하고 늦은 성공 대신 명시적 재시도를 따른다', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let healthy = false
  let heldRequests = 0
  let settledRequests = 0
  await page.route(endpoint, async route => {
    if (!healthy) {
      // 개발 모드의 effect 재실행/재마운트가 만드는 요청도 모두 지연한다.
      heldRequests += 1
      await held
      // deadline이 fetch를 abort한 엔진에서는 이미 요청이 닫혀 있을 수 있다.
      await route.fulfill({ status: 200, json: fixture }).catch(() => undefined)
      settledRequests += 1
    } else {
      await route.fulfill({ status: 200, json: fixture })
    }
  })

  try {
    const response = await page.goto('/dev/mobile-r2/today-wiring?r2=1')
    expect(response?.status()).toBe(200)
    await expect(page.getByText('매장과 업무 상태를 확인하고 있어요.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '다시 확인하기', exact: true })).toBeVisible({ timeout: 20_000 })
    expect(heldRequests).toBeGreaterThan(0)
    release()
    await expect.poll(() => settledRequests).toBe(heldRequests)
    await expect(page.getByText('오늘의 업무를 불러오지 못했어요.', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '오늘, 소희와 함께', exact: true })).toHaveCount(0)
    healthy = true
    await page.getByRole('button', { name: '다시 확인하기', exact: true }).click()
    await expect(page.getByRole('heading', { name: '오늘, 소희와 함께', exact: true })).toBeVisible()
  } finally {
    release()
  }
})
