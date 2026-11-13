'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { Briefcase, ChartNoAxesCombined, ChevronLeft, Ellipsis, House, MessageSquarePlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildUpdateNavigation } from '@/features/pwa/build-update'
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context'
import { resolveBack, safeReturnPath } from './back'
import { lastTabLocation, readScroll, rememberTabLocation, resolveTabPress, saveScroll } from './memory'
import { resolveRoute } from './routes'
import { createScreenStore, ShellContextProvider, useHasMobileShell, useScreenConfig, useShellViewport } from './shell-context'
import { useIsForceMobile, useMobileR2Active } from './r2-gate'
import { resolveSurface } from './surface'
import { SHELL_TABS } from './tabs'
import type { TabId } from './types'
import { useR2TabCodeWarmup, warmR2TabCode } from './tab-code-warmup'
import { useViewport } from './viewport'

const TAB_ICONS: Record<TabId, typeof House> = { today: House, work: Briefcase, customers: Users, results: ChartNoAxesCombined, more: Ellipsis }

/**
 * PC 기능 화면 중 자체 셸(V088 등)이 없는 경로. 모바일 표현에서는 이 경로도 모바일 셸(헤더·뒤로가기·탭)에 올린다.
 * 셸은 중첩되면 한 번만 그려지므로, 이미 셸을 쓰는 화면과 겹쳐도 안전하다.
 */
const PC_FEATURE_PREFIXES = ['/app/schedule', '/app/missions', '/app/opportunities', '/app/campaigns', '/app/account', '/app/trial-summary', '/app/connectors'] as const

/** 인증·가게·R2 게이트 뒤에서만 사용한다. 페이지 loading.tsx 바깥에 5탭을 유지한다. */
export function PersistentMobileShell({ children }: { children: ReactNode }) {
  const active = useMobileR2Active()
  const pathname = usePathname()
  const root = SHELL_TABS.some(tab => tab.href === pathname)
    || PC_FEATURE_PREFIXES.some(prefix => pathname === prefix || pathname?.startsWith(`${prefix}/`))
  return active && root ? <MobileAppShell>{children}</MobileAppShell> : <>{children}</>
}

/** 페이지가 단독으로 쓰던 셸은 공유 레이아웃 안에서는 같은 셸을 재사용한다. */
export function MobileAppShell({ children }: { children: ReactNode }) {
  const nested = useHasMobileShell()
  return nested ? <>{children}</> : <MobileShellRoot>{children}</MobileShellRoot>
}

function MobileShellRoot({ children }: { children: ReactNode }) {
  const store = useMemo(() => createScreenStore(), [])
  const viewport = useViewport()
  return (
    <ShellContextProvider store={store} viewport={viewport}>
      <ShellFrame>{children}</ShellFrame>
    </ShellContextProvider>
  )
}

