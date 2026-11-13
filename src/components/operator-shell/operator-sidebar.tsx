import Link from 'next/link'
import { formatBuildLabel, formatShortVersion, getBuildMeta } from '../../features/admin/build-meta/build-meta'
import {
  Activity,
  Archive,
  BarChart3,
  Bot,
  Building2,
  ClipboardCheck,
  Coins,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  MessageSquareText,
  OctagonAlert,
  ReceiptText,
  ScrollText,
  Scale,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { OperatorPermission } from '@/features/operator-auth/permissions'
import { groupOperatorNavigation, isCurrentOperatorRoute } from './operator-navigation'
import styles from './operator-shell.module.css'
import { OperatorLogoutButton } from './operator-logout-button'
import { OperatorThemeToggle } from './operator-theme-toggle'

const icons: Record<string, LucideIcon> = {
  '/admin': LayoutDashboard,
  '/admin/workspaces': Building2,
  '/admin/onboarding': UserPlus,
  '/admin/cohort': Users,
  '/admin/feedback': MessageSquare,
  '/admin/publishing': Send,
  '/admin/vault': Archive,
  '/admin/preflight': ClipboardCheck,
  '/admin/reconcile': Scale,
  '/admin/missions': Bot,
  '/admin/channels': MessageSquareText,
  '/admin/billing': CreditCard,
  '/admin/revenue': ReceiptText,
  '/admin/finops': Coins,
  '/admin/cost': BarChart3,
  '/admin/interventions': OctagonAlert,
  '/admin/system': Server,
  '/admin/audit': ScrollText,
  '/admin/admins': KeyRound,
  '/admin/governance': ShieldCheck,
}

type OperatorSidebarProps = Readonly<{
  permissions: readonly OperatorPermission[]
  pathname: string
}>

export function OperatorSidebar({ permissions, pathname }: OperatorSidebarProps) {
  const groups = groupOperatorNavigation(permissions)

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandBlock}>
        <div className={styles.brandMark} aria-hidden="true">
          <Sparkles className="size-4.5 text-white" />
        </div>
        <div className={styles.brandCopy}>
          <div className="flex items-center gap-1.5">
            <strong className={styles.brand}>소희 관리자</strong>
            <span className="rounded border border-purple-500/30 bg-purple-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-purple-800 dark:text-purple-200">{formatShortVersion(getBuildMeta())}</span>
          </div>
          <span className={styles.operatorBadge}>운영자 콘솔</span>
        </div>
      </div>

      <nav aria-label="운영사 메뉴" className={styles.sidebarNav}>
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`operator-nav-${group.id}`} className="mb-3 space-y-1">
            <h2 className={styles.groupHeading} id={`operator-nav-${group.id}`}>{group.title}</h2>
            {group.items.map((item) => {
              const Icon = icons[item.href] ?? Activity
              const isActive = isCurrentOperatorRoute(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`${styles.navLink} min-h-11`}
                  href={item.href}
                  prefetch={false}
                  title={item.description}
                >
                  <Icon aria-hidden="true" className={styles.navIcon} size={16} strokeWidth={isActive ? 2.4 : 1.8} />
                  <span className="flex-1 truncate">{item.label}</span>
                </Link>
              )
            })}
          </section>
        ))}
      </nav>

      <div className={styles.sidebarFooter}>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium">{formatBuildLabel(getBuildMeta())}</span>
          </div>
          <OperatorThemeToggle />
        </div>
        <OperatorLogoutButton className="w-full justify-center" size="sm" variant="outline" />
      </div>
    </aside>
  )
}


