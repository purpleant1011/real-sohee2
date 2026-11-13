'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Dialog } from '@/components/ui/dialog'
import type { OperatorPermission } from '@/features/operator-auth/permissions'
import { groupOperatorNavigation, isCurrentOperatorRoute } from './operator-navigation'
import { OperatorCommandPalette } from './operator-command-palette'
import { OperatorSidebar } from './operator-sidebar'
import { OperatorHeader } from './operator-header'
import { useOperatorDesktopMediaQuery } from './use-operator-desktop-media-query'
import styles from './operator-shell.module.css'

type OperatorShellProps = Readonly<{
  permissions: readonly OperatorPermission[]
  pathname?: string
  children?: ReactNode
  rightPanel?: ReactNode
  rightPanelOpen?: boolean
  onRightPanelOpenChange?: (open: boolean) => void
  isReviewMode?: boolean
}>

export function OperatorShell({
  children,
  onRightPanelOpenChange,
  pathname = '/admin',
  permissions,
  rightPanel,
  rightPanelOpen = false,
  isReviewMode = false,
}: OperatorShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isDesktop = useOperatorDesktopMediaQuery()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const groups = groupOperatorNavigation(permissions)
  const flatItems = groups.flatMap((group) => group.items)

  return (
    <div className={[styles.shell, isDesktop !== null && rightPanelOpen && rightPanel ? styles.hasRightPanel : ''].filter(Boolean).join(' ')}>
      <a className={styles.skipLink} href="#operator-main">본문으로 바로가기</a>
      <OperatorSidebar permissions={permissions} pathname={pathname} />
      <div className="flex flex-col flex-1 min-w-0 bg-background">
        <OperatorHeader
          menuOpen={mobileMenuOpen}
          onMenuOpen={() => setMobileMenuOpen(true)}
          onPaletteOpen={() => setPaletteOpen(true)}
          isReviewMode={isReviewMode}
        />
        <main className={styles.main} id="operator-main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <OperatorCommandPalette
        items={flatItems}
        canSearchWorkspaces={permissions.includes('workspace.read')}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />
      <div className={styles.drawerHost} id="operator-mobile-menu">
        <Dialog
          open={mobileMenuOpen}
          onOpenChange={setMobileMenuOpen}
          restoreFocusFallbackSelector="[data-operator-menu-trigger]"
          title="소희 관리자 메뉴"
        >
          <nav aria-label="운영사 메뉴" className={styles.drawerNav}>
            {groups.map((group) => (
              <section key={group.id} aria-labelledby={`operator-drawer-${group.id}`} className="space-y-1">
                <h2 className={styles.groupHeading} id={`operator-drawer-${group.id}`}>{group.title}</h2>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    aria-current={isCurrentOperatorRoute(pathname, item.href) ? 'page' : undefined}
                    className={`${styles.navLink} min-h-11`}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    prefetch={false}
                  >
                    {item.label}
                  </Link>
                ))}
              </section>
            ))}
          </nav>
        </Dialog>
      </div>
      {isDesktop === true && rightPanelOpen && rightPanel ? (
        <aside className={styles.rightPanel} data-testid="operator-right-panel" data-right-panel-mode="desktop-grid" aria-label="오른쪽 패널">
          <button type="button" aria-label="오른쪽 패널 닫기" onClick={() => onRightPanelOpenChange?.(false)}>
            닫기
          </button>
          {rightPanel}
        </aside>
      ) : null}
      {isDesktop === false && rightPanelOpen && rightPanel ? (
        <div className={styles.rightPanelDialogHost}>
          <Dialog
            open={rightPanelOpen}
            onOpenChange={(open) => onRightPanelOpenChange?.(open)}
            restoreFocusFallbackSelector="[data-operator-menu-trigger]"
            title="운영사 패널"
          >
            {rightPanel}
          </Dialog>
        </div>
      ) : null}
    </div>
  )
}

