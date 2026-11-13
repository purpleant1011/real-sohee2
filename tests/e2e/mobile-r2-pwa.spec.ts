import { expect, test, type Page } from '@playwright/test'

/**
 * ANI-1727 — PWA 오프라인 보안 자동 검증 (서비스 워커 · Cache Storage 실측).
 *
 * 소스 검사(src/features/pwa/__tests__/service-worker-*.test.ts)는 "코드가 무엇을 한다고 쓰여 있는가"를
 * 고정한다. 이 스펙은 배포 빌드에서 실제로 설치된 워커를 상대로 "브라우저에 무엇이 남았는가"를 검사한다.
 * 둘이 어긋나면 이 스펙이 먼저 깨진다.
 *
 * 실행 표면: playwright.config.ts 의 chromium(데스크톱 회귀) · android-chrome(Pixel 7) · ios-safari(iPhone 14).
 * 서비스 워커는 `NODE_ENV !== 'production'` 이면 등록되지 않으므로(sw-client.ts),
 * 개발 서버에 대고 돌리면 통과가 아니라 "미검증"으로 skip 사유를 남긴다.
 *
 * 하지 않는 것: 실제 계정 로그인, 실제 발송·예약·결제, 외부 오리진 호출.
 * 개인 데이터 표면은 **합성 경로**로 두드려 응답이 캐시에 남는지만 본다.
 */

/** 서비스 워커가 저장해도 되는 정적·비개인화 접두사 (public/sw.js CACHEABLE_*). */
const STATIC_ALLOWLIST = ['/_next/static/', '/fonts/', '/icons/', '/splash/', '/offline.html'] as const

/** 사적 데이터가 흐르는 접두사 (public/sw.js PRIVATE_PATH_PREFIXES — 일부러 복사해 독립 검증한다). */
const PRIVATE_PREFIXES = ['/api/', '/app/', '/admin/', '/auth/', '/operator/', '/dev/', '/_next/data/'] as const

/** 서명·토큰·RSC 흔적이 붙은 쿼리 (public/sw.js SENSITIVE_QUERY). */
const SENSITIVE_QUERY =
  /(?:^|[?&])(?:token|access_token|refresh_token|code|sig|signature|x-amz-[a-z-]+|expires|apikey|key|jwt|session|_rsc)=/i

const SW_NOT_RUNNING = '서비스 워커 미등록 — 배포 빌드(NODE_ENV=production)에서만 등록됩니다. 개발 서버에서는 미검증'

type CacheEntry = { cache: string; url: string }

const pathOf = (raw: string): string => new URL(raw).pathname

const isPrivatePath = (raw: string): boolean => PRIVATE_PREFIXES.some((prefix) => pathOf(raw).includes(prefix))

/** 앱을 열고, 서비스 워커가 실제로 이 페이지를 제어할 때까지 기다린다. */
async function openControlled(page: Page): Promise<boolean> {
  await page.goto('/')

  // 등록은 hydration 뒤에 비동기로 일어난다. 즉시 확인하면 엔진이 느릴 때
  // "등록 안 됨 = 미지원"으로 오판해 통과 대신 skip 이 나 버린다(미검증이 초록으로 새는 구멍).
  const supported = await page.evaluate(() => 'serviceWorker' in navigator)
  if (!supported) return false

  const registered = await page
    .waitForFunction(async () => Boolean(await navigator.serviceWorker.getRegistration()), undefined, {
      timeout: 20_000,
    })
    .then(() => true)
    .catch(() => false)
  if (!registered) return false

  // activate 의 clients.claim() 이 이미 열린 페이지를 즉시 제어한다. 등록 직후 경합만 흡수한다.
  await page
    .waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 15_000 })
    .catch(() => undefined)

  return page.evaluate(() => Boolean(navigator.serviceWorker.controller))
}

/** 모든 Cache Storage 항목을 전수 조사한다. 이름만 보지 않고 URL 까지 본다. */
async function readCache(page: Page): Promise<CacheEntry[]> {
  return page.evaluate(async () => {
    const entries: Array<{ cache: string; url: string }> = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) entries.push({ cache: name, url: request.url })
    }
    return entries
  })
}

