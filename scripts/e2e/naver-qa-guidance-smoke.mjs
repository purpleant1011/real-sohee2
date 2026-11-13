import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

// 실제 대화 UI의 실패 안내 전달만 확인한다. 생성·DB·외부 게시 성공 증거가 아니다.
const origin = process.env.NAVER_QA_SMOKE_ORIGIN ?? 'http://127.0.0.1:3194'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
const reference = {
  missionId: '40000000-0000-4000-8000-000000000001', runId: '50000000-0000-4000-8000-000000000001',
  briefId: '10000000-0000-4000-8000-000000000001', revision: 1,
}
const failures = [
  { code: 'CHAT_FACT_REVIEW_REQUIRED', message: '확인되지 않은 정보가 있어 원고 생성을 멈췄어요. 나의 지식에서 가격·경력·후기 등의 출처와 유효기간을 확인하고 승인한 뒤 다시 작성해 주세요.' },
  { code: 'CHAT_FACTS_CHANGED', message: '작성 중 승인된 정보가 바뀌어 원고를 저장하지 않았어요. 나의 지식에서 최신 정보를 확인한 뒤 다시 작성해 주세요.' },
  { code: 'CHAT_FACTS_UNAVAILABLE', message: '승인된 정보를 불러오지 못해 원고 생성을 멈췄어요. 잠시 후 다시 시도해 주세요.' },
]
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [1280, 390]) {
    for (const failure of failures) {
      const context = await browser.newContext({ viewport: { width, height: 900 },
        ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) })
      const external = []
      const unexpected = []
      const errors = []
      let requests = 0
      await context.route('**/*', async route => {
        const req = route.request()
        const url = new URL(req.url())
        if (url.origin !== new URL(origin).origin) { external.push(req.url()); return route.abort() }
        if (!url.pathname.startsWith('/api/')) return route.continue()
        if (url.pathname.endsWith('/blog-strategy')) {
          assert.equal(req.postDataJSON().action, 'open')
          return route.fulfill({ json: { data: {
            id: reference.briefId, revision: 1, status: 'approved', selectedIndex: 0, reference,
            goal: { description: '서비스 관련 문의 늘리기' }, audience: '처음 이용하는 분', constraints: '',
            topics: ['서비스 안내', '상담 준비', '선택 안내'].map(title => ({ title, evidence: ['사장님이 확인한 안내'], questionSource: 'inferred' })),
            unknowns: ['성과는 아직 측정하지 않았어요.'],
          }, generationCredits: 30 } })
        }
        if (url.pathname.endsWith('/messages')) {
          assert.deepEqual(req.postDataJSON().marketingStrategy, reference)
          requests++
          const messageId = '60000000-0000-4000-8000-000000000001'
          return route.fulfill({ contentType: 'application/x-ndjson', body: [
            { type: 'message.started', messageId },
            { type: 'message.failed', messageId, ...failure },
          ].map(event => JSON.stringify(event)).join('\n') + '\n' })
        }
        unexpected.push(url.pathname)
        return route.abort()
      })
      const page = await context.newPage()
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`${origin}/dev/blog-strategy`)
      await page.getByRole('button', { name: '블로그 주제 정하기', exact: true }).click()
      await page.getByRole('button', { name: '승인한 전략으로 원고 준비', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: failure.message }).waitFor()
      assert.ok(await page.getByText(failure.message, { exact: true }).count() >= 1)
      assert.equal(await page.getByText(failure.code, { exact: true }).count(), 0)
      assert.equal(await page.getByText('소희가 확인된 자료를 살펴보고 있어요.', { exact: true }).count(), 0)
      assert.equal(await page.getByText('응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.', { exact: true }).count(), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      assert.equal(requests, 1)
      assert.deepEqual(errors, [])
      assert.deepEqual(unexpected, [])
      assert.deepEqual(external, [])
      if (failure.code === 'CHAT_FACT_REVIEW_REQUIRED') {
        await page.screenshot({ path: `/tmp/naver-qa-guidance-${width}.png`, fullPage: true })
      }
      console.log(`PASS ${width}px ${failure.code}: 안전한 안내 노출, 내부 코드 숨김, 외부 요청 없음 (API fixture)`)
      await context.close()
    }
  }
} finally { await browser.close() }
