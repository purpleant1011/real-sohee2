'use client'

import Link from 'next/link'
import type { MouseEvent } from 'react'
import Image from 'next/image'
import { ArrowUpRight, Briefcase, ChartNoAxesCombined, ChevronRight, Ellipsis, House, MessageSquarePlus, Settings2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getMobileTab, mobileTabs } from './navigation'

type Navigate = (href: string) => void
const icons = { today: House, work: Briefcase, customers: Users, results: ChartNoAxesCombined, more: Ellipsis }
const navigate = (event: MouseEvent<HTMLAnchorElement>, href: string, onNavigate?: Navigate) => {
  if (onNavigate && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate(href) }
}

export function MobileHeader({ onDelegate, onNavigate }: { onDelegate: () => void; onNavigate?: Navigate }) {
  return <header className="sticky top-0 z-40 flex min-h-18 flex-wrap items-center justify-between gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-sm md:hidden">
    <Link prefetch={false} href="/app" onClick={event => navigate(event, '/app', onNavigate)} className="flex min-h-11 min-w-[44px] items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
      <Image src="/brand/sohee-character-v1.png" width={40} height={40} alt="" className="size-10 rounded-xl object-cover" />
      <span><span className="block text-lg font-semibold leading-tight tracking-tight">소희</span><span className="block text-xs text-muted-foreground">마케팅 직원</span></span>
    </Link>
    <div className="flex shrink-0 items-center gap-1">
      <Link prefetch={false} href="/app/sohee?tab=work&section=autonomy" aria-label="업무 제어" onClick={event => navigate(event, '/app/sohee?tab=work&section=autonomy', onNavigate)} className="inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><Settings2 className="size-5" aria-hidden="true" /></Link>
      <Button onClick={onDelegate} aria-label="소희와 채팅" className="min-h-11 gap-1.5 rounded-xl px-3 text-sm dark:text-background"><MessageSquarePlus className="size-4" aria-hidden="true" />채팅</Button>
    </div>
  </header>
}

export function MobileNavigation({ pathname, onNavigate }: { pathname: string; onNavigate?: Navigate }) {
  const selected = getMobileTab(pathname)
  return <nav aria-label="소희 업무 메뉴" data-mobile-decision-navigation className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
    {mobileTabs.map(tab => {
      const Icon = icons[tab.id]
      return <Link prefetch={false} key={tab.id} href={tab.href} aria-current={selected === tab.id ? 'page' : undefined} onClick={event => navigate(event, tab.href, onNavigate)}
        className={`flex min-h-18 min-w-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring ${selected === tab.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
        <span className={`rounded-lg px-1.5 py-1 ${selected === tab.id ? 'bg-primary/10' : ''}`}><Icon className="size-5" aria-hidden="true" /></span>{tab.label}
      </Link>
    })}
  </nav>
}

export function MobileMoreMenu({ onTheme, onLogout, children }: { onTheme?: () => void; onLogout?: () => void; children?: React.ReactNode }) {
  const entries = [
    ['업무 제어와 운영 규칙', '/app/sohee?tab=work&section=autonomy'], ['소희 가르치기', '/app/sohee'], ['매장 기본 정보', '/app/system?mobileSection=business'],
    ['채널 연결과 권한', '/app/system?mobileSection=connections'], ['이용 플랜', '/app/system?mobileSection=credits'],
    ['개인정보 관리', '/app/system?mobileSection=privacy'], ['보안과 업무 기록', '/app/system?mobileSection=security'],
    ['서비스 상태', '/app/system?mobileSection=health'],
  ] as const
  return <div className="mx-auto max-w-2xl space-y-6 pb-6">
    <header><h1 className="text-2xl font-semibold tracking-tight">더보기</h1><p className="mt-2 text-base text-muted-foreground">소희를 가르치고, 일하는 규칙을 확인해요.</p></header>
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card px-4">{entries.map(([label, href]) => <Link prefetch={false} key={href} href={href} className="flex min-h-14 items-center justify-between gap-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-ring">{label}<ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></Link>)}</div>
    <div className="space-y-2"><Button variant="outline" disabled={!onTheme} onClick={onTheme} className="min-h-12 w-full justify-between">테마 전환<ArrowUpRight className="size-4" aria-hidden="true" /></Button>{children}<Button variant="ghost" disabled={!onLogout} onClick={onLogout} className="min-h-12 w-full text-muted-foreground">로그아웃</Button></div>
  </div>
}
