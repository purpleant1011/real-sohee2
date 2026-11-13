import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PWA_BACKGROUND_COLOR,
  PWA_DARK_THEME_COLOR,
  PWA_LIGHT_THEME_COLOR,
  PWA_SW_SCOPE,
  PWA_SW_URL,
} from '../constants'
import { pwaMetadata } from '../metadata'

/**
 * manifest / sw.js / constants / _headers 사이의 값이 어긋나면 설치·오프라인 동작이 조용히 깨진다.
 * 개별 파일 테스트가 아니라 파일 사이의 계약을 고정한다 (ANI-1717/1719/1723/1724/1727).
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const publicFile = (path: string) => resolve(process.cwd(), 'public', path.replace(/^\//, ''))

const swSource = read('public/sw.js')
const offlineHtml = read('public/offline.html')
const headers = read('public/_headers')
const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  id?: string
  scope?: string
  start_url?: string
  theme_color?: string
  background_color?: string
  icons?: Array<{ src: string; purpose?: string }>
  shortcuts?: Array<{ url: string }>
}

const ORIGIN = 'https://example.com'
const inScope = (path: string) => new URL(path, ORIGIN).pathname.startsWith(PWA_SW_SCOPE)

function headersBlock(path: string): string {
  const blocks = headers.split(/\n(?=\/)/)
  return blocks.find((block) => block.split('\n')[0].trim() === path) ?? ''
}

describe('manifest ↔ constants', () => {
  it('keeps the install scope identical to the service worker scope', () => {
    expect(manifest.scope).toBe(PWA_SW_SCOPE)
    expect(PWA_SW_SCOPE).toBe('/')
    // scope 와 start_url 의 pathname 이 어긋나면 설치 시 탐색이 차단된다.
    expect(manifest.start_url).toBeDefined()
    expect(inScope(manifest.start_url!)).toBe(true)
  })

  it('uses the constants as the single source for theme colors', () => {
    expect(manifest.theme_color).toBe(PWA_LIGHT_THEME_COLOR)
    expect(manifest.background_color).toBe(PWA_BACKGROUND_COLOR)
    // 오프라인 안내는 앱 화면이 아니라 전체 화면 문서이므로 배경색을 상태바 색으로 쓴다.
    expect(offlineHtml).toContain(`name="theme-color" content="${PWA_BACKGROUND_COLOR}"`)
    expect(offlineHtml).toContain(`name="theme-color" content="${PWA_DARK_THEME_COLOR}"`)
  })

  it('keeps every manifest shortcut and icon inside this origin', () => {
    for (const shortcut of manifest.shortcuts ?? []) {
      expect(inScope(shortcut.url)).toBe(true)
      expect(shortcut.url.startsWith('/')).toBe(true)
    }
    for (const icon of manifest.icons ?? []) {
      expect(icon.src.startsWith('/')).toBe(true)
      expect(existsSync(publicFile(icon.src)), `missing icon: ${icon.src}`).toBe(true)
    }
  })

  it('keeps manifest entry URLs relative and free of token-ish query (ANI-1727)', () => {
    // manifest 는 설치·단축아이콘의 진입 URL 정본이다. 절대 URL·토큰 쿼리가 들어가면
    // 설치된 앱이 외부로 열리거나 비밀값이 설치 자산에 각인된다.
    const entries = [
      String(manifest.id ?? ''),
      String(manifest.scope ?? ''),
      String(manifest.start_url ?? ''),
      ...(manifest.shortcuts ?? []).map((shortcut) => shortcut.url),
    ]

    for (const entry of entries) {
      expect(entry.startsWith('/'), entry).toBe(true)
      expect(entry.startsWith('//'), entry).toBe(false)
      expect(entry, entry).not.toMatch(/(?:token|session|state|code|sig|jwt|key)=/i)
    }
  })

  it('serves the manifest at the path Next.js metadata declares', () => {
    expect(pwaMetadata.manifest).toBe('/manifest.webmanifest')
    expect(existsSync(publicFile(String(pwaMetadata.manifest)))).toBe(true)
    expect(headersBlock('/manifest.webmanifest')).toContain('Content-Type: application/manifest+json')
  })
})

describe('sw.js ↔ constants', () => {
  it('registers the file and root scope that actually ship', () => {
    expect(PWA_SW_URL).toBe('/sw.js')
    expect(existsSync(publicFile(PWA_SW_URL))).toBe(true)
    // 서비스 워커는 자신의 디렉터리보다 넓은 scope 를 헤더로 허용받아야 한다.
    expect(headersBlock(PWA_SW_URL)).toContain(`Service-Worker-Allowed: ${PWA_SW_SCOPE}`)
  })

  it('never lets a browser pin an outdated service worker', () => {
    const block = headersBlock(PWA_SW_URL)
    expect(block).toMatch(/Cache-Control:.*no-store/)
  })

  // 이 헤더들은 Next.js 서버가 아니라 Cloudflare 정적 자산 계층이 public/_headers 로 적용한다.
  // 런타임 e2e(next start)로는 검증할 수 없어 계약을 배포 파일에서 직접 고정한다.
  it('revalidates the offline shell and manifest on every request', () => {
    for (const path of ['/manifest.webmanifest', '/offline.html']) {
      expect(headersBlock(path), path).toMatch(/Cache-Control:.*must-revalidate/)
    }
  })

  it('pre-caches only files that exist and are not app pages', () => {
    const shellAssets = /const SHELL_ASSETS = (\[[^\]]*\])/.exec(swSource)?.[1]
    expect(shellAssets).toBeDefined()
    const assets = new Function(`return ${shellAssets}`)() as string[]

    expect(assets.length).toBeGreaterThan(0)
    for (const asset of assets) {
      expect(asset.startsWith('/')).toBe(true)
      expect(asset).not.toMatch(/^\/(?:app|api|login)/)
      expect(existsSync(publicFile(asset)), `missing shell asset: ${asset}`).toBe(true)
    }
    expect(assets).toContain('/offline.html')
  })

  it('displays the same offline fallback the navigation handler references', () => {
    expect(swSource).toContain("'/offline.html'")
    expect(offlineHtml.length).toBeGreaterThan(0)
    // 오프라인 화면은 자체 완결형이어야 한다: 외부 스크립트·스타일·폰트 요청 금지.
    expect(offlineHtml).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)="https?:\/\//i)
    // 재연결 확인은 캐시되지 않는 매니페스트 프로브를 쓴다.
    expect(offlineHtml).toContain('/manifest.webmanifest')
    expect(offlineHtml).toContain("cache:'no-store'")
  })

  it('sends every push notification to a path inside the sw scope', () => {
    const pushCopy = /const PUSH_COPY = (\{[\s\S]*?\n\})/.exec(swSource)?.[1]
    expect(pushCopy).toBeDefined()
    const copy = new Function(`return ${pushCopy}`)() as Record<string, { path: string; title: string; body: string }>

    expect(Object.keys(copy).length).toBeGreaterThan(0)
    for (const [kind, entry] of Object.entries(copy)) {
      expect(inScope(entry.path), `${kind} path escapes the scope`).toBe(true)
      expect(entry.path).toMatch(/^\/(?:app|start)(?:\/|$)/)
      expect(entry.title.length).toBeGreaterThan(0)
      expect(entry.body.length).toBeGreaterThan(0)
    }
  })
})