test.describe('서비스 워커 수명주기', () => {
  test('루트 범위로 등록되고 스스로 새 버전을 적용하지 않는다', async ({ page }) => {
    test.skip(!(await openControlled(page)), SW_NOT_RUNNING)

    const lifecycle = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready
      return {
        scope: registration.scope,
        scriptURL: registration.active?.scriptURL ?? '',
        state: registration.active?.state ?? '',
        waiting: Boolean(registration.waiting),
        installing: Boolean(registration.installing),
      }
    })

    // scope 가 '/' 보다 좁으면 /app 전체가 오프라인 안내를 받지 못하고,
    // /sw.js 가 아닌 다른 파일을 등록하면 _headers 의 Service-Worker-Allowed 계약도 무의미해진다.
    expect(new URL(lifecycle.scope).pathname).toBe('/')
    expect(lifecycle.scriptURL).toMatch(/\/sw\.js$/)
    expect(lifecycle.state).toBe('activated')

    // 자동 skipWaiting 금지: 설치 직후 대기 중인 워커가 있으면 사용자 동의 없이 교체된 것이다.
    // (교체는 작업 도중 화면을 새로고침해 승인 흐름을 끊는다.)
    expect(lifecycle.waiting, '설치 직후 대기 중인 워커 — 자동 skipWaiting 의심').toBe(false)
    expect(lifecycle.installing).toBe(false)

    // 화면의 업데이트 안내가 의존하는 GET_VERSION 계약.
    const version = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const worker = navigator.serviceWorker.controller
          if (!worker) {
            reject(new Error('controller 없음'))
            return
          }
          const timer = setTimeout(() => reject(new Error('SW_VERSION 응답 없음')), 3_000)
          navigator.serviceWorker.addEventListener('message', function onMessage(event: MessageEvent) {
            if (event.data?.type !== 'SW_VERSION') return
            clearTimeout(timer)
            navigator.serviceWorker.removeEventListener('message', onMessage)
            resolve(String(event.data.version))
          })
          worker.postMessage({ type: 'GET_VERSION' })
        }),
    )
    expect(version).toMatch(/^sohee-sw-v\d+$/)
  })

  test('로그아웃·매장 전환 신호를 받으면 sohee 캐시를 전부 비운다', async ({ page }) => {
    test.skip(!(await openControlled(page)), SW_NOT_RUNNING)

    // 설치 시 셸(오프라인 안내·아이콘)이 실제로 캐시돼 있어야 정리할 대상이 생긴다.
    await expect
      .poll(async () => (await readCache(page)).length, { timeout: 15_000, message: '설치 셸이 캐시되지 않음' })
      .toBeGreaterThan(0)

    await page.evaluate(() => navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_CACHES' }))

    await expect.poll(async () => (await readCache(page)).length, { timeout: 15_000 }).toBe(0)
    const leftover = (await page.evaluate(() => caches.keys())).filter((key) => key.startsWith('sohee-'))
    expect(leftover, 'CLEAR_CACHES 이후 남은 소희 캐시').toEqual([])
  })
})

