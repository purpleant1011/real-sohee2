'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { OperatorInformation } from '@/features/marketing/operator-information-view'
import styles from '@/features/marketing/marketing.module.css'

const primaryNavigation = [
  { href: '/product', label: '제품' },
  { href: '/channels', label: '연결 채널' },
  { href: '/industries/beauty', label: '업종별 경험' },
  { href: '/pricing', label: '요금' },
] as const

const footerNavigation = [
  { href: '/terms', label: '이용약관' },
  { href: '/privacy', label: '개인정보 처리방침' },
  { href: '/data-deletion', label: '사용자 데이터 삭제' },
  { href: '/refund', label: '환불 안내' },
  { href: '/payment-info', label: '결제 안내' },
  { href: '/business-info', label: '사업자 정보' },
] as const

function NavigationLinks() {
  const pathname = usePathname()

  return (
    <>
      {primaryNavigation.map((item) => (
        <Link
          key={item.href}
          aria-current={pathname === item.href ? 'page' : undefined}
          className={styles.navLink}
          href={item.href}
        >
          {item.label}
        </Link>
      ))}
    </>
  )
}

function MenuControl({ isAuthenticated }: Readonly<{ isAuthenticated: boolean }>) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        aria-label="메뉴 열기"
        className={styles.menuButton}
        type="button"
        onClick={() => setMenuOpen(true)}
      >
        메뉴
      </button>
      <Dialog
        open={menuOpen}
        onOpenChange={setMenuOpen}
        restoreFocusFallbackSelector={'button[aria-label="메뉴 열기"]'}
        title="메뉴"
      >
        <nav aria-label="모바일 메뉴" className={styles.mobileNav}>
          <NavigationLinks />
          <Link
            className={styles.mobileLogin}
            href={isAuthenticated ? "/app" : "/login"}
          >
            소희 로그인
          </Link>
        </nav>
      </Dialog>
    </>
  )
}

export function PublicShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname()
  const landingActive = useMobileR2Active() && pathname === '/'
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    try {
      const supabase = createBrowserSupabaseClient()
      supabase.auth.getSession().then(({ data }) => {
        if (data?.session) {
          setIsAuthenticated(true)
        }
      }).catch(() => {})
    } catch {
      // ignore
    }
  }, [])

  function focusMain(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    document.getElementById('main-content')?.focus()
  }

  // [ANI-1672] R2 모바일 랜딩은 자체 헤더·고정 CTA를 가진다. 공개 셸의 머리말·바닥글을 겹쳐 그리지 않는다.
  // 플래그 OFF 이거나 다른 공개 경로에서는 이 분기를 타지 않으므로 지금 화면은 그대로다.
  if (landingActive) {
    return (
      <div className={styles.shell}>
        <a className={styles.skipLink} href="#main-content" onClick={focusMain}>
          본문으로 바로가기
        </a>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content" onClick={focusMain}>
        본문으로 바로가기
      </a>
      <header className={styles.header}>
        <Link className={styles.wordmark} href="/" aria-label="소희 홈">
          소희
        </Link>
        <nav className={styles.desktopNav} aria-label="주요 메뉴">
          <NavigationLinks />
        </nav>
        <div className={styles.headerActions}>
          <ThemeToggle />
          <Link
            className={styles.headerLoginButton}
            href={isAuthenticated ? "/app" : "/login"}
            aria-label="소희 로그인"
          >
            소희 로그인
          </Link>
          <Link className={styles.headerCta} href="/diagnosis" data-cta data-primary-cta>
            내 매장 무료 진단
          </Link>
          <MenuControl key={pathname} isAuthenticated={isAuthenticated} />
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className={styles.footer}>
        <Link className={styles.wordmark} href="/" aria-label="소희 홈">
          소희
        </Link>
        <p>여러 채널의 고객 반응을 답변, 예약, 콘텐츠와 다음 성장으로 연결합니다.</p>
        <div style={{ gridColumn: '1 / -1' }}>
          <OperatorInformation />
        </div>
        <nav aria-label="정책 및 안내" className={styles.footerNav}>
          {footerNavigation.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  )
}
