'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Briefcase,
  Users,
  Archive,
  TrendingUp,
  ShieldCheck,
  Sparkles,
  Menu,
  Sun,
  Moon,
  MessageSquareText,
  CalendarDays,
  Megaphone,
  Activity,
  Settings,
  LogOut,
  MessageCircle,
  Globe
} from 'lucide-react'
import { useTheme } from '@/components/theme-provider'
import type { AgentLifecycleState } from '@/components/v088/agent-state-badge'
import { SoheeActivityLogDrawer } from '@/components/v088/drawer/sohee-activity-log-drawer'
import { SoheeAgentDock } from '@/components/agent-dock/sohee-agent-dock'
import { SyncHealthBadge } from '@/components/agent-os/sync-health-badge'
import { MobileAppShell } from '@/features/mobile-shell/mobile-app-shell'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { SurfaceContextProvider } from '@/features/agent-dock/surface-context'
import { ProposalBusProvider } from '@/features/agent-dock/proposal-bus'
import { useCreditBalance } from '@/hooks/use-credit-balance'
import { useOptionalWorkspaceContext } from '@/hooks/use-workspace-context'
import { useSoheeAutonomy } from '@/hooks/use-sohee-autonomy'
import { signOutAction } from '@/features/auth/actions'
import { clearPwaCaches } from '@/features/pwa/sw-client'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { DriverTourAdapter } from '@/features/onboarding/guide/driver-tour-adapter'
import { FeedbackLauncher } from '@/features/feedback/FeedbackLauncher'
import { GlobalSoheeCommandBar } from '@/components/v088/command/global-sohee-command-bar'
import { ChatDrawer, CHAT_DRAWER_WIDTH_PX } from '@/components/agent-dock/chat-drawer'
import { toast } from 'sonner'
import { useChatPanel, useOptionalChatPanel } from '@/features/agent-dock/chat-panel-store'
import { ConversationNavigationProvider } from '@/features/agent-dock/conversation-navigation-provider'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useHomeApprovals } from '@/features/home/home-approvals-query'
import { useMobileUi } from '@/features/mobile-decision/mobile-ui-provider'
import { getMobileMode } from '@/features/mobile-decision/navigation'
import { MobileHeader, MobileNavigation } from '@/features/mobile-decision/mobile-navigation'
import { getMobileActiveTabId, MOBILE_BOTTOM_ITEMS } from './mobile-navigation'
import { MobileSubNavigationHeader } from './mobile-sub-navigation-header'
import { MobileMoreMenuSheet } from './mobile-more-menu-sheet'
import { WorkspaceSwitcher } from './workspace-switcher'

interface V088AppShellProps {
  children: React.ReactNode
  workspaceId?: string
  agentStatus?: {
    state: AgentLifecycleState
    focusMissionTitle?: string
    pendingDecisionsCount?: number
  }
}

const DESKTOP_PRIMARY_NAV_ITEMS = [
  { name: '오늘', shortName: '오늘', href: '/app', icon: LayoutDashboard, badgeKey: 'today' },
  { name: '작업', shortName: '작업', href: '/app/content', icon: Briefcase, badgeKey: 'work' },
  { name: '고객', shortName: '고객', href: '/app/customers', icon: Users, badgeKey: 'customers' },
  { name: '성과', shortName: '성과', href: '/app/results', icon: TrendingUp, badgeKey: 'results' },
  { name: '더보기', shortName: '더보기', href: '/app/system', icon: Menu, badgeKey: 'more' },
]

const DESKTOP_SECONDARY_NAV_ITEMS = [
  { name: '소통함', shortName: '소통', href: '/app/engagement', icon: MessageCircle },
  { name: '승인 대기', shortName: '승인', href: '/app/approvals', icon: ShieldCheck },
  { name: '채널 연결', shortName: '채널 연결', href: '/app/channels', icon: Globe },
  { name: '카카오 안내', shortName: '카카오', href: '/app/kakao', icon: MessageSquareText },
  { name: '예약 일정', shortName: '일정', href: '/app/schedule', icon: CalendarDays },
  { name: '보관함', shortName: '보관', href: '/app/vault', icon: Archive },
  { name: '광고 센터', shortName: '광고', href: '/app/ads', icon: Megaphone },
  { name: '설정/도움말', shortName: '설정', href: '/app/help', icon: Settings },
]

