import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/** WCAG 2.2 AA 전체 규칙 세트 (ANI-1737). */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const

/** 터치 영역 최소 크기(px). mobile-r2-ui 규칙과 R1 기준(44)을 따른다. */
export const MIN_TOUCH = 44

export async function expectAxeClean(page: Page, opts: { exclude?: string[] } = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([...AXE_TAGS])
  for (const sel of opts.exclude ?? []) builder = builder.exclude(sel)
  const { violations } = await builder.analyze()
  const summary = violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }))
  expect(summary, 'axe WCAG 2.2 AA 위반').toEqual([])
}

/** 가로 스크롤(오버플로) 금지. 320px 에서도 문서 폭이 viewport 를 넘으면 안 된다. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const r = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== 'fixed')
      .slice(0, 5)
      .map((el) => {
        const b = el.getBoundingClientRect()
        const id = el.id ? `#${el.id}` : ''
        const cls = el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''
        // 폭/우측 좌표를 함께 남겨야 어느 컨테이너가 넘치는지 바로 특정할 수 있다.
        return `${el.tagName.toLowerCase()}${id}${cls}(right:${Math.round(b.right)},w:${Math.round(b.width)})`
      }),
  }))
  expect(r.scroll, `가로 오버플로 (viewport ${r.inner}px, 의심 요소: ${r.offenders.join(', ')})`).toBeLessThanOrEqual(r.inner)
}

/** 보이는 상호작용 요소는 44x44 이상. 본문 인라인 링크(문장 속)는 WCAG 2.2 예외라 제외한다. */
export async function expectTouchTargets(page: Page, min = MIN_TOUCH): Promise<void> {
  const small = await page.evaluate((m) => {
    const sel = 'button, [role=button], a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=link]'
    return Array.from(document.querySelectorAll<HTMLElement>(sel))
      .filter((el) => {
        const cs = getComputedStyle(el)
        const b = el.getBoundingClientRect()
        if (cs.visibility === 'hidden' || cs.display === 'none' || b.width === 0 || b.height === 0) return false
        if (el.closest('[hidden], [aria-hidden=true]')) return false
        // 문장 속 인라인 링크 예외
        if (el.tagName === 'A' && cs.display === 'inline' && el.closest('p, li')?.textContent !== el.textContent) return false
        return true
      })
      .map((el) => {
        // 네이티브 체크박스/라디오는 감싼 <label> 전체가 실제 클릭 영역이므로 label 크기로 판정한다.
        // (input 자체는 18px 이어도 label 을 누르면 토글된다 — WCAG 2.5.8 target 은 label 이다.)
        const label = el.tagName === 'INPUT' ? el.closest('label') : null
        const target = label ?? el
        const b = target.getBoundingClientRect()
        return {
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
          name: (el.getAttribute('aria-label') ?? target.textContent ?? el.tagName).trim().slice(0, 30),
          w: Math.round(b.width),
          h: Math.round(b.height),
        }
      })
      .filter((x) => x.w < m || x.h < m)
  }, min)
  expect(small, `${min}px 미만 터치 영역`).toEqual([])
}

/** viewport meta 가 확대(접근성)를 막지 않고 viewport-fit=cover(safe-area 사용)인지. */
export async function expectViewportMeta(page: Page, opts: { requireCover?: boolean } = {}): Promise<void> {
  const content = (await page.locator('meta[name=viewport]').getAttribute('content')) ?? ''
  expect(content, 'viewport meta 필요').not.toBe('')
  expect(content, '확대 금지(user-scalable=no / maximum-scale=1)는 WCAG 1.4.4 위반').not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/u)
  if (opts.requireCover) expect(content).toMatch(/viewport-fit\s*=\s*cover/u)
}

/** 사용자 화면에 내부 용어가 새지 않는지 (UUID, SHA, 영문 상태코드, 내부 용어). 소희 CLAUDE.md 사용자 화면 규칙. */
const LEAK_PATTERNS: Array<[string, RegExp]> = [
  ['UUID', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu],
  ['SHA', /\b[0-9a-f]{40}\b/iu],
  ['영문 상태코드', /\b(RESULT_UNKNOWN|NOT_VERIFIED|PROVIDER_ACCEPTED|SAME_TRUTH|PRODUCTION_SMOKE|SHOWCASE_DEMO|FAIL_CLOSED)\b/u],
  ['내부 용어', /\b(Harness|readback|release_gate|workspace_id|tenant_id)\b/iu],
  ['스택 트레이스', /\b(TypeError|ReferenceError|at\s+\S+\s+\(.*:\d+:\d+\))/u],
  ['미치환 템플릿', /\{\{[^}]+\}\}|\bundefined\b|\[object Object\]|\bNaN\b/u],
]
export async function expectNoInternalLeak(page: Page): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText)
  const hits = LEAK_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name)
  expect(hits, '사용자 화면 내부 용어/오류 노출').toEqual([])
}

export interface RuntimeProbe {
  /** 비-GET/HEAD/OPTIONS 요청 URL (BROWSE 진입만으로 쓰기가 일어나면 안 된다) */
  writes: string[]
  pageErrors: string[]
  consoleErrors: string[]
  failedRequests: string[]
}

/**
 * 실제 취소를 뜻하는 엔진별 실패 문구(소문자 비교). 엔진/플랫폼 빌드마다 문구가 다르므로
 * 문구 목록은 실측으로만 늘린다 — 추정으로 늘리면 진짜 실패를 정상으로 오인한다.
 * - Chromium: `net::ERR_ABORTED`
 * - WebKit macOS: `cancelled`
 * - WebKit Linux(iOS 프로젝트가 CI 컨테이너에서 쓰는 빌드): `Load request cancelled`
 */