test.describe('오프라인 동작', () => {
  test('앱 화면 대신 읽기 전용 안내를 보여 주고 실행 버튼을 남기지 않는다', async ({ page, context }) => {
    // Playwright 의 WebKit 은 setOffline 이 서비스 워커 내부 fetch 까지 막지 못한다(엔진 한계).
    // 그래서 "오프라인인데 실제 화면이 뜨는" 현상은 앱 결함이 아니고, 이 엔진에서는 판정 자체가 성립하지 않는다.
    // 이 시나리오는 Chromium 계열 두 표면에서 검증하고, 같은 describe 의 오프라인 쓰기 테스트는 WebKit 에서도 유효하다.
    test.skip(
      test.info().project.name === 'ios-safari',
      'WebKit 오프라인 에뮬레이션이 서비스 워커 요청에 적용되지 않음 — 엔진 한계로 미검증',
    )
    test.skip(!(await openControlled(page)), SW_NOT_RUNNING)

    await context.setOffline(true)
    try {
      // 네비게이션은 워커가 /offline.html 로 대체한다. 응답이 실패해도 화면은 안내여야 한다.
      await page.goto('/app').catch(() => undefined)

      await expect(page.getByRole('heading', { name: '네트워크에 연결할 수 없어요' })).toBeVisible()
      await expect(page.getByText('지금은 읽기만 안내해 드려요')).toBeVisible()

      // 오프라인 화면에는 승인·발행·예약·결제를 실행하는 버튼이 없다(허위 예약·게시 0).
      await expect(page.getByRole('button', { name: /승인|발행|예약|결제|보내기/ })).toHaveCount(0)
      // 재연결 확인은 캐시되지 않는 매니페스트 프로브를 쓴다 — 오프라인에서도 "성공"으로 보이면 안 된다.
      await page.getByRole('button', { name: '다시 연결' }).click()
      await expect(page.locator('#status')).toContainText(/아직 연결되지 않았어요/)
    } finally {
      await context.setOffline(false)
    }
  })

  test('오프라인 쓰기를 큐에 쌓지 않고, 복구 후에도 재전송하지 않는다', async ({ page, context }) => {
    test.skip(!(await openControlled(page)), SW_NOT_RUNNING)

    // 오프라인 상태의 첫 시도 자체도 request 이벤트로 잡힌다(브라우저가 발행한 뒤 실패).
    // 재전송 판정은 "온라인으로 돌아온 뒤 같은 요청이 다시 나갔는가"이므로 플래그로 시점을 가른다.
    const replayed: string[] = []
    let backOnline = false
    page.on('request', (request) => {
      if (!backOnline) return
      // 실수로 실제 엔드포인트를 건드리지 않도록 존재하지 않는 프로브 경로만 쓴다.
      if (request.method() === 'POST' && request.url().includes('/__pwa_offline_probe')) replayed.push(request.url())
    })

    await context.setOffline(true)
    let outcome: 'sent' | 'blocked'
    try {
      outcome = await page.evaluate(async () => {
        try {
          await fetch('/api/__pwa_offline_probe/commands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"kind":"approve_send"}',
          })
          return 'sent'
        } catch {
          return 'blocked'
        }
      })
    } finally {
      await context.setOffline(false)
      backOnline = true
    }

    // 오프라인에서 요청이 "성공"했다면 워커가 가짜 응답을 만든 것이다(거짓 성공 금지).
    expect(outcome, '오프라인 쓰기가 성공으로 처리됨').toBe('blocked')

    // 큐(sync/indexedDB)가 있었다면 복구 직후 재전송된다.
    await page.waitForTimeout(1_500)
    expect(replayed, '오프라인 쓰기가 복구 후 재전송됨').toEqual([])

    const storage = await page.evaluate(async () => {
      const queueLike = (key: string) => /pending|queue|outbox|retry|failed-write/i.test(key)
      const databases =
        typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((db) => db.name ?? '') : []
      return {
        databases: databases.filter((name) => /pwa|queue|outbox|sync/i.test(name)),
        localStorage: Object.keys(localStorage).filter(queueLike),
        sessionStorage: Object.keys(sessionStorage).filter(queueLike),
      }
    })
    expect(storage.databases, '오프라인 큐 데이터베이스').toEqual([])
    expect(storage.localStorage, '오프라인 큐 localStorage').toEqual([])
    expect(storage.sessionStorage, '오프라인 큐 sessionStorage').toEqual([])

    const probeCached = (await readCache(page)).filter(({ url }) => url.includes('/__pwa_offline_probe'))
    expect(probeCached, '오프라인 쓰기 요청이 캐시에 남음').toEqual([])
  })
})

