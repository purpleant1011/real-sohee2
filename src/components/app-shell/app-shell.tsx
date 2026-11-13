'use client'

import {
  type ConversationWorkStatus,
  nextWorkStatusPollMs,
  parseConversationWorkStatus,
} from '@/features/chat/conversation-work-status'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import {
  Bot,
  Calendar,
  ChartNoAxesCombined,
  Layers,
  MessageSquare,
  Puzzle,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react'
import { DesktopSidebar, type AppNavigationItem, type RecentConversationItem } from './desktop-sidebar'
import { MobileNav } from './mobile-nav'
import { GlobalAgentBar } from './global-agent-bar'
import { useOptionalWorkspaceContext } from '@/components/workspace/workspace-provider'
import { V085RightRail } from './v085-right-rail'
import { SoheeToastRegion } from '@/components/ui/toast-region'
import { UserProfileProvider } from '@/features/account/user-profile-context'
import { ConversationWorkStatusContext } from '@/features/chat/conversation-work-status-context'
import styles from './app-shell.module.css'

import { type ContextRailItem } from './context-rail'
export { type ContextRailItem } from './context-rail'

import { appNavigation } from './navigation'
export { CONVERSATION_COMPATIBILITY_PATHS, isCurrentAppRoute, appNavigation } from './navigation'

export type AppSection =
  | 'today'
  | 'conversation'
  | 'engagement'
  | 'customers'
  | 'campaigns'
  | 'plugins'
  | 'content'
  | 'knowledge'
  | 'automation'
  | 'schedule'
  | 'reports'
  | 'account'
  | 'general'

function appSection(pathname: string): AppSection {
  if (pathname === '/app' || pathname.startsWith('/app/conversations') || pathname.startsWith('/app/work') || pathname.startsWith('/app/inbox')) return 'conversation'
  if (pathname.startsWith('/app/engagement')) return 'engagement'
  if (pathname.startsWith('/app/customers')) return 'customers'
  if (pathname.startsWith('/app/campaigns')) return 'campaigns'
  if (pathname.startsWith('/app/plugins')) return 'plugins'
  if (pathname.startsWith('/app/knowledge')) return 'knowledge'
  if (pathname.startsWith('/app/content')) return 'content'
  if (pathname.startsWith('/app/automation')) return 'automation'
  if (pathname.startsWith('/app/schedule')) return 'schedule'
  if (pathname.startsWith('/app/reports')) return 'reports'
  if (pathname.startsWith('/app/account')) return 'account'
  return 'general'
}

export function resolveWorkspaceLabel(
  context: { workspaceName: string | null } | null,
): { text: string; verified: boolean } {
  if (!context) return { text: '작업공간 연결 안 됨', verified: false }
  const name = context.workspaceName?.trim()
  if (!name) return { text: '작업공간 이름을 불러오지 못했어요', verified: false }
  return { text: name, verified: true }
}

export function AppShell({
  activePathname,
  children,
  contextItems: _contextItems,
  contextItemsBySection: _contextItemsBySection,
  recentThreads,
  recentThreadsHasMore,
  recentThreadsLoadFailed,
  canManageThreads,
  workspaceId,
  workspaceStatus,
  unreadCount = 0,
  userAvatarUrl = null,
}: Readonly<{
  activePathname?: string
  children?: ReactNode
  contextItems?: readonly ContextRailItem[]
  contextItemsBySection?: Partial<Record<AppSection, readonly ContextRailItem[]>>
  recentThreads?: readonly RecentConversationItem[]
  recentThreadsHasMore?: boolean
  recentThreadsLoadFailed?: boolean
  canManageThreads?: boolean
  workspaceId?: string
  workspaceStatus?: string
  unreadCount?: number
  userAvatarUrl?: string | null
}>) {
  const browserPathname = usePathname()
  const pathname = (activePathname ?? browserPathname) || '/app'
  const section = appSection(pathname)
  const workspaceLabel = resolveWorkspaceLabel(useOptionalWorkspaceContext())
  const [workStatus, setWorkStatus] = useState<ConversationWorkStatus | null>(null)
  const [isRightRailOpen, setIsRightRailOpen] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    let active = true
    let latestStatus: ConversationWorkStatus | null = null
    let inFlight: Promise<void> | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      const delay = nextWorkStatusPollMs(latestStatus, document.visibilityState === 'visible')
      if (delay === null) return
      timer = setTimeout(() => {
        timer = undefined
        void poll()
      }, delay)
    }
    const poll = () => {
      if (!active || document.visibilityState !== 'visible') return Promise.resolve()
      if (inFlight) return inFlight
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      inFlight = (async () => {
        try {
          const response = await fetch(`/api/workspaces/${workspaceId}/conversation-work-status`, {
            cache: 'no-store',
          })
          if (response.ok && active) {
            const payload = await response.json() as { data?: unknown }
            latestStatus = parseConversationWorkStatus(payload.data)
            setWorkStatus(latestStatus)
          }
        } catch {
          // Keep the last confirmed status during a temporary connection failure.
        } finally {
          inFlight = null
          if (active) schedule()
        }
      })()
      return inFlight
    }
    void poll()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        if (timer) clearTimeout(timer)
        void poll()
      } else if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('sohee:work-status-refresh', poll)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('sohee:work-status-refresh', poll)
    }
  }, [workspaceId])

  return (
    <UserProfileProvider avatarUrl={userAvatarUrl}>
      <ConversationWorkStatusContext.Provider value={workStatus}>
        <div
          className={styles.shell}
          data-app-section={section}
          data-v07-contract="D-01 D-02 D-03"
        >
          <a className={styles.skipLink} href="#app-main">
            본문으로 바로가기
          </a>
          <DesktopSidebar
            items={appNavigation}
            pathname={pathname}
            recentThreads={recentThreads}
            recentThreadsHasMore={recentThreadsHasMore}
            recentThreadsLoadFailed={recentThreadsLoadFailed}
            showRecentConversations={section === 'conversation'}
            canManageThreads={canManageThreads}
            workspaceId={workspaceId}
            workspaceStatus={workspaceStatus ?? workspaceLabel.text}
            workStatus={workStatus}
          />
          <div className={styles.appFrame}>
            {/* 1. Unified Single Top Bar (GlobalAgentBar) */}
            <GlobalAgentBar
              workspaceName={workspaceLabel.text}
              workspaceNameVerified={workspaceLabel.verified}
              agentStatus="working"
              pendingApprovalCount={workStatus?.attentionThreadCount ?? 0}
              currentCredits={workStatus?.creditBalance?.available ?? 0}
              totalCredits={workStatus?.creditBalance?.weeklyLimit ?? 0}
              unreadCount={unreadCount}
              isRightRailOpen={isRightRailOpen}
              onToggleRightRail={() => setIsRightRailOpen(!isRightRailOpen)}
            />

            {/* 2. Main Workspace Layout */}
            <div className={styles.workspaceBody}>
              <main
                className={`${styles.main} ${isRightRailOpen ? styles.mainWithRail : ''}`}
                data-v07-column="primary"
                id="app-main"
                tabIndex={-1}
              >
                {children}
              </main>

              {/* 3. [사용자 요청] 우측 업무 문맥 & 사업 성과 레일 */}
              <div
                className={`${styles.slideOverRightRail} ${
                  isRightRailOpen ? styles.slideOverRightRailOpen : ''
                }`}
                aria-hidden={!isRightRailOpen}
              >
                <V085RightRail
                  onClose={() => setIsRightRailOpen(false)}
                  currentCredits={workStatus?.creditBalance?.available ?? null}
                  totalCredits={workStatus?.creditBalance?.weeklyLimit ?? null}
                />
              </div>

              {/* Overlay Backdrop for Mobile/Drawer */}
              {isRightRailOpen && (
                <div
                  className={styles.railBackdrop}
                  onClick={() => setIsRightRailOpen(false)}
                  aria-hidden="true"
                />
              )}
            </div>
            <MobileNav items={appNavigation} pathname={pathname} />
          </div>
          <SoheeToastRegion />
        </div>
      </ConversationWorkStatusContext.Provider>
    </UserProfileProvider>
  )
}
