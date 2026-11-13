'use client'

import { AppLink as Link } from '@/components/navigation/app-link'
import { CircleUserRound, Settings } from 'lucide-react'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { LogoutButton } from './logout-button'
import styles from './app-shell.module.css'
import { UserAvatar } from '@/features/account/user-avatar'

export function AccountMenu() {
  return (
    <details className={styles.accountMenu}>
      <summary aria-label="계정 메뉴 열기" role="button">
        <UserAvatar size="menu" />
      </summary>
      <div className={styles.accountPopover}>
        <div className={styles.accountPopoverHeading}>
          <strong>계정과 작업공간</strong>
          <span>설정과 로그아웃을 관리해요.</span>
        </div>
        <Link href="/app/account" prefetch={false}>
          <CircleUserRound aria-hidden="true" strokeWidth={1.8} />
          나의 소희
        </Link>
        <Link href="/app/settings/business" prefetch={false}>
          <Settings aria-hidden="true" strokeWidth={1.8} />
          작업공간 설정
        </Link>
        <div className={styles.accountUtilities}>
          <span>화면 테마</span>
          <ThemeToggle />
        </div>
        <LogoutButton />
      </div>
    </details>
  )
}
