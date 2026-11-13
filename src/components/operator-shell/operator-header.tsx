import { Search, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { OperatorLogoutButton } from './operator-logout-button'
import { formatShortVersion, getBuildMeta } from '../../features/admin/build-meta/build-meta'
import { OperatorThemeToggle } from './operator-theme-toggle'
import styles from './operator-shell.module.css'

type OperatorHeaderProps = Readonly<{
  onMenuOpen: () => void
  onPaletteOpen: () => void
  menuOpen: boolean
  isReviewMode?: boolean
}>

export function OperatorHeader({ onMenuOpen, onPaletteOpen, menuOpen, isReviewMode = false }: OperatorHeaderProps) {
  return (
    <header className={styles.header}>
      <div className="flex items-center gap-3">
        <Button
          aria-controls="operator-mobile-menu"
          aria-expanded={menuOpen}
          aria-label="운영사 메뉴 열기"
          className={`${styles.menuTrigger} min-h-11`}
          data-operator-menu-trigger
          onClick={onMenuOpen}
          variant="outline"
          size="sm"
        >
          메뉴
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">운영자 허브</span>
          <Badge variant="secondary" className="px-1.5 font-mono text-[10px] font-bold bg-purple-500/15 text-purple-800 border border-purple-500/30 dark:text-purple-200">
            {formatShortVersion(getBuildMeta())}
          </Badge>
        </div>
      </div>

      <div className={styles.headerActions}>
        <button
          aria-label="빠른 이동 열기"
          className="flex min-h-11 items-center gap-2 rounded-lg border bg-muted/30 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50"
          data-operator-palette-trigger
          onClick={onPaletteOpen}
          type="button"
        >
          <Search aria-hidden="true" className="size-3.5" />
          <span className="hidden sm:inline">메뉴·고객사 검색</span>
          <kbd className="hidden rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] sm:inline">⌘K</kbd>
        </button>

        {isReviewMode ? (
          <Badge variant="outline" className="items-center gap-1.5 border-purple-500/40 bg-purple-500/10 px-2.5 py-1 text-[11px] text-purple-800 dark:text-purple-200">
            <Sparkles aria-hidden="true" className="size-3" />
            AI 검수 모드 (24시간 임시)
          </Badge>
        ) : null}

        <span className={`${styles.headerBadge} hidden sm:inline`}>
          {isReviewMode ? 'AI 검수자' : '운영사 관리자'}
        </span>

        <OperatorThemeToggle />
        <OperatorLogoutButton size="sm" variant="ghost" className="ml-1 min-h-11 px-2.5 text-xs text-muted-foreground hover:bg-muted/80 hover:text-foreground" />
      </div>
    </header>
  )
}
