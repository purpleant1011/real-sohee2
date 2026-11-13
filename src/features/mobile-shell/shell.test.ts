import { describe, expect, it } from 'vitest'
import { resolveBack, safeReturnPath, withFrom } from './back'
import { MODE_POLICY, resolveBottomSurface } from './modes'
import { lastTabLocation, readScroll, rememberTabLocation, resolveTabPress, saveScroll } from './memory'
import { normalizePath, resolveRoute, SHELL_ROUTES } from './routes'
import { resolveSurface } from './surface'
import { SHELL_TABS } from './tabs'
import { computeViewport } from './viewport'
import type { ShellMode } from './types'

const cta = { label: '승인', onPress: () => {} }

describe('route map', () => {
  it('covers M01..M26', () => {
    const ids = new Set(SHELL_ROUTES.map(r => r.id))
    for (let i = 1; i <= 26; i++) expect(ids.has(`M${String(i).padStart(2, '0')}`), `M${i}`).toBe(true)
  })
  it.each([
    ['/app', 'M09', 'today', 'BROWSE'], ['/app/', 'M09', 'today', 'BROWSE'], ['/app?x=1', 'M09', 'today', 'BROWSE'],
    ['/app/content', 'M11', 'work', 'BROWSE'], ['/app/work/p1/edit', 'M12', 'work', 'EDIT'], ['/app/work/p1', 'M06', 'work', 'DETAIL'],
    ['/app/approvals', 'M19', 'today', 'REVIEW'], ['/app/approvals/a1', 'M19', 'today', 'REVIEW'], ['/app/command', 'M10', 'today', 'CHAT'],
    ['/app/engagement', 'M13', 'customers', 'BROWSE'], ['/app/schedule', 'M15', 'customers', 'BROWSE'], ['/app/results', 'M20', 'results', 'BROWSE'],
    ['/app/system', 'M25', 'more', 'BROWSE'], ['/app/channels/instagram', 'M21', 'more', 'DETAIL'], ['/app/unknown/deep', 'M25', 'more', 'DETAIL'],
  ] as [string, string, string, ShellMode][])('%s → %s/%s/%s', (path, id, tab, mode) => {
    const r = resolveRoute(path)!
    expect([r.id, r.tab, r.mode]).toEqual([id, tab, mode])
  })
  it('keeps public/auth outside the app tabs and non-app paths unresolved', () => {
    expect(resolveRoute('/login')!.tab).toBeNull()
    expect(resolveRoute('/api/x')).toBeNull()
    expect(resolveRoute('/application')).toBeNull()
  })
  it('does not match prefix siblings', () => expect(resolveRoute('/app/content-other')!.id).toBe('M25'))
  it('normalizes', () => expect(normalizePath('/app/x/?a=1#h')).toBe('/app/x'))
  it('has exactly five tabs', () => expect(SHELL_TABS.map(t => t.id)).toEqual(['today', 'work', 'customers', 'results', 'more']))
  it('resolves individual titles for /app/settings subroutes instead of generic 요금·설정', () => {
    expect(resolveRoute('/app/settings/business')?.title).toBe('가게 기본 정보')
    expect(resolveRoute('/app/settings/services')?.title).toBe('서비스 카탈로그')
    expect(resolveRoute('/app/settings/brand')?.title).toBe('브랜드 기준')
    expect(resolveRoute('/app/settings/image-style')?.title).toBe('이미지 스타일')
    expect(resolveRoute('/app/settings/members')?.title).toBe('구성원 관리')
    expect(resolveRoute('/app/settings/automation')?.title).toBe('자동화 설정')
    expect(resolveRoute('/app/ads')?.title).toBe('광고 센터')
    expect(resolveRoute('/app/ads')?.mode).toBe('DETAIL')
    expect(resolveRoute('/app/account/billing')?.title).toBe('요금제 및 결제')
    expect(resolveRoute('/app/account/billing')?.mode).toBe('DETAIL')
    expect(resolveRoute('/app/connectors')?.title).toBe('업무 도구 연결')
    expect(resolveRoute('/app/connectors')?.backFallback).toBe('/app/system')
  })
})

