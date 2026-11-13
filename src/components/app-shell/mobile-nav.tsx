import { AppLink as Link } from '@/components/navigation/app-link'
import styles from './app-shell.module.css'
import type { AppNavigationItem } from './desktop-sidebar'
import { isCurrentAppRoute } from './navigation'

type MobileNavProps = {
  items: readonly AppNavigationItem[]
  pathname: string
}

export function MobileNav({ items, pathname }: Readonly<MobileNavProps>) {
  return (
    <nav aria-label="앱 메뉴" className={styles.mobileNav} data-mobile-nav>
      {items.map(({ href, icon: Icon, label }) => (
        <Link key={href} aria-current={isCurrentAppRoute(pathname, href) ? 'page' : undefined} className={styles.navLink} href={href} prefetch={false}>
          <Icon aria-hidden="true" strokeWidth={1.8} />
          <span className={styles.navLabel}>{label}</span>
        </Link>
      ))}
    </nav>
  )
}
