/* 소희 서비스 워커 (ANI-1717/1719/1723/1724).
 * 보안 계약: 정적·비개인화 자산만 캐시한다. 로그인 HTML, API, RSC, 인증, 외부 origin,
 * 서명 URL, 쿠키/토큰 응답은 절대 저장하지 않는다(= respondWith 하지 않고 브라우저에 맡김).
 * 오프라인: 네비게이션 실패 시 /offline.html (읽기 전용 안내). 쓰기 요청은 가로채지 않으며 큐도 없다.
 * 업데이트: 자동 skipWaiting 금지. 클라이언트가 안전한 시점에 SKIP_WAITING 메시지를 보낸다. */
const SW_VERSION = 'sohee-sw-v2'
const STATIC_CACHE = `sohee-static-${SW_VERSION}`
const SHELL_ASSETS = ['/offline.html', '/icons/sohee-192.png']

/** 캐시 허용 경로. 이 목록에 없으면 무조건 통과(미캐시). */
const CACHEABLE_PREFIXES = ['/_next/static/', '/fonts/', '/icons/', '/splash/']
const CACHEABLE_EXACT = ['/offline.html']
/**
 * 절대 캐시 금지 접두사(ANI-1727). 워크스페이스·고객·대화·예약·결제·승인 결과가 흐르는 표면.
 * 허용 목록보다 먼저 검사한다 — 나중에 허용 접두사가 넓어져도 사적 경로가 뚫리지 않게.
 * src/features/pwa/constants.ts 의 SW_PRIVATE_PATH_PREFIXES 와 값이 같아야 한다.
 */
const PRIVATE_PATH_PREFIXES = ['/api/', '/app/', '/admin/', '/auth/', '/operator/', '/dev/', '/_next/data/']
/** 정적 경로라도 query/fragment가 있으면 사용자별 데이터일 수 있어 공유 캐시에 넣지 않는다. */
function isCacheableUrl(url, selfOrigin) {
  if (url.origin !== selfOrigin || url.search || url.hash) return false
  if (PRIVATE_PATH_PREFIXES.some((prefix) => url.pathname.includes(prefix))) return false
  if (CACHEABLE_EXACT.includes(url.pathname)) return true
  return CACHEABLE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
}

function isStorableResponse(response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return false
  if (response.headers.get('set-cookie')) return false
  const cc = (response.headers.get('cache-control') || '').toLowerCase()
  if (/\b(no-store|private)\b/.test(cc)) return false
  const vary = (response.headers.get('vary') || '').toLowerCase()
  if (vary.includes('cookie') || vary.includes('authorization')) return false
  return true
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key.startsWith('sohee-') && key !== STATIC_CACHE).map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'SKIP_WAITING') self.skipWaiting()
  else if (data.type === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'SW_VERSION', version: SW_VERSION })
  else if (data.type === 'CLEAR_CACHES') {
    // 로그아웃·워크스페이스 전환 시 클라이언트가 호출. 방어적 전체 삭제 후 셸만 재적재.
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('sohee-')).map((k) => caches.delete(k)))),
    )
  }
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  if (request.headers.has('authorization') || request.headers.has('range')) return
  const url = new URL(request.url)

  if (request.mode === 'navigate') {
    // 네비게이션은 절대 캐시하지 않는다(로그인 HTML 포함). 네트워크 실패에만 오프라인 안내.
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE)
        return (await cache.match('/offline.html')) || new Response('오프라인입니다. 네트워크 연결을 확인해 주세요.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
      }),
    )
    return
  }

  if (!isCacheableUrl(url, self.location.origin)) return

  const hashed = url.pathname.startsWith('/_next/static/')
  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      const cached = await cache.match(request)
      if (hashed && cached) return cached // 해시 파일명은 불변 → cache-first
      const network = fetch(request)
        .then((response) => {
          if (isStorableResponse(response)) cache.put(request, response.clone())
          return response
        })
        .catch((error) => {
          if (cached) return cached
          throw error
        })
      if (cached) {
        network.catch(() => {}) // stale-while-revalidate: 백그라운드 갱신
        return cached
      }
      return network
    })(),
  )
})

/* ---- 푸시 (기본 OFF, 사용자가 동의해 구독한 경우에만 도착) ----
 * 개인정보 보호: 페이로드의 고객명/메시지 원문/금액은 사용하지 않는다. 알림 종류별 고정 문구만 표시. */
const PUSH_COPY = {
  approval: { title: '확인할 일이 있어요', body: '승인이 필요한 항목이 있어요. 앱에서 확인해 주세요.', path: '/app/approvals' },
  inbox: { title: '새 소식이 있어요', body: '소통함에 새 문의가 도착했어요.', path: '/app/inbox' },
  result: { title: '결과가 나왔어요', body: '진행한 일의 결과를 확인해 보세요.', path: '/app/results' },
  default: { title: '소희', body: '새 알림이 있어요.', path: '/app/notifications' },
}

function safeAppPath(path) {
  if (typeof path !== 'string' || path.length > 512 || path.includes('\\') || /[\u0000-\u001F\u007F]/.test(path)) return null
  const pathname = path.split(/[?#]/, 1)[0]
  if (pathname.includes('%') || !/^\/(?:app|start)(?:\/|$)/.test(pathname)) return null
  const fixed = ['/app', '/app/inbox', '/app/approvals', '/app/results', '/app/notifications', '/app/content', '/app/work/new', '/app/schedule', '/start', '/start/photo']
  const dynamic = /^\/app\/(?:missions|outcome|inbox|customers)\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  if (!fixed.includes(pathname) && !dynamic.test(pathname)) return null
  const parsed = new URL(path, 'https://local.invalid')
  const key = pathname === '/app/work/new' ? 'post' : pathname === '/app/approvals' ? 'item' : null
  const value = key && parsed.searchParams.getAll(key).length === 1 ? parsed.searchParams.get(key) : null
  if (value && /^(?:(?:dm|comment|post|booking_send|booking_confirm):)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) return `${pathname}?${key}=${encodeURIComponent(value)}`
  return pathname
}

self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch (_e) { payload = {} }
  const kind = payload && typeof payload.kind === 'string' && Object.prototype.hasOwnProperty.call(PUSH_COPY, payload.kind) ? payload.kind : 'default'
  const copy = PUSH_COPY[kind]
  const path = safeAppPath(payload && payload.path) || copy.path
  event.waitUntil(
    self.registration.showNotification(copy.title, {
      body: copy.body,
      icon: '/icons/sohee-192.png',
      badge: '/icons/sohee-192.png',
      tag: `sohee-${kind}`,
      data: { path },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = safeAppPath(event.notification.data && event.notification.data.path) || '/app'
  event.waitUntil(
    (async () => {
      const target = new URL(path, self.location.origin).href
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'navigate' in client) {
          await client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    })(),
  )
})
