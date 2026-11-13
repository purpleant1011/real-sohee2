import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const origin = process.env.TASK_TIMELINE_ORIGIN ?? 'http://localhost:3415'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [320, 360, 375, 390, 430, 1280, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const errors = []
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort())
    await page.goto(`${origin}/dev/task-timeline`)
    const card = page.getByRole('region', { name: '소희의 작업 진행 계획' })
    await card.getByText('1 / 4 완료').waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.ok(await card.getByRole('button').evaluate(element => element.getBoundingClientRect().height >= 44))
    await page.getByRole('button', { name: '완료', exact: true }).click()
    await card.getByText('4 / 4 완료').waitFor()
    assert.equal(await card.getByRole('button').getAttribute('aria-expanded'), 'false')
    await card.getByRole('button').focus()
    await page.keyboard.press('Enter')
    assert.equal(await card.getByRole('button').getAttribute('aria-expanded'), 'true')
    for (const state of ['실패', '연결 끊김', '중단']) {
      await page.getByRole('button', { name: state, exact: true }).click()
      await card.getByRole('status').filter({ hasText: '결과 확인 필요' }).waitFor()
      assert.equal(await card.locator('.animate-spin').count(), 0)
    }
    await page.getByRole('button', { name: '진행 중', exact: true }).click()
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(node => node.html) })))
    assert.deepEqual(violations, [])
    assert.deepEqual(errors, [])
    if ([390, 1280].includes(width)) await page.screenshot({ path: `/tmp/sohee-task-timeline-${width}.png`, fullPage: true })
    console.log(`PASS ${width}px: 5 states, keyboard toggle, 44px, no overflow, axe 0, pageerror 0 (fixture UI only)`)
    await context.close()
  }
} finally { await browser.close() }
