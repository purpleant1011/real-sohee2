import { AppLink as Link } from '@/components/navigation/app-link'
import { Building2, ChevronRight, type LucideIcon } from 'lucide-react'
import { ConversationThreadPanel } from '@/features/chat/conversation-thread-panel'
import type { ConversationThreadSummary } from '@/features/chat/thread-repository'
import type { ConversationWorkStatus } from '@/features/chat/conversation-work-status'
import { SoheeBrandMark } from '@/components/brand/sohee-avatar'
import styles from './app-shell.module.css'
import { isCurrentAppRoute } from './navigation'

export type AppNavigationItem = {
  href: string
  label: string
  icon: LucideIcon
  badge?: string | number
}

type DesktopSidebarProps = {
  items: readonly AppNavigationItem[]
  pathname: string
  recentThreads?: readonly RecentConversationItem[]
  recentThreadsHasMore?: boolean
  recentThreadsLoadFailed?: boolean
  showRecentConversations?: boolean
  canManageThreads?: boolean
  workspaceId?: string
  workspaceStatus?: string
  workStatus?: ConversationWorkStatus | null
}

export type RecentConversationItem = ConversationThreadSummary

export function DesktopSidebar({
  items,
  pathname,
  recentThreads = [],
  recentThreadsHasMore = false,
  recentThreadsLoadFailed = false,
  showRecentConversations = false,
  canManageThreads = false,
  workspaceId,
  workspaceStatus = '가게 이름 확인 중',
  workStatus = null,
}: Readonly<DesktopSidebarProps>) {
  const currentThreadId = pathname.match(/^\/app\/conversations\/([^/]+)$/u)?.[1] ?? null
  return (
    <aside aria-label="주요 탐색" className={`${styles.desktopSidebar} ${styles.sidebar}`} data-v07-column="navigation">
      <div className={styles.brandLockup}>
        <SoheeBrandMark size="small" />
        <div>
          <p className={styles.brand}>소희</p>
          <p className={styles.brandVersion}>V0.8.6 마케팅 운영실</p>
        </div>
      </div>
      <Link aria-label="작업공간 빠른 설정" className={styles.workspaceSwitcher} href="/app/settings/business" prefetch={false}>
        <Building2 aria-hidden="true" strokeWidth={1.8} />
        <span>{workspaceStatus}</span>
        <ChevronRight aria-hidden="true" strokeWidth={1.8} />
      </Link>
      <nav aria-label="앱 메뉴" className={styles.desktopNav}>
        {items.map(({ href, icon: Icon, label, badge }) => (
          <Link key={href} aria-current={isCurrentAppRoute(pathname, href) ? 'page' : undefined} className={styles.navLink} href={href} prefetch={false}>
            <Icon aria-hidden="true" strokeWidth={1.8} />
            <span className={styles.navLabel}>{label}</span>
            {badge ? <span className={styles.navBadge}>{badge}</span> : null}
          </Link>
        ))}
      </nav>
      {showRecentConversations && workspaceId ? (
        <div className={styles.recentConversations}>
          <ConversationThreadPanel
            canManageThreads={canManageThreads}
            currentThreadId={currentThreadId}
            hasMore={recentThreadsHasMore}
            initialLoadFailed={recentThreadsLoadFailed}
            initialThreads={recentThreads}
            variant="sidebar"
            workspaceId={workspaceId}
          />
        </div>
      ) : null}
      <section aria-label="소희 업무 상태" className={styles.soheeStatus}>
        <span className={styles.presenceDot} aria-hidden="true" />
        <div>
          <p>소희 업무 상태</p>
          <strong>{workStatus && workStatus.activeJobCount > 0 ? `작업 중 · ${workStatus.activeJobCount}개` : workspaceStatus}</strong>
          {!workStatus ? (
            <span>실제 업무 수와 활동은 서버 연결 뒤 표시해요.</span>
          ) : null}
        </div>
      </section>
    </aside>
  )
}
