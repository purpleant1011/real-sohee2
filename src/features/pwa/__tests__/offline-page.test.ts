import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PWA_BACKGROUND_COLOR, PWA_DARK_THEME_COLOR } from '../constants'

/**
 * 오프라인 폴백 페이지 (ANI-1719/1727).
 * 독립 HTML 이므로 외부 요청·개인정보 저장·열린 리다이렉트가 없어야 한다.
 */
const html = readFileSync(resolve(process.cwd(), 'public/offline.html'), 'utf8')

describe('offline fallback page', () => {
  it('is self-contained and makes no external requests', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i)
    expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i)
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).toContain('src="/icons/sohee-192.png"')
  })

  it('announces state to assistive technology and respects motion preferences', () => {
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-busy')
    expect(html).toContain('prefers-reduced-motion')
    expect(html).toContain('min-height:48px')
  })

  it('uses the same light and dark theme colors as the installed app', () => {
    expect(html).toContain(`content="${PWA_BACKGROUND_COLOR}"`)
    expect(html).toContain(`content="${PWA_DARK_THEME_COLOR}"`)
    expect(html).toContain('env(safe-area-inset-top)')
    expect(html).toContain('env(safe-area-inset-bottom)')
  })

  it('stores no personal data and queues nothing', () => {
    expect(html).not.toMatch(/localStorage|sessionStorage|indexedDB/)
  })

  it('returns only to internal app or start paths', () => {
    expect(html).toContain('/^\\/(?:app|start)(?:\\/|$)/')
    expect(html).toContain("indexOf('\\\\')<0")
    expect(html).toContain("indexOf('%')<0")
    expect(html).toMatch(/location\.replace\([^)]*\)/)
  })

  it('confirms connectivity with an uncached request', () => {
    expect(html).toContain("fetch('/manifest.webmanifest',{cache:'no-store'})")
    expect(html).toContain("addEventListener('online',check)")
  })

  it('keeps the offline manifest reachable as a cache-busting probe target', () => {
    const headers = readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf8')
    expect(headers).toContain('/manifest.webmanifest')
    expect(headers).toContain('application/manifest+json')
    expect(existsSync(resolve(process.cwd(), 'public/_headers'))).toBe(true)
  })
})