describe('mode surface contract', () => {
  const modes = Object.keys(MODE_POLICY) as ShellMode[]
  it.each(modes)('%s never has two fixed bottom surfaces', mode => {
    const p = MODE_POLICY[mode]
    expect([p.tabbar, p.composer, p.cta !== 'forbidden'].filter(Boolean).length === 3).toBe(false)
    expect(p.tabbar && p.composer).toBe(false)
    if (p.tabbar) expect(resolveBottomSurface(mode, true)).toBe('tabbar')
  })
  it('tabbar only in BROWSE', () => expect(modes.filter(m => MODE_POLICY[m].tabbar)).toEqual(['BROWSE']))
  it('resolves bottom surface per mode', () => {
    expect(resolveBottomSurface('REVIEW', true)).toBe('cta')
    expect(resolveBottomSurface('DETAIL', false)).toBe('none')
    expect(resolveBottomSurface('CHAT', true)).toBe('composer')
  })
  it('drops CTA in BROWSE and reports violation', () => {
    const { surface, violations } = resolveSurface('/app', { cta })
    expect(surface.cta).toBeNull()
    expect(surface.bottom).toBe('tabbar')
    expect(violations).toHaveLength(1)
  })
  it('requires CTA in REVIEW and disabled reason', () => {
    expect(resolveSurface('/app/approvals', null).violations).toHaveLength(1)
    expect(resolveSurface('/app/approvals', { cta: { ...cta, disabled: true } }).violations).toHaveLength(1)
    expect(resolveSurface('/app/approvals', { cta: { ...cta, disabled: true, disabledReason: '근거 확인 중' } }).violations).toHaveLength(0)
  })
  it('lets a screen override the route mode', () => {
    const { surface } = resolveSurface('/app/work/p1', { mode: 'EDIT', cta, title: '수정' })
    expect([surface.mode, surface.bottom, surface.title, surface.backHref]).toEqual(['EDIT', 'cta', '수정', '/app/content'])
  })
  it('has no back button in BROWSE', () => expect(resolveSurface('/app/content', null).surface.backHref).toBeNull())
})

describe('back / deep link', () => {
  it.each([
    ['/app/customers?x=1', '/app/customers?x=1'], ['/start', '/start'], ['https://evil.com', null], ['//evil.com', null], ['/app//x', null],
    ['/application', null], ['/app\\x', null], [null, null], ['/api/secret', null],
  ])('safeReturnPath(%s)', (raw, out) => expect(safeReturnPath(raw as string | null)).toBe(out))
  it('prefers history, then from, then fallback', () => {
    expect(resolveBack({ pathname: '/app/approvals/1', from: '/app/engagement', hasInAppHistory: true })).toEqual({ kind: 'history' })
    expect(resolveBack({ pathname: '/app/approvals/1', from: '/app/engagement', hasInAppHistory: false })).toEqual({ kind: 'href', href: '/app/engagement' })
    expect(resolveBack({ pathname: '/app/approvals/1', from: 'https://evil.com', hasInAppHistory: false })).toEqual({ kind: 'href', href: '/app' })
    expect(resolveBack({ pathname: '/app/customers/9', hasInAppHistory: false })).toEqual({ kind: 'href', href: '/app/customers' })
    expect(resolveBack({ pathname: '/app', hasInAppHistory: false })).toEqual({ kind: 'none' })
    expect(resolveBack({ pathname: '/api/x', hasInAppHistory: false })).toEqual({ kind: 'none' })
  })
  it('withFrom encodes safe current path only', () => {
    expect(withFrom('/app/work/1', '/app/content?f=draft')).toBe('/app/work/1?from=%2Fapp%2Fcontent%3Ff%3Ddraft')
    expect(withFrom('/app/work/1?a=1', '/app/x')).toContain('&from=')
    expect(withFrom('/app/work/1', 'https://x')).toBe('/app/work/1')
  })
})