test.describe('Cache Storage 개인정보 차단', () => {
  test('개인 데이터 표면과 서명 URL 은 캐시에 남지 않는다', async ({ page }) => {
    test.skip(!(await openControlled(page)), SW_NOT_RUNNING)

    // 계정 로그인 없이 워커의 캐시 정책만 시험한다. 응답은 401/404/로그인 리다이렉트 중 무엇이든 좋다 —
    // 판정 기준은 "응답 내용"이 아니라 "캐시에 아무것도 남지 않았는가"다.
    const probes = [
      '/api/workspaces/probe/inbox', // 고객·대화
      '/api/workspaces/probe/booking-recovery/cases', // 예약
      '/app', // 인증 화면
      '/app/approvals', // 승인 결과
      '/auth/callback', // 인증 콜백
      '/_next/data/probe/app.json', // RSC 데이터
      // 허용 접두사(/icons/) 아래에 끼어든 사적 경로 — 금지 목록이 먼저 이겨야 한다.
      '/icons/app/customers/1/avatar.png',
      // 허용 접두사 + 서명 쿼리 — 쿼리 검사가 먼저 이겨야 한다.
      '/icons/sohee-192.png?token=synthetic-probe',
      '/icons/sohee-192.png?_rsc=probe',
    ] as const

    await page.evaluate(async (paths) => {
      await Promise.all(paths.map((path) => fetch(path).catch(() => undefined)))
    }, probes)

    // 캐시 쓰기는 비동기다. 전수 검사 전에 잠시 기다린다.
    await page.waitForTimeout(800)
    const entries = await readCache(page)

    const leaked = entries.filter(({ url }) => isPrivatePath(url) || SENSITIVE_QUERY.test(new URL(url).search))
    expect(leaked.map((entry) => `${entry.cache} ← ${entry.url}`), '개인 데이터·서명 URL 이 Cache Storage 에 남음').toEqual([])

    // 허용 목록 밖의 항목이 하나라도 있으면 실패(fail-closed). 새 접두사가 조용히 캐시되지 않게 한다.
    const unexpected = entries.filter(({ url }) => {
      const path = pathOf(url)
      return !STATIC_ALLOWLIST.some((prefix) => path === prefix || path.startsWith(prefix))
    })
    expect(unexpected.map((entry) => `${entry.cache} ← ${entry.url}`), '허용 목록 밖 캐시 항목').toEqual([])

    // 응답 헤더 검사: 캐시된 응답 중 앱/로그인 HTML 이나 쿠키가 실린 응답이 있으면 안 된다.
    // (URL 만 보고 통과하는 거짓 PASS 를 막는다. 번들 JS 안의 'access_token' 문자열은 공개 코드라 검사 대상이 아니다.)
    const stored = await page.evaluate(async () => {
      const out: Array<{ url: string; contentType: string; hasSetCookie: boolean }> = []
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        for (const request of await cache.keys()) {
          const response = await cache.match(request)
          out.push({
            url: request.url,
            contentType: response?.headers.get('content-type') ?? '',
            hasSetCookie: response ? response.headers.has('set-cookie') : false,
          })
        }
      }
      return out
    })
    const htmlOffenders = stored.filter(
      ({ url, contentType }) => contentType.includes('text/html') && pathOf(url) !== '/offline.html',
    )
    expect(htmlOffenders.map((entry) => entry.url), '앱·로그인 HTML 이 캐시됨').toEqual([])
    expect(stored.filter((entry) => entry.hasSetCookie).map((entry) => entry.url), '쿠키가 실린 응답이 캐시됨').toEqual([])
  })

  // Linear DoD 는 "인증받은 계정"을 전제한다. 이 저장소는 실계정 로그인 대신
  // MOBILE_R2_STORAGE_STATE 관례(tests/e2e/mobile-r2/support/routes.ts)를 쓰므로 같은 방식을 따른다.
  // 세션이 주입되지 않으면 통과가 아니라 사유가 남은 skip 이다 — 미검증을 초록으로 만들지 않는다.
  const authedStorageState = process.env.MOBILE_R2_STORAGE_STATE

  test('로그인 세션으로 실제 앱 화면을 열어도 화면·API 응답이 캐시에 남지 않는다', async ({ browser }) => {
    test.skip(!authedStorageState, 'MOBILE_R2_STORAGE_STATE 없음 — 인증 세션 실측 미검증')

    const projectUse = test.info().project.use
    const context = await browser.newContext({
      ...(authedStorageState ? { storageState: authedStorageState } : {}),
      baseURL: String(projectUse.baseURL),
      viewport: projectUse.viewport,
      userAgent: projectUse.userAgent,
      isMobile: projectUse.isMobile,
      hasTouch: projectUse.hasTouch,
      deviceScaleFactor: projectUse.deviceScaleFactor,
    })

    try {
      const page = await context.newPage()
      await page.goto('/app')

      // 세션이 만료됐으면 판정 자체가 성립하지 않는다(화면 캐시 검사이므로).
      test.skip(!new URL(page.url()).pathname.startsWith('/app'), '인증 세션 만료 — 앱 화면에 도달하지 못함')

      await page
        .waitForFunction(async () => Boolean(await navigator.serviceWorker.getRegistration()), undefined, { timeout: 20_000 })
        .catch(() => undefined)
      const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller))
      test.skip(!controlled, SW_NOT_RUNNING)

      // 실제 앱을 한 번 더 열어 캐시 쓰기 기회를 준다.
      await page.reload()
      await page.waitForTimeout(1_000)

      const entries = await readCache(page)
      const leaked = entries.filter(({ url }) => isPrivatePath(url) || SENSITIVE_QUERY.test(new URL(url).search))
      expect(leaked.map((entry) => `${entry.cache} ← ${entry.url}`), '로그인 상태의 앱 화면이 캐시에 남음').toEqual([])

      const stored = await page.evaluate(async () => {
        const out: Array<{ url: string; contentType: string; hasSetCookie: boolean }> = []
        for (const name of await caches.keys()) {
          const cache = await caches.open(name)
          for (const request of await cache.keys()) {
            const response = await cache.match(request)
            out.push({
              url: request.url,
              contentType: response?.headers.get('content-type') ?? '',
              hasSetCookie: response ? response.headers.has('set-cookie') : false,
            })
          }
        }
        return out
      })
      expect(
        stored.filter(({ url, contentType }) => contentType.includes('text/html') && pathOf(url) !== '/offline.html').map((e) => e.url),
        '인증 화면 HTML 이 캐시됨',
      ).toEqual([])
      expect(stored.filter((entry) => entry.hasSetCookie).map((entry) => entry.url), '세션 쿠키가 실린 응답이 캐시됨').toEqual([])
    } finally {
      await context.close()
    }
  })
})
