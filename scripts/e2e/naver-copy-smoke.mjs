import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// 실제 대화 원고 컴포넌트 + 저장 버전 조회 fixture. 외부 게시/발송은 차단한다.
const origin = process.env.NAVER_COPY_SMOKE_ORIGIN ?? 'http://127.0.0.1:3194'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
const photo = readFileSync(new URL('../../public/icons/sohee-192.png', import.meta.url))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const contentId = '55555555-5555-4555-8555-555555555555'
const versionId = '66666666-6666-4666-8666-666666666666'
const mediaId = '77777777-7777-4777-8777-777777777777'
const title = '청라 자연눈썹 시술 전 꼭 확인할 3가지'
const introduction = '첫인상을 좌우하는 눈썹 디자인, 내 얼굴 골격에 맞는 결을 찾는 것이 가장 중요합니다.'
const cta = '궁금한 점은 프로필 링크로 편하게 문의하세요.'
const preview = {
  workspaceId, contentId, versionId, versionNumber: 1, fingerprint: 'a'.repeat(64), channel: 'naver_blog', visibility: 'public',
  account: { connectionId: null, label: '테스트 블로그', status: 'disconnected' },
  approval: { status: 'unreviewed', fingerprint: null }, caption: '', hashtags: [],
  text: title, disclosure: '테스트 고지', issues: [],
  media: [{ id: mediaId, position: 1, mimeType: 'image/png', src: `/api/workspaces/${workspaceId}/media/${mediaId}`, altText: '검증 사진' }],
  naverCopy: { title, introduction, sections: [], keywords: ['청라자연눈썹'], cta },
}
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [1280, 390]) {
    for (const mode of ['default', 'text', 'denied', 'image_failed', 'stale']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
      const writes = [], external = [], errors = []
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.origin !== new URL(origin).origin) { external.push(request.url()); return route.abort() }
        if (url.pathname.startsWith('/api/')) {
          if (request.method() !== 'GET') { writes.push(request.url()); return route.abort() }
          if (url.pathname.includes('/media/')) {
            if (mode === 'image_failed') return route.fulfill({ status: 404, json: { error: 'MEDIA_NOT_FOUND' } })
            // 실제 API와 같은 307→이미지 계약. 직접 200만 반환하면 회귀를 놓친다.
            return route.fulfill({ status: 307, headers: { location: `${origin}/icons/sohee-192.png` } })
          }
          if (url.pathname.includes('/naver-posts/')) return route.fulfill({ json: { data: {
            role: 'manager', preview: mode === 'stale' ? { ...preview, versionId: '99999999-9999-4999-8999-999999999999' } : preview, receipt: null,
          } } })
          return route.fulfill({ json: {} })
        }
        return route.continue()
      })
      if (mode === 'text') await context.addInitScript(() => Object.defineProperty(navigator.clipboard, 'write', { value: undefined }))
      if (mode === 'denied') await context.addInitScript(() => {
        for (const key of ['write', 'writeText']) Object.defineProperty(navigator.clipboard, key, { value: async () => { throw new DOMException('Permission denied', 'NotAllowedError') } })
      })
      const page = await context.newPage()
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`${origin}/dev/naver-copy`)
      const rich = page.getByRole('button', { name: '본문·사진 복사', exact: true })
      await rich.waitFor()
      await rich.click()
      if (mode === 'denied' || mode === 'image_failed') {
        const copyBar = page.getByRole('region', { name: '네이버에 붙여넣기' })
        await copyBar.getByRole('alert').waitFor()
        await copyBar.getByRole('textbox', { name: '직접 선택할 원고' }).waitFor()
        assert.equal(await copyBar.getByRole('status').filter({ hasText: '사진 2장을 클립보드에 담았어요' }).count(), 0)
      } else {
        await page.getByRole('status').filter({ hasText: mode === 'text' ? '텍스트로 복사했어요' : '사진 2장을 클립보드에 담았어요' }).waitFor()
        const copied = await page.evaluate(() => navigator.clipboard.readText())
        assert.ok(copied.includes(introduction) && copied.includes(cta))
        assert.ok(!copied.includes(title), '본문 칸에는 제목을 중복 삽입하지 않는다')
        if (mode !== 'text') {
          const html = await page.evaluate(async () => {
            const [item] = await navigator.clipboard.read()
            return (await item.getType('text/html')).text()
          })
          assert.equal((html.match(/data:image\/png;base64,/g) ?? []).length, 2)
          assert.ok(!html.includes('/api/workspaces/') && !html.includes('token='))
        }
      }
      await page.getByText('부분 복사·사진 받기', { exact: true }).click()
      if (mode === 'default') {
        await page.getByRole('button', { name: '제목 복사', exact: true }).click()
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), title)
        await page.getByRole('button', { name: '태그 복사', exact: true }).click()
        assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes('#청라자연눈썹'))
        const pendingDownload = page.waitForEvent('download')
        await page.getByRole('button', { name: '사진·원고 ZIP 받기', exact: true }).click()
        const download = await pendingDownload
        assert.equal(await download.failure(), null)
        execFileSync('python3', ['-I', '-c', `
import sys, zipfile, base64
with zipfile.ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None
    assert archive.read('title.txt').decode() == sys.argv[2]
    assert archive.read('images/01.png') == base64.b64decode(sys.argv[3])
`, await download.path(), title, photo.toString('base64')])
      } else if (mode === 'stale') {
        await page.getByRole('button', { name: '사진·원고 ZIP 받기', exact: true }).click()
        await page.getByRole('alert').filter({ hasText: '최신 원고를 다시 열어' }).waitFor()
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      assert.deepEqual(writes, [])
      assert.deepEqual(external, [])
      assert.deepEqual(errors, [])
      console.log(`PASS ${width}px ${mode}: conversation manuscript, 307 media, clipboard, safe failure, no external writes`)
      await context.close()
    }
  }
} finally { await browser.close() }
