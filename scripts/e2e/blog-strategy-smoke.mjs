import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

// 실제 대화 컴포넌트 + API fixture. DB/유료 생성/외부 게시 검증이 아니다.
const origin = process.env.BLOG_STRATEGY_SMOKE_ORIGIN ?? 'http://127.0.0.1:3194'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
const reference = { missionId: '40000000-0000-4000-8000-000000000001', runId: '50000000-0000-4000-8000-000000000001',
  briefId: '10000000-0000-4000-8000-000000000001', revision: 1 }
const seed = () => ({ id: reference.briefId, revision: 1, status: 'proposed', selectedIndex: null,
  goal: { description: '서비스에 대한 유효한 문의 늘리기' }, audience: '처음 이용을 검토하는 분', constraints: '',
  topics: ['첫 이용 안내', '상담 준비 안내', '서비스 선택 안내'].map(title => ({ title, evidence: ['사장님이 확인한 서비스 안내를 제공합니다.'], questionSource: 'inferred' })),
  unknowns: ['검색 수요·AI 가시성·문의 성과는 아직 측정하지 않았어요.', '실제 고객 질문을 관측한 결과가 아니에요.'] })
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [1280, 320, 360, 375, 390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 900 },
      ...(width < 768 ? { isMobile: true, hasTouch: true } : {}) })
    let saved = seed()
    let stale = false
    let generations = 0
    const calls = []
    const errors = []
    const external = []
    await context.route('**/*', async route => {
      const req = route.request()
      const url = new URL(req.url())
      if (url.origin !== new URL(origin).origin) { external.push(req.url()); return route.abort() }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      calls.push({ path: url.pathname, method: req.method() })
      if (url.pathname.endsWith('/blog-strategy')) {
        if (req.method() === 'GET') return route.fulfill({ json: { data: saved, generationCredits: 30 } })
        const body = req.postDataJSON()
        if (stale && body.action !== 'refresh') return route.fulfill({ status: 409, json: { error: { code: 'MARKETING_STRATEGY_STALE' } } })
        if (body.action === 'refresh') { saved = { ...seed(), revision: saved.revision + 1 }; stale = false }
        if (body.action === 'respond') {
          assert.equal(body.text, '2번으로 써, 할인 내용 제외')
          assert.equal(body.expectedRevision, saved.revision)
          saved = { ...saved, revision: saved.revision + 1, selectedIndex: 1, constraints: '할인 내용 제외' }
        }
        if (body.action === 'select') saved = { ...saved, revision: saved.revision + 1,
          selectedIndex: body.selectedIndex, audience: body.audience, constraints: body.constraints }
        if (body.action === 'approve') {
          assert.equal(body.confirmed, true)
          assert.equal(body.expectedRevision, saved.revision)
          saved = { ...saved, revision: saved.revision + 1, status: 'approved', reference }
        }
        return route.fulfill({ json: { data: saved, generationCredits: 30 } })
      }
      if (url.pathname.endsWith('/messages')) {
        assert.deepEqual(req.postDataJSON().marketingStrategy, reference)
        generations++
        const messageId = '60000000-0000-4000-8000-000000000001'
        return route.fulfill({ contentType: 'application/x-ndjson', body: [
          { type: 'message.started', messageId },
          { type: 'message.delta', messageId, delta: '원고 준비 요청 연결 확인 · 테스트 응답' },
          { type: 'message.completed', messageId },
        ].map(event => JSON.stringify(event)).join('\n') + '\n' })
      }
      return route.abort()
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${origin}/dev/blog-strategy`)
    await page.getByRole('radio', { name: '상담 준비 안내' }).waitFor()
    assert.ok(calls.length > 0)
    assert.ok(calls.every(call => call.method === 'GET'))
    const composer = page.getByRole('textbox', { name: '소희에게 메시지 보내기' })
    await composer.fill('2번으로 써, 할인 내용 제외')
    await page.getByRole('button', { name: '메시지 보내기', exact: true }).click()
    await page.getByRole('radio', { name: '상담 준비 안내' }).waitFor()
    await page.waitForFunction(() => document.querySelector('input[type=radio]:checked') !== null)
    assert.equal(await page.getByLabel('반영할 조건').inputValue(), '할인 내용 제외')
    await page.getByRole('region', { name: '현재 상황' }).waitFor()
    await page.getByRole('region', { name: '제안 기회' }).filter({ hasText: '상담 준비 안내' }).waitFor()
    await page.getByText(/현재 원고·이미지 준비 요청은 30크레딧/).waitFor()
    assert.equal(await page.getByRole('button', { name: '이 전략 승인', exact: true }).isDisabled(), true)
    assert.equal(generations, 0)
    await page.getByLabel('반영할 조건').fill('')
    await page.getByRole('button', { name: '선택·조건 저장', exact: true }).click()
    await page.getByLabel('가게 사실과 목표를 확인했으며 이 전략을 승인해요.').check()
    await page.getByRole('button', { name: '이 전략 승인', exact: true }).click()
    await page.getByRole('button', { name: '승인한 전략으로 원고 준비', exact: true }).waitFor()
    assert.equal(saved.constraints, '')
    assert.equal(generations, 0)
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > window.innerWidth), false)
    if ([1280, 390].includes(width)) await page.screenshot({ path: `/tmp/blog-strategy-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: '승인한 전략으로 원고 준비', exact: true }).click()
    await page.getByText('원고 준비 요청 연결 확인 · 테스트 응답', { exact: true }).waitFor()
    assert.equal(generations, 1)
    const beforeReload = calls.length
    await page.reload()
    await page.getByRole('button', { name: '승인한 전략으로 원고 준비', exact: true }).waitFor()
    assert.ok(calls.length > beforeReload)
    assert.ok(calls.slice(beforeReload).every(call => call.method === 'GET'))
    assert.equal(await page.getByRole('radio', { name: '상담 준비 안내' }).isChecked(), true)
    assert.equal(generations, 1)
    if ([1280, 390].includes(width)) await page.screenshot({ path: `/tmp/blog-strategy-restored-${width}.png`, fullPage: true })
    stale = true
    await page.getByRole('button', { name: '저장한 선택 다시 열기', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '최신 정보' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '승인한 전략으로 원고 준비', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: '최신 정보로 다시 제안', exact: true }).click()
    await page.getByRole('button', { name: '이 전략 승인', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '이 전략 승인', exact: true }).isDisabled(), true)
    assert.equal(generations, 1)
    assert.equal(calls.every(call => call.path.endsWith('/blog-strategy') || call.path.endsWith('/messages')), true)
    assert.deepEqual(external, [])
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px: 대화 선택 → 조건 초기화 → 명시 승인 → 생성 참조 → 복원 → stale 차단/재제안 (API fixture)`)
    await context.close()
  }
} finally { await browser.close() }