function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/app'
  const search = useSearchParams()
  const router = useRouter()
  const [navigationPending, startNavigation] = useTransition()
  const [pendingTab, setPendingTab] = useState<TabId | null>(null)
  const config = useScreenConfig()
  const forceMobile = useIsForceMobile()
  const viewport = useShellViewport()
  // workspace 별 복원 상태 분리(CONTRACT §4). 컨텍스트가 없으면 무스코프로 동작한다.
  const workspaceContext = useOptionalWorkspaceContext()
  const scope = workspaceContext?.workspaceId ?? null
  const { surface, violations } = resolveSurface(pathname, config)
  const route = resolveRoute(pathname)
  const showTabbar = surface.bottom === 'tabbar' && !viewport.keyboardOpen
  useR2TabCodeWarmup(showTabbar ? scope : null, route?.tab ?? null)
  const scroller = useRef<HTMLElement>(null)
  const [hasInAppHistory, setHasInAppHistory] = useState(false)
  const first = useRef(true)
  // 쿼리가 없으면 '?' 를 붙이지 않는다. 붙이면 복원 URL 이 '/app?' 처럼 되고
  // 스크롤 저장 키도 다른 코드가 쓰는 '/app' 과 어긋나 복원이 조용히 실패한다.
  const query = search?.toString() ?? ''
  const key = query ? `${pathname}?${query}` : pathname

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && violations.length) console.warn('[mobile-shell]', violations.join(' / '))
  }, [violations])

  // 앱 안에서 이동한 적이 있으면 history.back 이 안전하다.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setHasInAppHistory(true)
  }, [pathname])

  useEffect(() => { if (route?.tab) rememberTabLocation(route.tab, key, { scope }) }, [route?.tab, key, scope])

  // 스크롤 복원(경로+쿼리 단위)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = readScroll(key, { scope })
    let raf = 0
    let pending = false
    const onScroll = () => {
      pending = true
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { pending = false; saveScroll(key, el.scrollTop, { scope }) })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
      // 마지막 프레임이 돌기 전에 화면을 떠나도(스크롤 직후 탭 전환) 위치를 잃지 않는다.
      if (pending) saveScroll(key, el.scrollTop, { scope })
    }
  }, [key, scope])

  // 화면을 옮기면서 누르고 있던 요소가 사라지면 포커스가 body 로 떨어진다. 그대로 두면
  // 키보드·스크린리더 사용자가 어디로 왔는지 알 수 없으므로 본문으로 옮긴다.
  // 아직 화면에 남아 있는 요소에 포커스가 있으면(탭바 등) 빼앗지 않고, 첫 진입도 건드리지 않는다.
  const focusOnNav = useRef(true)
  useEffect(() => {
    if (focusOnNav.current) { focusOnNav.current = false; return }
    const active = document.activeElement
    if (active && active !== document.body) return
    scroller.current?.focus({ preventScroll: true })
  }, [key])

  const goBack = useCallback(() => {
    if (config?.onBack) { config.onBack(); return }
    const override = safeReturnPath(config?.backHref)
    if (override) { router.push(override); return }
    const target = resolveBack({ pathname, from: search?.get('from'), hasInAppHistory })
    if (target.kind === 'history') router.back()
    else if (target.kind === 'href') router.push(target.href)
  }, [pathname, search, hasInAppHistory, router, config])

  const onTab = (tab: TabId, rootHref: string) => {
    const press = resolveTabPress({ tab, currentTab: route?.tab ?? null, currentHref: pathname, rootHref, last: lastTabLocation(tab, { scope }) })
    if (press.action === 'scroll-top') scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
    else {
      if (buildUpdateNavigation.navigate(press.href)) return
      if (scope) void warmR2TabCode(tab)
      // 입력 피드백은 서버/RSC 전환과 분리한다. 데이터나 완료 상태를 미리 표시하지 않는다.
      setPendingTab(tab)
      startNavigation(() => router.push(press.href))
    }
  }

  return (
    <div
      data-mobile-shell
      data-force-mobile={forceMobile ? 'true' : 'false'}
      data-mode={surface.mode}
      data-bottom={surface.bottom}
      data-keyboard={viewport.keyboardOpen ? 'open' : 'closed'}
      className={forceMobile
        ? 'fixed left-1/2 top-0 flex w-full max-w-[480px] -translate-x-1/2 flex-col border-x border-border bg-background text-foreground shadow-xl'
        : 'fixed inset-x-0 top-0 flex flex-col bg-background text-foreground'}
      style={{ height: viewport.height > 0 ? viewport.height : '100dvh' }}
    >
      <ShellHeader surface={surface} onBack={goBack} onDelegate={() => router.push(workspaceContext?.conversationWorkbenchEnabled === true ? '/app/conversations' : '/app/command?from=' + encodeURIComponent(pathname))} />
      {navigationPending ? <p role="status" data-shell-navigation-pending style={{ top: '3.5rem', marginTop: 'env(safe-area-inset-top, 0px)' }} className="pointer-events-none absolute inset-x-4 z-50 rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm">화면을 여는 중이에요.</p> : null}
      <main ref={scroller} tabIndex={-1} aria-busy={navigationPending} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 outline-none">
        {children}
      </main>
      {surface.bottom === 'cta' && surface.cta ? <ShellCtaBar cta={surface.cta} /> : null}
      {surface.bottom === 'composer' && config?.composer ? (
        <div data-shell-composer className="shrink-0 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">{config.composer}</div>
      ) : null}
      {showTabbar ? (
        <nav aria-label="소희 업무 메뉴" data-shell-tabbar className="flex shrink-0 border-t border-border bg-background px-1 pb-[env(safe-area-inset-bottom)]">
          {SHELL_TABS.map(tab => {
            const Icon = TAB_ICONS[tab.id]
            const selected = route?.tab === tab.id
            return (
              <Link key={tab.id} prefetch={false} href={tab.href} aria-current={selected ? 'page' : undefined}
                data-pending={navigationPending && pendingTab === tab.id ? 'true' : undefined}
                onPointerEnter={() => { if (scope) void warmR2TabCode(tab.id) }}
                onFocus={() => { if (scope) void warmR2TabCode(tab.id) }}
                onTouchStart={() => { if (scope) void warmR2TabCode(tab.id) }}
                onClick={e => { if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) { e.preventDefault(); onTab(tab.id, tab.href) } }}
                className={`flex min-h-16 min-w-11 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring ${navigationPending && pendingTab === tab.id ? 'bg-muted text-primary' : selected ? 'text-primary' : 'text-muted-foreground'}`}>
                <Icon className="size-5" aria-hidden="true" />{tab.label}
              </Link>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}

function ShellHeader({ surface, onBack, onDelegate }: { surface: ReturnType<typeof resolveSurface>['surface']; onBack: () => void; onDelegate: () => void }) {
  const kind = surface.policy.header
  if (kind === 'none') return null
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-2 pt-[env(safe-area-inset-top)]">
      {kind === 'app' ? (
        <>
          <span className="flex-1 px-2 text-lg font-semibold tracking-tight">소희</span>
          <Button onClick={onDelegate} aria-label="소희와 채팅" className="min-h-11 gap-1.5 rounded-xl px-3 text-sm">
            <MessageSquarePlus className="size-4" aria-hidden="true" />채팅
          </Button>
        </>
      ) : (
        <>
          <button type="button" onClick={onBack} aria-label="뒤로" className="m-press inline-flex size-11 items-center justify-center rounded-xl text-foreground hover:bg-muted active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring">
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight">{surface.title}</h1>
            {surface.status ? <p className="truncate text-xs text-muted-foreground">{surface.status}</p> : null}
          </div>
          {surface.actions.map(a => {
            if (a.element) {
              return <div key={a.id} className="relative inline-flex size-11 items-center justify-center">{a.element}</div>
            }
            return a.href
              ? <Link key={a.id} href={a.href} aria-label={a.label} className="m-press inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.98]">{a.icon ?? a.label}</Link>
              : <button key={a.id} type="button" aria-label={a.label} onClick={a.onPress} className="m-press inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.98]">{a.icon ?? a.label}</button>
          })}
        </>
      )}
    </header>
  )
}

function ShellCtaBar({ cta }: { cta: NonNullable<ReturnType<typeof resolveSurface>['surface']['cta']> }) {
  return (
    <div data-shell-cta className="shrink-0 space-y-2 border-t border-border bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {cta.disabled && cta.disabledReason ? <p className="text-sm text-muted-foreground">{cta.disabledReason}</p> : null}
      <Button onClick={cta.onPress} disabled={cta.disabled || cta.busy} aria-busy={cta.busy || undefined} className="min-h-12 w-full rounded-xl text-base">{cta.label}</Button>
      {cta.secondary?.map(s => <Button key={s.label} variant="ghost" onClick={s.onPress} disabled={s.disabled} className="min-h-11 w-full">{s.label}</Button>)}
    </div>
  )
}