const CANCELLED_ERROR_TEXTS = ['net::err_aborted', 'load request cancelled']

/**
 * 합성 차단 문구 — 실제 취소의 증거가 아니다.
 * WebKit 의 `Blocked by Web Inspector` 는 Playwright `route.abort()` 가 만든 것이므로
 * 취소로 보면 합성 실패를 정상 동작으로 오인한다.
 */
const SYNTHETIC_BLOCK_ERROR_TEXTS = ['blocked by web inspector']

function isCancellationError(errorText: string): boolean {
  const text = errorText.trim().toLowerCase()
  if (SYNTHETIC_BLOCK_ERROR_TEXTS.some((t) => text.includes(t))) return false
  return CANCELLED_ERROR_TEXTS.some((t) => text.includes(t)) || text === 'cancelled'
}

/**
 * Next.js Router 가 취소한 RSC prefetch(`?_rsc=`)의 취소 오류는 정상 동작이다
 * (페이지 이동/하이드레이션 완료 시 브라우저가 진행 중 prefetch 를 끊는다).
 * 이 경우만 증거 JSON 에서 제외하고, 그 밖의 실패 요청은 전부 그대로 남긴다.
 */
export function isCancelledRscPrefetch(method: string, url: string, errorText: string): boolean {
  return method === 'GET' && isCancellationError(errorText) && /[?&]_rsc=/u.test(url)
}

/**
 * 개발 오버레이 등 Next.js 프레임워크가 스스로 보내는 내부 요청인지 판정한다.
 *
 * 개발 서버에서 오류 오버레이는 `POST /__nextjs_original-stack-frames` 로 스택 프레임을 물어보고,
 * HMR 은 `/_next/` 아래로 요청을 보낸다. 둘 다 제품 쓰기가 아니므로 `no-writes` 게이트에서
 * "BROWSE 진입만으로 쓰기가 일어났다"는 거짓 FAIL 을 만든다. 그 오탐만 정확히 제거한다.
 *
 * 판정은 **루트 네임스페이스 + 경계**로만 한다. 접두사 포함(`includes`)으로 넓히면
 * `/app/_next/...` 같은 제품 경로나 `/_nextjs-normal` 같은 유사 라우트까지 숨겨 거짓 PASS 가 된다.
 * - `/_next/` — 정적 청크·HMR (루트 세그먼트 경계 필요)
 * - `/__nextjs_` — 개발 오버레이 내부 엔드포인트
 * 경로를 해석할 수 없는 값은 프레임워크 요청으로 단정하지 않고 그대로 기록한다(fail-closed).
 */
export function isFrameworkInternalRequest(url: string | URL): boolean {
  let pathname: string
  try {
    pathname = (typeof url === 'string' ? new URL(url) : url).pathname
  } catch {
    return false
  }
  return /^\/_next\//u.test(pathname) || /^\/__nextjs_/u.test(pathname)
}

export function attachRuntimeProbe(page: Page): RuntimeProbe {
  const probe: RuntimeProbe = { writes: [], pageErrors: [], consoleErrors: [], failedRequests: [] }
  page.on('pageerror', (e) => probe.pageErrors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') probe.consoleErrors.push(m.text()) })
  page.on('requestfailed', (r) => {
    const errorText = r.failure()?.errorText ?? ''
    if (isCancelledRscPrefetch(r.method(), r.url(), errorText)) return
    probe.failedRequests.push(`${r.method()} ${r.url()} ${errorText}`)
  })
  page.on('request', (r) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return
    // 프레임워크 내부 요청(개발 오버레이/HMR)은 제품 쓰기가 아니다.
    if (isFrameworkInternalRequest(r.url())) return
    probe.writes.push(`${r.method()} ${r.url()}`)
  })
  return probe
}

/** 차단 예외 호스트: 웹폰트/CDN 정적 자산만. provider·PG·SNS 호스트는 여기에 넣지 않는다. */
export const DEFAULT_ALLOW_HOSTS: RegExp[] = [/fonts\.(googleapis|gstatic)\.com$/u, /cdn\.jsdelivr\.net$/u]

/**
 * 요청 URL 이 차단 대상인지 판정한다.
 * 순수 함수라서 네트워크 없이 자기검증(합성 입력)이 가능하다 — 기본 허용 목록이 실제로 동작하는지 증명하는 창구.
 */
export function isOriginAllowed(target: string | URL, allowedOrigin: string, allowHosts: RegExp[] = DEFAULT_ALLOW_HOSTS): boolean {
  const url = typeof target === 'string' ? new URL(target) : target
  if (url.origin === allowedOrigin || url.protocol === 'data:' || url.protocol === 'blob:') return true
  return allowHosts.some((re) => re.test(url.hostname))
}

/** 외부 호스트 호출 금지: 앱 오리진 밖 요청은 실제 provider/PG/SNS 호출 가능성이므로 차단하고 기록한다. */
export async function blockExternalOrigins(page: Page, allowedOrigin: string, allowHosts: RegExp[] = DEFAULT_ALLOW_HOSTS): Promise<string[]> {
  const blocked: string[] = []
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (isOriginAllowed(url, allowedOrigin, allowHosts)) return route.continue()
    blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`)
    return route.abort('blockedbyclient')
  })
  return blocked
}
