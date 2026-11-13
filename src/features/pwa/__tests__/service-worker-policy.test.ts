import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PWA_SW_SCOPE, PWA_SW_URL } from '../constants'

/**
 * 서비스 워커는 번들러를 거치지 않는 public/sw.js 이므로 소스를 직접 검증한다 (ANI-1717/1723/1724/1727).
 * 개인정보·인증 응답 캐시 금지, 네비게이션 미캐시, 자동 업데이트 금지, 오프라인 발송 큐 금지를 고정한다.
 */
const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')

function extractFunction(name: string): string {
  const match = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(source)
  if (!match) throw new Error(`sw.js 에서 ${name} 을 찾지 못했습니다`)
  return match[0]
}

const cacheableUrl = new Function(
  `${/const CACHEABLE_PREFIXES = .*/.exec(source)?.[0] ?? ''}
   ${/const CACHEABLE_EXACT = .*/.exec(source)?.[0] ?? ''}
   ${/const PRIVATE_PATH_PREFIXES = .*/.exec(source)?.[0] ?? ''}
   ${/const SENSITIVE_QUERY = .*/.exec(source)?.[0] ?? ''}
   ${extractFunction('isCacheableUrl')}
   return isCacheableUrl`,
)() as (url: URL, selfOrigin: string) => boolean

const storableResponse = new Function(`${extractFunction('isStorableResponse')} return isStorableResponse`)() as (
  response: { status: number; type: string; headers: Headers },
) => boolean

const safeAppPath = new Function(`${extractFunction('safeAppPath')} return safeAppPath`)() as (
  path: unknown,
) => string | null

const origin = 'https://example.com'

function responseWith(headers: Record<string, string>, status = 200, type = 'basic') {
  return { status, type, headers: new Headers(headers) }
}

describe('service worker registration contract', () => {
  it('serves at the root scope declared in the app constants', () => {
    expect(PWA_SW_URL).toBe('/sw.js')
    expect(PWA_SW_SCOPE).toBe('/')
  })

  it('never activates a new worker on its own', () => {
    const installHandler = /addEventListener\('install'[\s\S]*?\n\}\)/.exec(source)?.[0] ?? ''
    expect(installHandler).not.toContain('skipWaiting')
    expect(source).toContain("data.type === 'SKIP_WAITING'")
    // skipWaiting 호출은 메시지 처리 한 곳에서만 일어난다.
    expect(source.match(/skipWaiting\(/g)).toHaveLength(1)
  })

  it('supports explicit cache clearing for logout and store switching', () => {
    expect(source).toContain("data.type === 'CLEAR_CACHES'")
    expect(source).toContain("data.type === 'GET_VERSION'")
    expect(source).toContain('clients.claim()')
  })
})

