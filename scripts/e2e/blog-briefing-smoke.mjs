import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

// 제품 브리핑 컴포넌트의 로컬 상태 예시. 운영 승인/생성/DB 검증이 아니다.
const origin = process.env.BLOG_STRATEGY_SMOKE_ORIGIN ?? 'http://127.0.0.1:3194'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [1280, 320, 360, 375, 390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const forbidden = []
    const errors = []
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin !== new URL(origin).origin || url.pathname.startsWith('/api/')) {
        forbidden.push(url.pathname)
        return route.abort()
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${origin}/dev/blog-strategy/review`)
    await page.getByRole('heading', { name: '블로그 성장 브리핑 · 화면 검토' }).waitFor()
    const next = page.getByRole('region', { name: '다음 행동' })
    for (const [state, expected] of [
      ['unselected', '주제와 안내할 대상을 정해 주세요.'],
      ['selected', '전략만 승인해 주세요.'],
      ['dirty', '바꾼 선택·조건을 먼저 저장해 주세요.'],
      ['approved', '비용을 확인한 뒤'],
      ['blocked', '최신 정보로 다시 확인해 주세요.'],
    ]) {
      await page.getByLabel('시나리오', { exact: true }).selectOption(state)
      await next.filter({ hasText: expected }).waitFor()
      assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > innerWidth), false)
    }
    await page.getByRole('status').filter({ hasText: '최신 내용으로 확인되지 않았어요' }).waitFor()
    const summary = page.locator('summary')
    await summary.focus()
    await summary.press('Enter')
    await page.getByText('테스트 가게 정보: 서비스 내용은 상담 후 안내합니다.', { exact: true }).waitFor()
    assert.ok((await summary.boundingBox()).height >= 44)
    await page.getByRole('button', { name: '예시 처음으로' }).click()
    await next.filter({ hasText: '전략만 승인해 주세요.' }).waitFor()
    assert.deepEqual(forbidden, [])
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px: 5상태 · 최신성 경고 · 키보드 근거 펼침 · 가로 넘침 없음 · API/외부 요청 없음`)
    await context.close()
  }
} finally { await browser.close() }
