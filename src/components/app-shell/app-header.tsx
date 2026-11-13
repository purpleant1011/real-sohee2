'use client'

import { AppLink as Link } from '@/components/navigation/app-link'
import { Bell } from 'lucide-react'
import type { ReactNode } from 'react'
import { AccountMenu } from './account-menu'
import styles from './app-shell.module.css'
import { SoheeBrandMark } from '@/components/brand/sohee-avatar'

export function AppHeader({ title = '소희', workspaceStatus = '작업공간 연결 전', unreadCount = 0, contextMenu }: Readonly<{
  title?: string
  workspaceStatus?: string
  unreadCount?: number
  contextMenu?: ReactNode
}>) {
  return (
    <header className={styles.header}>
      <div className={styles.headerIdentity}>
        <span aria-hidden="true" className={styles.mobileHeaderBrand} data-mobile-sohee-logo>
          <SoheeBrandMark size="small" />
        </span>
        <div className={styles.headerWorkspace}>
          <p className={styles.headerTitle}>{title}</p>
          <p className={styles.workspaceStatus}>{workspaceStatus}</p>
        </div>
      </div>
      <div className={styles.headerActions}>
        {contextMenu}
        <Link aria-label="알림 열기" className={styles.headerIconButton} href="/app/notifications" prefetch={false}>
          <Bell aria-hidden="true" strokeWidth={1.8} />
          {unreadCount > 0 ? <span className={styles.unreadBadge}>{Math.min(unreadCount, 99)}</span> : null}
        </Link>
        <AccountMenu />
      </div>
    </header>
  )
}
