import { expect, test } from '@playwright/test'
import {
  attachRuntimeProbe,
  blockExternalOrigins,
  expectAxeClean,
  expectNoHorizontalOverflow,
  expectNoInternalLeak,
  expectTouchTargets,
  expectViewportMeta,
  isCancelledRscPrefetch,
  isFrameworkInternalRequest,
  isOriginAllowed,
} from './support/gates'

/**
 * 게이트 자기검증: 게이트가 "나쁜 페이지는 반드시 실패, 좋은 페이지는 통과"하는지 합성 페이지로 증명한다.
 * (거짓 PASS 방지 — 게이트 자체가 신뢰 가능해야 심사에 쓸 수 있다.)
 */
const GOOD = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>좋은 화면</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>body{margin:0;font:16px/1.5 sans-serif;color:#111;background:#fff}main{padding:16px}
button,a.btn{min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;padding:0 16px;color:#111;background:#eee;border:1px solid #333}
</style></head><body><main><h1>오늘, 소희와 함께</h1><button type="button">승인하기</button> <a class="btn" href="/x">자세히</a></main></body></html>`

const BAD = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>body{margin:0}.wide{width:900px;background:#ddd}button{width:20px;height:20px;color:#bbb;background:#fff}</style></head>
<body><div class="wide">넓은 영역</div><button>x</button><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><p>RESULT_UNKNOWN 3b2f1c0e-1111-4222-8333-444455556666 undefined</p></body></html>`

test.describe('게이트 자기검증', () => {
  test('좋은 페이지는 모든 게이트를 통과한다', async ({ page }) => {
    await page.setContent(GOOD)
    await expectNoHorizontalOverflow(page)
    await expectTouchTargets(page)
    await expectNoInternalLeak(page)
    await expectAxeClean(page)
    await expectViewportMeta(page, { requireCover: true })
  })

  test('나쁜 페이지는 각 게이트가 반드시 실패한다', async ({ page }) => {
    await page.setContent(BAD)
    await expect(expectNoHorizontalOverflow(page)).rejects.toThrow()
    await expect(expectTouchTargets(page)).rejects.toThrow()
    await expect(expectNoInternalLeak(page)).rejects.toThrow()
    await expect(expectAxeClean(page)).rejects.toThrow()
    await expect(expectViewportMeta(page)).rejects.toThrow()
  })
})

/**
 * 위 게이트 5종은 DOM 만 본다. 외부 호출 차단(`blockExternalOrigins`)과 런타임 기록(`attachRuntimeProbe`)은
 * "차단했는지"를 스스로 증명하지 못하면 거짓 PASS(차단된 줄 알았는데 실호출)가 가능하다.
 * 여기서는 로컬 서버·실네트워크 없이 합성 입력과 라우트 스텁만으로 그 두 헬퍼를 검증한다.
 */
test.describe('헬퍼 자기검증 (오프라인 합성 입력)', () => {
  test('isOriginAllowed: 같은 오리진·data·blob·기본 허용 호스트만 통과한다', () => {
    const allowedOrigin = 'https://app.test'
    const shouldPass = [
      'https://app.test/',
      'https://app.test/api/health?x=1',
      'data:text/plain,hi',
      'blob:https://app.test/5f0c3a1e',
      'https://fonts.googleapis.com/css2?family=Pretendard',
      'https://fonts.gstatic.com/s/pretendard/v1/x.woff2',
      'https://cdn.jsdelivr.net/npm/x.js',
    ]
    const shouldBlock = [
      'https://api.openai.com/v1/images',
      'https://api.tosspayments.com/v1/payments',
      'https://graph.facebook.com/v21.0/me',
      'https://evil.example/x',
      // 스킴이 다르면 오리진이 다르다 — http 로 내려가도 차단
      'http://app.test/api/health',
      // 접미사 위장: 기본 허용 호스트 이름을 도메인 앞에 붙인 공격 도메인
      'https://fonts.googleapis.com.evil.example/x',
      'https://cdn.jsdelivr.net.evil.example/x',
    ]

    for (const url of shouldPass) expect(isOriginAllowed(url, allowedOrigin), `${url} 는 허용되어야 한다`).toBe(true)
    for (const url of shouldBlock) expect(isOriginAllowed(url, allowedOrigin), `${url} 는 차단되어야 한다`).toBe(false)
    // 허용 목록이 실제로 판정에 쓰이는지: 비우면 웹폰트 호스트조차 통과하지 못한다
    expect(isOriginAllowed('https://fonts.googleapis.com/css2', allowedOrigin, [])).toBe(false)
  })

  test('isCancelledRscPrefetch: 취소된 RSC prefetch 만 걸러낸다', () => {
    const cases: Array<[string, string, string, boolean]> = [
      ['GET', 'https://app.test/list?_rsc=abc', 'net::ERR_ABORTED', true],
      ['GET', 'https://app.test/list?x=1&_rsc=abc', 'net::ERR_ABORTED', true],
      // WebKit(iOS)은 취소를 'cancelled' 로 보고한다 — 엔진 중립이어야 iOS 게이트가 거짓 실패하지 않는다
      ['GET', 'https://app.test/list?_rsc=abc', 'cancelled', true],
      // WebKit Linux 빌드(CI 컨테이너)는 'Load request cancelled' 로 보고한다 (실측: trace.network)
      ['GET', 'https://app.test/list?_rsc=abc', 'Load request cancelled', true],
      ['GET', 'https://app.test/list?x=1&_rsc=abc', 'Load request cancelled', true],
      // 같은 문구라도 RSC prefetch 가 아니면 취소로 보지 않는다
      ['GET', 'https://app.test/api/charge', 'Load request cancelled', false],
      // 취소가 아닌 실패는 정상 동작이 아니므로 남긴다
      ['GET', 'https://app.test/list?_rsc=abc', 'net::ERR_FAILED', false],
      // WebKit 의 route.abort('aborted') 합성 문구 — 실제 취소가 아니므로 제외하면 안 된다
      ['GET', 'https://app.test/list?_rsc=abc', 'Blocked by Web Inspector', false],
      // 쓰기 요청은 prefetch 가 아니다
      ['POST', 'https://app.test/list?_rsc=abc', 'net::ERR_ABORTED', false],
      ['POST', 'https://app.test/list?_rsc=abc', 'Load request cancelled', false],
      // RSC prefetch 가 아닌 요청
      ['GET', 'https://app.test/api/charge', 'net::ERR_ABORTED', false],
    ]
    for (const [method, url, errorText, expected] of cases) {
      expect(isCancelledRscPrefetch(method, url, errorText), `${method} ${url} ${errorText}`).toBe(expected)
    }
  })

  test('isFrameworkInternalRequest: Next.js 내부 엔드포인트만 프레임워크 요청으로 본다', () => {
    const shouldIgnore = [
      'http://localhost:3000/__nextjs_original-stack-frames',
      'http://localhost:3000/__nextjs_source-map?file=x.js',
      'http://localhost:3000/_next/webpack-hmr',
      'http://localhost:3000/_next/static/chunks/main.js',
    ]
    const shouldRecord = [
      // 제품 쓰기 — 프레임워크 예외로 숨기면 거짓 PASS 가 된다
      'http://localhost:3000/api/charge',
      'http://localhost:3000/app/dev/mobile-r2',
      // 접두사 위장: 루트 네임스페이스가 아니면 프레임워크 요청이 아니다
      'http://localhost:3000/app/_next/webpack-hmr',
      'http://localhost:3000/application/__nextjs_source-map',
      // 유사 이름의 제품 라우트
      'http://localhost:3000/_nextjs-normal',
    ]
    for (const url of shouldIgnore) expect(isFrameworkInternalRequest(url), `${url} 는 무시되어야 한다`).toBe(true)
    for (const url of shouldRecord) expect(isFrameworkInternalRequest(url), `${url} 는 기록되어야 한다`).toBe(false)
  })

  test('attachRuntimeProbe: Next.js 프레임워크 내부 쓰기는 기록하지 않고 제품 쓰기만 기록한다', async ({ page }) => {
    const probe = attachRuntimeProbe(page)
    await page.route('https://probe.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok', headers: { 'access-control-allow-origin': '*' } }),
    )
    await page.setContent('<main>프레임워크 요청 프로브</main>')

    await page.evaluate(async () => {
      await Promise.allSettled([
        // 개발 오버레이가 스택 프레임을 서버에 물어보는 요청 (W1 판정표의 no-writes 오탐 원인)
        fetch('https://probe.test/__nextjs_original-stack-frames', { method: 'POST', mode: 'no-cors' }),
        fetch('https://probe.test/_next/webpack-hmr', { method: 'POST', mode: 'no-cors' }),
        fetch('https://probe.test/api/charge', { method: 'POST', mode: 'no-cors' }),
      ])
    })

    await expect.poll(() => probe.writes.length, { message: '제품 쓰기 요청이 기록되어야 한다' }).toBeGreaterThan(0)
    expect(probe.writes).toEqual(['POST https://probe.test/api/charge'])
  })

  test('blockExternalOrigins: 외부 요청은 실제로 차단하고 앱 오리진은 통과시킨다', async ({ page }) => {
    const blocked = await blockExternalOrigins(page, 'https://app.test')
    // 같은 오리진은 스텁 응답으로 끝까지 통과시킨다(나중 등록 핸들러가 우선한다).
    await page.route('https://app.test/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: 'ok',
        headers: { 'access-control-allow-origin': '*' },
      }),
    )
    await page.setContent('<main>차단 프로브</main>')

    const outcomes = await page.evaluate(async () => {
      const hit = async (url: string) => {
        try {
          const res = await fetch(url)
          return `ok:${res.status}`
        } catch {
          return 'fail'
        }
      }
      return {
        external: await hit('https://provider.test/v1/charge'),
        sameOrigin: await hit('https://app.test/api/health'),
      }
    })

    expect(outcomes.sameOrigin, '앱 오리진 요청은 차단되면 안 된다').toBe('ok:200')
    expect(outcomes.external, '외부 오리진 요청은 실패해야 한다').toBe('fail')
    // 차단 기록이 "실제로 차단한 그 요청"과 일치해야 한다
    expect(blocked).toEqual(['GET https://provider.test/v1/charge'])
  })

  test('attachRuntimeProbe: 깨끗한 페이지에서는 아무것도 기록하지 않는다', async ({ page }) => {
    const probe = attachRuntimeProbe(page)
    await page.setContent(GOOD)
    await page.waitForTimeout(200)
    expect(probe).toEqual({ writes: [], pageErrors: [], consoleErrors: [], failedRequests: [] })
  })

  test('attachRuntimeProbe: 콘솔 에러·페이지 에러·실패 요청·쓰기 시도를 모두 기록한다', async ({ page }) => {
    const probe = attachRuntimeProbe(page)
    await page.route('https://probe.test/missing.js', (route) => route.abort('failed'))
    await page.route('https://probe.test/hold', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok', headers: { 'access-control-allow-origin': '*' } }),
    )
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>프로브</title></head>
<body><main>프로브</main>
<script>console.error('probe console error')</script>
<script>setTimeout(() => { throw new Error('probe pageerror') }, 0)</script>
</body></html>`)

    await page.evaluate(async () => {
      await Promise.allSettled([
        fetch('https://probe.test/missing.js'),
        fetch('https://probe.test/hold', { method: 'POST', mode: 'no-cors' }),
      ])
    })

    await expect.poll(() => probe.pageErrors.length, { message: 'pageerror 가 기록되어야 한다' }).toBeGreaterThan(0)
    await expect.poll(() => probe.failedRequests.length, { message: '실패 요청이 기록되어야 한다' }).toBe(1)
    await expect.poll(() => probe.writes.length, { message: '쓰기 요청이 기록되어야 한다' }).toBe(1)

    expect(probe.pageErrors.some((m) => m.includes('probe pageerror'))).toBe(true)
    expect(probe.consoleErrors.some((m) => m.includes('probe console error'))).toBe(true)
    expect(probe.failedRequests[0]).toContain('https://probe.test/missing.js')
    expect(probe.writes[0]).toBe('POST https://probe.test/hold')
  })

  test('attachRuntimeProbe: 취소된 RSC prefetch 는 실패 요청에서 제외한다', async ({ page }) => {
    const probe = attachRuntimeProbe(page)
    // 실제 취소를 AbortController 로 재현한다. route.abort('aborted') 는 엔진마다 다른 문구를 만들어
    // (WebKit: Blocked by Web Inspector) 실제 취소 검증이 되지 않는다.
    await page.route('https://probe.test/list?_rsc=1', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'rsc' }).catch(() => {})
    })
    await page.route('https://probe.test/asset.js', (route) => route.abort('failed'))
    await page.setContent('<main>RSC 프로브</main>')

    const results = await page.evaluate(async () => {
      const controller = new AbortController()
      const cancelled = fetch('https://probe.test/list?_rsc=1', { signal: controller.signal })
        .then(() => 'ok')
        .catch(() => 'fail')
      setTimeout(() => controller.abort(), 100)
      const asset = await fetch('https://probe.test/asset.js').then(() => 'ok').catch(() => 'fail')
      return [await cancelled, asset]
    })
    expect(results).toEqual(['fail', 'fail'])

    await expect.poll(() => probe.failedRequests.length, { message: '실패 요청이 기록되어야 한다' }).toBe(1)
    expect(probe.failedRequests[0]).toContain('https://probe.test/asset.js')
    expect(probe.failedRequests.some((f) => f.includes('_rsc='))).toBe(false)
  })
})