describe('service worker cache allowlist', () => {
  it('caches only the static, non-personal prefixes', () => {
    expect(cacheableUrl(new URL(`${origin}/_next/static/chunk/app.js`), origin)).toBe(true)
    expect(cacheableUrl(new URL(`${origin}/fonts/PretendardVariable.woff2`), origin)).toBe(true)
    expect(cacheableUrl(new URL(`${origin}/icons/sohee-192.png`), origin)).toBe(true)
    expect(cacheableUrl(new URL(`${origin}/splash/splash-1179x2556.png`), origin)).toBe(true)
    expect(cacheableUrl(new URL(`${origin}/offline.html`), origin)).toBe(true)
  })

  it('refuses app pages, APIs, auth and any other origin', () => {
    expect(cacheableUrl(new URL(`${origin}/app/inbox`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/app?launch=pwa`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/login`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/api/workspaces/1/inbox`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/_next/data/abc/app.json`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/manifest.webmanifest`), origin)).toBe(false)
    expect(cacheableUrl(new URL('https://evil.example/_next/static/x.js'), origin)).toBe(false)
  })

  it.each(['?state', '?customerId=private', '?dm_text=private', '?unknown_secret=private'])('거부 목록에 없는 query %s도 공유 캐시에 넣지 않는다', query => {
    expect(cacheableUrl(new URL(`${origin}/icons/a.png${query}`), origin)).toBe(false)
  })
  it('푸시 경로의 query와 fragment를 개인정보로 저장하지 않는다', () => {
    expect(safeAppPath('/app/inbox?customer_name=private#raw-message')).toBe('/app/inbox')
  })
  it('rejects signed and tokenized URLs even inside allowed prefixes', () => {
    expect(cacheableUrl(new URL(`${origin}/icons/a.png?token=abc`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/splash/a.png?X-Amz-Signature=abc`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/icons/a.png?expires=1&sig=2`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/icons/a.png?session=xyz`), origin)).toBe(false)
  })

  it('rejects OAuth/CSRF and invite-style secrets even inside allowed prefixes (ANI-1727)', () => {
    // state·nonce·code_verifier 는 사용자별 일회성 비밀이다. 정적 경로 아래에 붙어도 캐시하면 안 된다.
    expect(cacheableUrl(new URL(`${origin}/icons/a.png?state=abc`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/icons/a.png?nonce=abc`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/icons/a.png?code_verifier=abc`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/icons/a.png?code=abc`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/fonts/x.woff2?invite=abc`), origin)).toBe(false)
    expect(cacheableUrl(new URL(`${origin}/splash/x.png?ticket=abc`), origin)).toBe(false)
  })

  it('stores only basic, public, unauthenticated responses', () => {
    expect(storableResponse(responseWith({ 'cache-control': 'public, max-age=31536000, immutable' }))).toBe(true)
    expect(storableResponse(responseWith({ 'set-cookie': 'sb=1' }))).toBe(false)
    expect(storableResponse(responseWith({ 'cache-control': 'private, max-age=60' }))).toBe(false)
    expect(storableResponse(responseWith({ 'cache-control': 'no-store' }))).toBe(false)
    expect(storableResponse(responseWith({ vary: 'Cookie' }))).toBe(false)
    expect(storableResponse(responseWith({ vary: 'Authorization' }))).toBe(false)
    expect(storableResponse(responseWith({}, 404))).toBe(false)
    expect(storableResponse(responseWith({}, 200, 'opaque'))).toBe(false)
  })

  it('rejects percent-encoded sensitive query keys (ANI-1727)', () => {
    // ?%73tate=secret 는 브라우저가 state=secret 로 해석한다. 원문 문자열만 보면 필터를 우회한다.
    expect(cacheableUrl(new URL(`${origin}/icons/a.png?%73tate=secret`), origin)).toBe(false)
  })

  it('does not intercept writes, navigations or authenticated requests', () => {
    expect(source).toContain("if (request.method !== 'GET') return")
    expect(source).toContain("request.headers.has('authorization')")
    expect(source).toContain("request.mode === 'navigate'")

    const navigateBranch = /request\.mode === 'navigate'[\s\S]*?return\n/.exec(source)?.[0] ?? ''
    expect(navigateBranch).not.toContain('cache.put')
    expect(navigateBranch).toContain('/offline.html')
  })

  it('never queues offline work', () => {
    expect(source).not.toMatch(/indexedDB|localStorage|sessionStorage/)
    expect(source).not.toMatch(/addEventListener\('sync'|registration\.sync/)
  })
})

describe('push notification privacy', () => {
  it('uses fixed copy instead of the payload text', () => {
    expect(source).toContain('PUSH_COPY')
    expect(source).not.toMatch(/payload\.(title|body|message|customer|amount)/)

    const pushHandler = /addEventListener\('push'[\s\S]*?\n\}\)/.exec(source)?.[0] ?? ''
    expect(pushHandler).toContain('copy.body')
    expect(pushHandler).toContain('copy.title')
  })

  it('opens only internal app paths from a notification', () => {
    expect(safeAppPath('/app')).toBe('/app')
    expect(safeAppPath('/app/inbox?x=1')).toBe('/app/inbox')
    expect(safeAppPath('/start')).toBe('/start')
    expect(safeAppPath('/start/photo')).toBe('/start/photo')

    expect(safeAppPath('/admin')).toBeNull()
    expect(safeAppPath('/app-evil')).toBeNull()
    expect(safeAppPath('https://evil.example/app')).toBeNull()
    expect(safeAppPath('//evil.example/app')).toBeNull()
    expect(safeAppPath('/app/%2e%2e/admin')).toBeNull()
    expect(safeAppPath('/app\\..\\admin')).toBeNull()
    expect(safeAppPath('/app\u0000')).toBeNull()
    expect(safeAppPath('/app\n/x')).toBeNull()
    expect(safeAppPath(`/app/${'a'.repeat(600)}`)).toBeNull()
    expect(safeAppPath(undefined)).toBeNull()
    expect(safeAppPath(42)).toBeNull()
  })
})