describe('restoration memory', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), keys: () => [...m.keys()] }
  }
  it('round-trips scroll per path+query and ignores junk', () => {
    const s = mem()
    saveScroll('/app/content?f=a', 420.4, { store: s }); saveScroll('/app/content?f=b', 5, { store: s })
    expect(readScroll('/app/content?f=a', { store: s })).toBe(420)
    expect(readScroll('/app/content?f=b', { store: s })).toBe(5)
    expect(readScroll('/none', { store: s })).toBe(0)
    s.setItem('sohee.shell.scroll:bad', 'abc'); expect(readScroll('bad', { store: s })).toBe(0)
    expect(readScroll('x', { store: null })).toBe(0)
  })
  it('keeps the unscoped key layout so entries saved before scoping still restore', () => {
    const s = mem()
    saveScroll('/app/content', 120, { store: s })
    rememberTabLocation('work', '/app/content?f=draft', { store: s })
    expect(s.keys()).toEqual(['sohee.shell.scroll:/app/content', 'sohee.shell.tab:work'])
    expect(readScroll('/app/content', { store: s })).toBe(120)
  })
  it('isolates scroll and tab location per workspace', () => {
    const s = mem()
    const a = { store: s, scope: 'ws-a' }
    const b = { store: s, scope: 'ws-b' }
    saveScroll('/app/content', 500, a)
    rememberTabLocation('work', '/app/content?f=draft', a)
    expect(readScroll('/app/content', a)).toBe(500)
    expect(lastTabLocation('work', a)).toBe('/app/content?f=draft')
    // 다른 workspace 로 바뀌면 이전 workspace 의 위치가 새지 않는다.
    expect(readScroll('/app/content', b)).toBe(0)
    expect(lastTabLocation('work', b)).toBeNull()
    // 무스코프(컨텍스트 없음)는 스코프 키를 읽지 않는다.
    expect(readScroll('/app/content', { store: s })).toBe(0)
    expect(lastTabLocation('work', { store: s })).toBeNull()
  })
  it('treats a blank scope as unscoped and encodes the scope token', () => {
    const s = mem()
    saveScroll('k', 7, { store: s, scope: '  ' })
    expect(s.keys()).toEqual(['sohee.shell.scroll:k'])
    saveScroll('k', 1, { store: s, scope: 'a:b' })
    expect(s.keys()).toContain('sohee.shell.scroll:a%3Ab:k')
    expect(readScroll('k', { store: s, scope: 'a:b' })).toBe(1)
    expect(readScroll('k', { store: s })).toBe(7)
  })
  it.each(['/application', 'https://example.com/app/content', '//example.com', '/app/customers/123', '/start', '/app\\content'])('rejects unsafe or other-tab saved location: %s', last => {
    expect(resolveTabPress({ tab: 'work', currentTab: 'today', currentHref: '/app', rootHref: '/app/content', last })).toEqual({ action: 'go', href: '/app/content' })
  })
  it('tab press: last location, root, or scroll-top', () => {
    const s = mem(); rememberTabLocation('work', '/app/content?f=draft', { store: s })
    expect(lastTabLocation('work', { store: s })).toBe('/app/content?f=draft')
    const base = { rootHref: '/app/content', last: '/app/content?f=draft' }
    expect(resolveTabPress({ tab: 'work', currentTab: 'today', currentHref: '/app', ...base })).toEqual({ action: 'go', href: '/app/content?f=draft' })
    expect(resolveTabPress({ tab: 'work', currentTab: 'work', currentHref: '/app/work/1', ...base })).toEqual({ action: 'go', href: '/app/content' })
    expect(resolveTabPress({ tab: 'work', currentTab: 'work', currentHref: '/app/content', ...base })).toEqual({ action: 'scroll-top' })
    expect(resolveTabPress({ tab: 'work', currentTab: 'today', currentHref: '/app', rootHref: '/app/content', last: 'https://x' })).toEqual({ action: 'go', href: '/app/content' })
  })
})

describe('viewport engine', () => {
  const base = { layoutHeight: 800, visualHeight: 800, visualOffsetTop: 0, scale: 1 }
  it('detects keyboard by covered height', () => {
    expect(computeViewport(base)).toEqual({ height: 800, keyboardOpen: false, keyboardHeight: 0 })
    expect(computeViewport({ ...base, visualHeight: 500 })).toEqual({ height: 500, keyboardOpen: true, keyboardHeight: 300 })
  })
  it('ignores address-bar collapse and pinch zoom', () => {
    expect(computeViewport({ ...base, visualHeight: 740 }).keyboardOpen).toBe(false)
    expect(computeViewport({ ...base, visualHeight: 400, scale: 2 })).toEqual({ height: 800, keyboardOpen: false, keyboardHeight: 0 })
  })
  it('accounts for offsetTop (iOS scrolls the visual viewport)', () => {
    expect(computeViewport({ ...base, visualHeight: 500, visualOffsetTop: 100 }).keyboardHeight).toBe(200)
  })
})