function getDesktopPageTitle(pathname: string | null): string {
  if (!pathname) return '오늘'
  if (pathname === '/app' || pathname === '/app/command') return '오늘'
  if (pathname.startsWith('/app/content') || pathname.startsWith('/app/work')) return '작업'
  if (pathname.startsWith('/app/customers')) return '고객'
  if (pathname.startsWith('/app/results')) return '성과'
  if (pathname.startsWith('/app/engagement')) return '소통함'
  if (pathname.startsWith('/app/approvals')) return '승인 대기'
  if (pathname.startsWith('/app/channels')) return '채널 연결'
  if (pathname.startsWith('/app/kakao')) return '카카오 안내 발송 센터'
  if (pathname.startsWith('/app/schedule')) return '예약 일정'
  if (pathname.startsWith('/app/vault')) return '보관함'
  if (pathname.startsWith('/app/system') || pathname.startsWith('/app/settings') || pathname.startsWith('/app/account') || pathname.startsWith('/app/help')) return '설정/도움말'
  if (pathname.startsWith('/app/notifications')) return '알림'
  if (pathname.startsWith('/app/connectors')) return '업무 도구 연결'
  if (pathname.startsWith('/app/conversations')) return '소희와 대화'
  if (pathname.startsWith('/app/sohee')) return '안전 보호규칙'
  if (pathname.startsWith('/app/ads')) return '광고 센터'
  return '오늘'
}

function V088AppShellBody({
  children,
  workspaceId: propWorkspaceId,
  agentStatus: propAgentStatus,
}: V088AppShellProps) {
  const workspaceContext = useOptionalWorkspaceContext()
  const workspaceId = (propWorkspaceId && propWorkspaceId !== 'ws-default')
    ? propWorkspaceId
    : (workspaceContext?.workspaceId || '')
  // ANI-1779: 가게 이름 표시의 단일 출처는 서버 layout 이 검증한 컨텍스트다.
  // 클라이언트에서 business_profiles 를 따로 조회해 덮어쓰면 다른 가게 이름이 보일 수 있다.
  const workspaceName = workspaceContext?.workspaceName?.trim() || null
  const workspaceNameLabel = workspaceName ?? '가게 이름 확인 중'

  // 단일 서버 승인 집계 SSOT 연동 (메뉴 간 이동 시에도 정확한 결정 대기 건수 유지)
  const { totalPending: livePendingDecisionsCount } = useHomeApprovals(workspaceId)

  const agentStatus = {
    state: propAgentStatus?.state ?? 'running',
    focusMissionTitle: propAgentStatus?.focusMissionTitle ?? '소희가 사장님의 매장 마케팅을 안전하게 챙기고 있어요',
    pendingDecisionsCount: propAgentStatus?.pendingDecisionsCount !== undefined
      ? propAgentStatus.pendingDecisionsCount
      : livePendingDecisionsCount,
  }
  const pathname = usePathname()
  const isConversationSurface = workspaceContext?.conversationWorkbenchEnabled === true
    && (pathname === '/app/conversations' || pathname?.startsWith('/app/conversations/') === true)
  const { resolvedTheme, setTheme } = useTheme()
  useCreditBalance(workspaceId, workspaceContext?.conversationWorkbenchEnabled === true ? 'conversation' : 'energy')
  const { isRunning: isAgentRunning } = useSoheeAutonomy()
  const {
    isOpen: chatDrawerOpen,
    pendingMessage,
    openPanel,
    closePanel,
    sendFromBar,
    consumePendingMessage,
  } = useChatPanel()
  // 1440px 미만에서는 본문을 밀지 않고 드로어가 위에 겹친다 (사이드바 288 + 드로어 460 = 748px 확보 필요).
  const canPushContent = useMediaQuery('(min-width: 1440px)')
  const mobileUi = useMobileUi()
  // ANI-1664-1: 승인(/app/approvals)은 플래그와 무관하게 검토 전용 경로로 렌더한다.
  // getMobileMode가 'review'를 반환하므로 헤더와 5탭 내비게이션은 모두 숨겨지고, 플래그 OFF의
  // 레거시 모바일 헤더·하단 바도 노출되지 않는다. 노출 권한을 넓히는 우회가 아니라 승인 화면에서
  // 일반 탐색·대화 진입을 막는 안전 경로다 (docs/launch/mobile-decision-runbook.md).
  const mobileEnabled = mobileUi?.enabled || pathname === '/app/approvals'
  const mobileMode = getMobileMode(pathname ?? '/app', chatDrawerOpen)
  const [activityLogOpen, setActivityLogOpen] = useState(false)
  const [isGuideOpen, setIsGuideOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const [userName, setUserName] = useState<string>('')
  const [userEmail, setUserEmail] = useState<string>('')
  const [userAvatar, setUserAvatar] = useState<string>('')
  const [isOnboarded, setIsOnboarded] = useState<boolean>(true)

  useEffect(() => {
    // ANI-1779: 가게 이름은 서버 layout 컨텍스트만 쓴다. localStorage/business_profiles
    // 표시 캐시는 다른 가게 이름을 보여줄 수 있어 읽지도 쓰지도 않는다.
    // 이 effect 는 온보딩 완료 판정(isOnboarded)과 사용자 정보만 담당한다.

    // Fetch actual user workspace readiness & Server Truth
    try {
      const supabase = createBrowserSupabaseClient()
      supabase.auth.getUser().then(({ data }) => {
        if (data?.user) {
          const userMeta = data.user.user_metadata || {}
          const name = userMeta.full_name || userMeta.name || userMeta.user_name || data.user.email?.split('@')[0] || '사용자'
          setUserName(name)
          setUserEmail(data.user.email || '')
          setUserAvatar(userMeta.avatar_url || userMeta.picture || '')

          if (data.user.email === 'test@example.com') {
            setIsOnboarded(true)
          }

          // Query business_profiles for onboarding readiness (표시 이름으로 쓰지 않는다)
          supabase
            .from('business_profiles')
            .select('business_name')
            .limit(1)
            .maybeSingle()
            .then(({ data: profile }) => {
              const validName = profile?.business_name && 
                profile.business_name.trim() !== '' && 
                profile.business_name !== '신규 매장' && 
                profile.business_name !== '매장명 설정 대기'

              if (validName) {
                setIsOnboarded(true)
                try {
                  localStorage.setItem('sohee_onboarded', 'true')
                } catch {}
              } else {
                // Server-Authoritative Readiness Ladder: CONNECTED != AUTONOMOUS.
                // Simple 'connected' is insufficient; must be at least 'authorized' or 'verified'
                supabase
                  .from('channel_connections')
                  .select('channel, status, account_label')
                  .in('status', ['authorized', 'verified'])
                  .limit(1)
                  .then(({ data: conns }) => {
                    if (conns && conns.length > 0) {
                      setIsOnboarded(true)
                      try {
                        localStorage.setItem('sohee_onboarded', 'true')
                      } catch {}
                    } else {
                      // Server truth wins over client cache!
                      setIsOnboarded(false)
                      try {
                        localStorage.removeItem('sohee_onboarded')
                      } catch {}
                      if (pathname && !pathname.startsWith('/start') && !pathname.startsWith('/app/channels')) {
                        window.location.replace('/start')
                      }
                    }
                  })
              }
            })
        }
      })
    } catch (err) {
      console.error('[V088AppShell] Auth check error:', err)
    }
  }, [pathname])

  // User Logout Execution Handler
  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    try {
      // 1. Client Supabase signOut
      try {
        const supabase = createBrowserSupabaseClient()
        await supabase.auth.signOut()
      } catch (e) {
        console.warn('Client signOut error:', e)
      }

      // 2. Server Action signOut
      try {
        await signOutAction()
      } catch (e) {
        console.warn('Server signOut error:', e)
      }

      // 3. Clear Storage & Cookies
      if (typeof window !== 'undefined') {
        try {
          localStorage.clear()
          sessionStorage.clear()
          document.cookie.split(';').forEach((c) => {
            document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/')
          })
        } catch {}
      }

      // 3-1. 이전 사용자의 PWA 셸·정적 자산 캐시 정리 (실패해도 로그아웃은 계속 진행)
      await clearPwaCaches()

      // 4. Force hard navigate to login
      window.location.replace('/login')
    } catch (err) {
      console.error('Logout failed:', err)
      window.location.replace('/login')
    }
  }

  // Current active navigation item check
  const isActiveNav = (href: string) => {
    if (!pathname) return false
    if (href === '/app') {
      return pathname === '/app' || pathname === '/app/command'
    }
    if (href === '/app/content') {
      return pathname === '/app/content' || pathname.startsWith('/app/content/') || pathname.startsWith('/app/work')
    }
    if (href === '/app/help') {
      return pathname === '/app/help' || pathname.startsWith('/app/help/')
    }
    if (href === '/app/system') {
      return (
        pathname === '/app/system' ||
        pathname.startsWith('/app/system/') ||
        pathname.startsWith('/app/settings') ||
        pathname.startsWith('/app/account') ||
        pathname.startsWith('/app/connectors')
      )
    }
    return pathname === href || pathname.startsWith(href + '/')
  }

  const settingsFeedbackInline = /^\/app\/settings(?:\/|$)/.test(pathname ?? '')

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <SurfaceContextProvider>
      <ProposalBusProvider workspaceId={workspaceId}>
        <div className="min-h-screen bg-[var(--v088-bg)] text-[var(--v088-ink)] flex flex-col md:flex-row antialiased selection:bg-primary/10">
          {/* 본문 건너뛰기 링크 (키보드 웹 접근성) */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg focus:shadow-md focus:outline-hidden focus:ring-2 focus:ring-ring text-xs font-bold"
          >
            본문으로 건너뛰기
          </a>

          {/* Desktop Left Sidebar (288px / w-72, 1024~1279px lg:w-20, Business World Navigation - Figma 73:2) */}
          <aside data-testid="business-world-pane" className="hidden md:flex flex-col w-72 lg:w-20 xl:w-72 border-r border-[var(--v088-border)] bg-[var(--v088-surface)] shrink-0 select-none z-30 shadow-xs transition-all duration-200">
            {/* Brand Header with Avatar and Clear Version Badge */}
            <div className="h-20 xl:h-24 px-2 xl:px-5 border-b border-[var(--v088-border)] flex items-center justify-center xl:justify-between bg-zinc-50/50 dark:bg-zinc-900/30">
              <Link href="/app" className="flex items-center gap-3.5 group min-w-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary rounded-2xl" title="소희 홈으로 이동">
                {/* Sohee Character Avatar with Live Pulse */}
                <div className="relative shrink-0">
                  <div className="w-10 h-10 xl:w-13 xl:h-13 rounded-2xl ring-2 ring-primary/40 overflow-hidden bg-primary/10 shadow-md group-hover:scale-105 transition-all">
                    <Image
                      src="/brand/sohee-character-v1.png"
                      alt="마케팅 전담 직원 소희"
                      width={52}
                      height={52}
                      className="w-full h-full object-cover"
                      priority
                    />
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-white dark:ring-zinc-900 ${isAgentRunning ? 'bg-state-ok animate-pulse' : 'bg-zinc-400'}`} />
                </div>

                <div className="hidden xl:block min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold tracking-tight text-lg text-zinc-950 dark:text-zinc-50 leading-none">
                      소희
                    </span>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-lg bg-primary/10 text-primary border border-primary/30 shadow-2xs leading-none">
                      0.9.0
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 font-bold mt-1.5 block tracking-tight">
                    마케팅 전담 직원
                  </span>
                </div>
              </Link>
              <button
                onClick={toggleTheme}
                className="flex p-1.5 xl:p-2.5 rounded-xl text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary shrink-0"
                aria-label="테마 전환"
                title={mounted && resolvedTheme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
                suppressHydrationWarning
              >
                {mounted && resolvedTheme === 'dark' ? <Sun className="w-4.5 h-4.5 text-state-warn" /> : <Moon className="w-4.5 h-4.5 text-zinc-600" />}
              </button>
            </div>

            {/* Compact Autonomy State Indicator */}
            <div className="p-2 xl:p-3 mx-2 xl:mx-4 my-2 xl:my-3 rounded-2xl bg-zinc-50/90 dark:bg-zinc-900/80 border border-zinc-200/80 dark:border-zinc-800 shadow-2xs" title={isAgentRunning ? '소희 자율근무 가동 중' : '소희 업무 대기'}>
              <div className="flex items-center justify-center xl:justify-between">
                <div className="flex items-center gap-2 text-xs font-extrabold text-zinc-800 dark:text-zinc-200">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${!isOnboarded ? 'bg-state-warn animate-pulse' : isAgentRunning ? 'bg-state-ok animate-pulse' : 'bg-zinc-400'}`} />
                  <span className="hidden xl:inline">
                    {!isOnboarded
                      ? '업무 대기 (정보 필요)'
                      : isAgentRunning
                      ? '자율근무 중'
                      : '일시 정지'}
                  </span>
                </div>
                <span className={`hidden xl:inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  !isOnboarded
                    ? 'bg-state-warn-soft text-state-warn border-state-warn/30'
                    : isAgentRunning
                    ? 'bg-state-wait-soft text-state-wait border-state-wait/30'
                    : 'bg-zinc-100 text-zinc-600 border-zinc-300'
                }`}>
                  {!isOnboarded ? '설정필요' : isAgentRunning ? '가동 중' : '대기'}
                </span>
              </div>
            </div>

            {/* Desktop Navigation Links */}
            <nav aria-label="사이드바 주 탐색" className="flex-1 px-2 xl:px-4 space-y-1.5 overflow-y-auto py-1">
              {DESKTOP_PRIMARY_NAV_ITEMS.map((item) => {
                const active = isActiveNav(item.href)
                const Icon = item.icon
                const isLocked = !isOnboarded

                if (isLocked) {
                  return (
                    <div
                      key={item.name}
                      onClick={() => toast.info('온보딩을 완료하면 소희의 모든 메뉴를 이용하실 수 있어요.')}
                      className="flex items-center justify-center xl:justify-between px-2 xl:px-4 py-2.5 xl:py-3 rounded-2xl text-[15px] text-zinc-400 dark:text-zinc-600 font-bold cursor-not-allowed opacity-60 select-none border border-transparent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                      title={`${item.name} (온보딩 완료 시 이용 가능)`}
                    >
                      <div className="flex items-center gap-1 xl:gap-3.5">
                        <Icon className="w-5 h-5 xl:w-6 xl:h-6 text-zinc-300 dark:text-zinc-700 stroke-[2.2] shrink-0" />
                        <span className="hidden xl:inline text-[15px] tracking-tight">{item.name}</span>
                      </div>
                      <span className="hidden xl:inline text-[10px] font-bold px-2 py-0.5 rounded-md bg-zinc-200 dark:bg-zinc-800 text-zinc-500">
                        🔒 잠김
                      </span>
                    </div>
                  )
                }

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    title={item.name}
                    className={`relative flex items-center justify-center xl:justify-between px-2 xl:px-4 py-2.5 xl:py-3 rounded-2xl text-[15px] transition-all group cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
                      active
                        ? 'bg-primary/10 text-primary font-extrabold border border-primary/30 shadow-xs'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60 font-bold border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-1 xl:gap-3.5">
                      <Icon className={`w-5 h-5 xl:w-6 xl:h-6 shrink-0 transition-transform duration-200 group-hover:scale-110 ${active ? 'text-primary stroke-[2.5]' : 'text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-200 stroke-[2.2]'}`} />
                      <span className="hidden xl:inline text-[15px] tracking-tight whitespace-nowrap">{item.name}</span>
                    </div>
                    {item.href === '/app' && (agentStatus.pendingDecisionsCount ?? 0) > 0 && (
                      <span className="absolute top-1.5 right-1.5 xl:static text-[10px] xl:text-xs font-black px-1.5 xl:px-2 py-0.2 xl:py-0.5 min-w-[18px] text-center rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-xs">
                        {agentStatus.pendingDecisionsCount}
                      </span>
                    )}
                  </Link>
                )
              })}

              {/* Secondary Contextual Navigation (소통함 / 승인 대기 / 예약 일정 / 보관함 / 설정/도움말) */}
              <div className="pt-2.5 mt-2 border-t border-zinc-200/80 dark:border-zinc-800/80 space-y-1">
                <span className="hidden xl:block px-3 text-[11px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                  보조 메뉴
                </span>
                {DESKTOP_SECONDARY_NAV_ITEMS.map((item) => {
                  const active = isActiveNav(item.href)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      title={item.name}
                      className={`flex items-center justify-center xl:justify-between px-2 xl:px-3 py-2 xl:py-2 rounded-xl text-[13px] transition-all group cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
                        active
                          ? 'bg-primary/10 text-primary font-bold border border-primary/30'
                          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/50 font-medium border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-1 xl:gap-2.5">
                        <Icon className="w-4 h-4 xl:w-4.5 xl:h-4.5 shrink-0 text-zinc-400 group-hover:scale-105 transition-transform" />
                        <span className="hidden xl:inline text-[13px] whitespace-nowrap">{item.name}</span>
                      </div>
                    </Link>
                  )
                })}
              </div>

              {/* PC: 의견 보내기는 메뉴 바로 아래에 둔다(떠 있는 버튼이 콘텐츠를 가리지 않고, 긴 화면에서도 첫 화면에서 보이게) */}
              {!chatDrawerOpen && mobileMode !== 'chat' && (
                <div className="pt-1" title="의견 보내기">
                  <FeedbackLauncher workspaceId={workspaceId} pathname={pathname ?? ''} variant="sidebar" />
                </div>
              )}

              {/* 로그아웃 버튼 */}
              <div className="pt-2 mt-2 border-t border-zinc-200/80 dark:border-zinc-800/80">
                <button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="w-full flex items-center justify-center xl:justify-between px-2 xl:px-3 py-2 xl:py-2.5 rounded-xl text-[13px] text-zinc-500 dark:text-zinc-400 hover:text-state-danger hover:bg-state-danger-soft/80 font-bold transition-all group cursor-pointer border border-transparent hover:border-state-danger/80 disabled:opacity-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-state-danger"
                  aria-label="로그아웃"
                  title="소희에서 안전하게 로그아웃합니다"
                >
                  <div className="flex items-center gap-1 xl:gap-2.5">
                    <LogOut className="w-4 h-4 xl:w-4.5 xl:h-4.5 text-zinc-400 group-hover:text-state-danger stroke-[2] transition-transform duration-200 group-hover:scale-110 shrink-0" />
                    <span className="hidden xl:inline text-[13px] tracking-tight whitespace-nowrap">{isLoggingOut ? '로그아웃 중' : '로그아웃'}</span>
                  </div>
                </button>
              </div>
            </nav>

            {/* Workspace Footer with Live Credit Gauge */}
            <div className="p-2 xl:p-4 border-t border-[var(--v088-border)] bg-zinc-50/60 dark:bg-zinc-900/50 space-y-2 xl:space-y-3.5">
              {/* ★ 소희 AI 가이드 버튼 */}
              <button
                onClick={() => setIsGuideOpen(true)}
                className="w-full flex items-center justify-center xl:justify-between px-2 xl:px-3.5 py-2 xl:py-2.5 rounded-xl bg-gradient-to-r from-primary/10 via-state-wait/10 to-primary/10 hover:from-primary/20 hover:via-state-wait/20 hover:to-primary/20 border border-primary/80 text-primary text-xs font-bold transition-all shadow-2xs group cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="소희 AI 가이드 열기"
                title="소희 AI 온보딩 및 사용 가이드"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary group-hover:rotate-12 transition-transform shrink-0" />
                  <span className="hidden xl:inline">소희 AI 가이드</span>
                </div>
                <span className="hidden xl:inline text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                  튜토리얼
                </span>
              </button>

              <div className="flex items-center justify-center xl:justify-between gap-2">
                <WorkspaceSwitcher
                  activeId={workspaceId}
                  activeName={workspaceName}
                  fellBack={workspaceContext?.workspaceSelectionFellBack === true}
                  switchable={workspaceContext?.workspaceCanSwitch !== false}
                />
                <Link
                  href="/app/sohee"
                  className="text-xs font-bold text-state-danger hover:text-state-danger flex items-center gap-1 hover:underline whitespace-nowrap focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary rounded p-1"
                  title="안전 보호규칙"
                >
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span className="hidden xl:inline">보호규칙</span>
                </Link>
              </div>

              {/* User Account Info Bar (Google Profile / User Details) */}
              {(userName || userEmail) && (
                <div className="mt-2 xl:mt-3 p-1.5 xl:p-3 rounded-2xl bg-white dark:bg-zinc-800/90 border border-zinc-200/90 dark:border-zinc-700/80 flex items-center justify-center xl:justify-between shadow-2xs" title={userName ? `${userName} (${userEmail})` : userEmail}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 xl:w-8 xl:h-8 rounded-full bg-gradient-to-tr from-primary to-state-wait text-white font-bold flex items-center justify-center shrink-0 text-xs shadow-xs overflow-hidden">
                      {userAvatar ? (
                        <img src={userAvatar} alt={userName} className="w-full h-full object-cover" />
                      ) : (
                        userName ? userName.slice(0, 1).toUpperCase() : 'G'
                      )}
                    </div>
                    <div className="hidden xl:block min-w-0">
                      <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                        {userName || '구글 연동 사용자'}
                      </div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                        {userEmail}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className="hidden xl:flex p-1 xl:p-1.5 rounded-lg text-zinc-400 hover:text-state-danger hover:bg-state-danger-soft transition-colors cursor-pointer shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-state-danger"
                    title="로그아웃"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </aside>

      {/* Mobile Top Header */}
      {mobileEnabled ? (
        mobileMode !== 'review' ? <MobileHeader onDelegate={openPanel} /> : null
      ) : (
        <header className="md:hidden h-18 px-2.5 sm:px-4.5 bg-[var(--v088-surface)] border-b border-[var(--v088-border)] flex items-center justify-between sticky top-0 z-40 shadow-2xs gap-1.5 sm:gap-2 min-w-0 max-w-full overflow-hidden">
          <Link href="/app" className="flex items-center gap-2 sm:gap-2.5 shrink-0 min-w-0">
            <div className="relative shrink-0">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl ring-2 ring-primary/40 overflow-hidden bg-primary/10 shadow-sm">
                <Image
                  src="/brand/sohee-character-v1.png"
                  alt="마케팅 전담 직원 소희"
                  width={48}
                  height={48}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-state-ok ring-2 ring-white" />
            </div>
            <div className="shrink-0">
              <div className="flex items-center gap-1.5 leading-none whitespace-nowrap">
                <span className="font-extrabold text-base text-zinc-950 dark:text-zinc-50 whitespace-nowrap">소희</span>
                <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/30 whitespace-nowrap">
                  0.9.0
                </span>
              </div>
              <span className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 font-bold mt-1 block whitespace-nowrap">
                마케팅 전담 직원
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              onClick={() => setActivityLogOpen(true)}
              className="p-2 sm:p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-primary text-xs font-bold flex items-center shadow-xs cursor-pointer min-h-11 min-w-10 sm:min-w-11 justify-center shrink-0"
              title="24시간 루틴 및 로그"
            >
              <Activity className="w-4.5 h-4.5" />
            </button>
            {mobileMode !== 'chat' ? <button
              onClick={openPanel}
              className="px-2.5 sm:px-3.5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold flex items-center gap-1 sm:gap-1.5 shadow-sm cursor-pointer min-h-11 shrink-0 whitespace-nowrap"
            >
              <MessageSquareText className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">대화</span>
            </button> : null}
            <button
              onClick={toggleTheme}
              className="p-2 sm:p-2.5 rounded-xl text-[var(--v088-muted)] cursor-pointer min-h-11 min-w-10 sm:min-w-11 flex items-center justify-center shrink-0"
              aria-label="테마 전환"
              suppressHydrationWarning
            >
              {mounted && resolvedTheme === 'dark' ? <Sun className="w-4.5 h-4.5 text-state-warn" /> : <Moon className="w-4.5 h-4.5 text-primary" />}
            </button>
            {/* 모바일 상단 더보기 시트 트리거 (광고 센터, 설정, 업무 기록 등 PC 전체 기능 접근) */}
            <MobileMoreMenuSheet
              workspaceName={workspaceNameLabel}
              userName={userName}
              userEmail={userEmail}
              userAvatar={userAvatar}
              onOpenActivityLog={() => setActivityLogOpen(true)}
              onOpenGuide={() => setIsGuideOpen(true)}
              onLogout={handleLogout}
              isLoggingOut={isLoggingOut}
            />
          </div>
        </header>
      )}

      {/* Main Surface Area (Canonical Workbench - Figma 73:2) */}
      <main
        id="main-content"
        data-testid="workbench-pane"
        data-conversation-surface={isConversationSurface}
        style={{ marginRight: chatDrawerOpen && canPushContent ? CHAT_DRAWER_WIDTH_PX : 0 }}
        className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0 overflow-x-hidden transition-[margin] duration-300 ease-out motion-reduce:transition-none"
      >
        {/* 모바일 2차 카테고리 전환 헤더 (콘텐츠/보관함, 고객/소통함) — 성과는 전역 섹션 (ANI-1664-3) */}
        <MobileSubNavigationHeader />

        {/* Desktop Top Status & Action Bar */}
        <header className="hidden md:flex h-16 border-b border-[var(--v088-border)] bg-[var(--v088-surface)]/80 backdrop-blur-md px-6 items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-lg font-bold text-zinc-950 dark:text-zinc-50 truncate tracking-tight whitespace-nowrap">
              {getDesktopPageTitle(pathname)}
            </h1>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={toggleTheme}
              className="flex xl:hidden p-2 rounded-xl text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="헤더 테마 전환"
              title={mounted && resolvedTheme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
              suppressHydrationWarning
            >
              {mounted && resolvedTheme === 'dark' ? <Sun className="w-4 h-4 text-state-warn" /> : <Moon className="w-4 h-4 text-zinc-600" />}
            </button>
            <SyncHealthBadge workspaceId={workspaceId} />
            <button
              onClick={openPanel}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-xs cursor-pointer transition-all whitespace-nowrap shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="소희와 대화하기"
            >
              <MessageSquareText className="w-4 h-4 shrink-0" />
              <span className="hidden xl:inline whitespace-nowrap">소희와 대화</span>
              <span className="inline xl:hidden whitespace-nowrap">대화</span>
            </button>
          </div>
        </header>

        {/* Dynamic Page Children */}
        <div className={`flex-1 min-w-0 max-w-[1200px] w-full mx-auto ${isConversationSurface ? 'p-3 md:p-5' : 'px-4 sm:px-6 lg:px-8 py-6 pb-28 md:pb-36'}`}>
          {children}
          {/* 설정 입력 화면: 플로팅 버튼이 폼을 가리지 않도록 본문 맨 아래 흐름에 둔다(옆 열을 차지하지 않는다) */}
          {settingsFeedbackInline && !chatDrawerOpen && mobileMode !== 'chat' && (
            <div className="mt-8 max-w-sm md:hidden">
              <FeedbackLauncher workspaceId={workspaceId} pathname={pathname ?? ''} />
            </div>
          )}
        </div>

        {/* Global Floating/Bottom Sohee Command Bar ("소희에게 부탁하기", positioned above mobile nav) */}
        {/* ANI-1665-5: 전역 커맨드바는 BROWSE 모드 전용 CTA 다. CHAT/REVIEW 모드에서는 각 화면의
            단일 고정 CTA(대화 입력·검토 버튼)가 그 역할을 하므로 모바일에서만 숨긴다.
            md 이상(데스크톱)에는 모드 개념이 없어 기존 노출을 그대로 유지한다. */}
        {!isConversationSurface ? <div className={`sticky bottom-18 md:bottom-0 z-30 p-4 bg-gradient-to-t from-[var(--v088-bg)] via-[var(--v088-bg)]/95 to-transparent backdrop-blur-xs pointer-events-none${mobileMode === 'browse' ? '' : ' hidden md:block'}`}>
          <div className="pointer-events-auto">
            <GlobalSoheeCommandBar onOpenChat={openPanel} onSendMessage={sendFromBar} />
          </div>
        </div> : null}
      </main>

      {/* Slide-out Sohee Autonomous Agent Dock Drawer (Unified Desktop & Mobile, Progressive Disclosure) */}
      <ChatDrawer open={chatDrawerOpen} onClose={closePanel}>
        <SoheeAgentDock
          workspaceId={workspaceId}
          isOpen
          autoSendMessage={pendingMessage}
          onAutoSendConsumed={consumePendingMessage}
          onClose={closePanel}
        />
      </ChatDrawer>

      {/* Mobile Bottom Navigation (5대 핵심 탭: 오늘, 작업, 고객, 성과, 더보기) */}
      {isConversationSurface ? null : mobileEnabled ? (
        mobileMode === 'browse' ? <MobileNavigation pathname={pathname ?? '/app'} /> : null
      ) : (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 max-w-full overflow-hidden h-18 bg-[var(--v088-surface)]/95 backdrop-blur-lg border-t border-[var(--v088-border)] flex items-center justify-around z-40 px-1 pb-safe shadow-lg">
          {MOBILE_BOTTOM_ITEMS.map((tab) => {
            const active = getMobileActiveTabId(pathname) === tab.id
            const Icon = tab.icon
            const isLocked = !isOnboarded

            if (isLocked) {
              return (
                <div
                  key={tab.id}
                  onClick={() => toast.info('온보딩을 완료하면 소희의 모든 메뉴를 이용하실 수 있어요.')}
                  className="flex flex-col items-center justify-center min-w-0 flex-1 h-full relative text-zinc-400 dark:text-zinc-600 opacity-50 cursor-not-allowed select-none"
                >
                  <Icon className="w-6 h-6 mb-1 stroke-[1.8]" />
                  <span className="text-[10px] tracking-tight">🔒 잠김</span>
                </div>
              )
            }

            return (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-w-0 flex-1 flex-col items-center justify-center h-full relative transition-all ${
                  active ? 'text-primary font-extrabold' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 font-semibold'
                }`}
              >
                <div className="relative">
                  <Icon className={`w-6 h-6 mb-0.5 transition-transform ${active ? 'scale-110 stroke-[2.5]' : 'stroke-[2]'}`} />
                  {tab.badgeKey === 'approvals' && (agentStatus.pendingDecisionsCount ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-2 text-[10px] font-black px-1.5 py-0.2 min-w-[16px] text-center rounded-full bg-primary text-primary-foreground shadow-2xs">
                      {agentStatus.pendingDecisionsCount}
                    </span>
                  )}
                </div>
                <span className="text-[11px] tracking-tight">{tab.name}</span>
              </Link>
            )
          })}
        </nav>
      )}

      {/* Sohee Activity Log Drawer (Slide from right) */}
      <SoheeActivityLogDrawer
        isOpen={activityLogOpen}
        onClose={() => setActivityLogOpen(false)}
        workspaceId={workspaceId}
      />

      {!chatDrawerOpen && mobileMode !== 'chat' && !settingsFeedbackInline && <FeedbackLauncher workspaceId={workspaceId} pathname={pathname ?? ''} variant="floating-mobile" />}

      {/* Sohee AI Guide Driver Tour Modal */}
      <DriverTourAdapter
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />
    </div>
      </ProposalBusProvider>
    </SurfaceContextProvider>
  )
}

export function V088AppShell(props: V088AppShellProps) {
  const sharedPanel = useOptionalChatPanel()
  const mobileR2 = useMobileR2Active()
  // 모바일 표현(m.example.com·좁은 화면의 R2)에서는 PC 사이드바·Dock 대신 모바일 셸(헤더·뒤로·탭)에 같은 페이지 본문을 올린다.
  // 데이터·권한·기능은 그대로이고 표현만 바뀐다.
  if (mobileR2) {
    return (
      <SurfaceContextProvider>
        <ProposalBusProvider workspaceId={props.workspaceId}>
          <MobileAppShell>{props.children}</MobileAppShell>
        </ProposalBusProvider>
      </SurfaceContextProvider>
    )
  }
  if (sharedPanel) return <V088AppShellBody {...props} />
  return (
    <ConversationNavigationProvider workspaceId={props.workspaceId}>
      <V088AppShellBody {...props} />
    </ConversationNavigationProvider>
  )
}
