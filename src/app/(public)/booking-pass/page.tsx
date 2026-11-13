import type { Metadata } from 'next'
import Link from 'next/link'
import { resolveBookingPass } from '@/features/kakao/booking-pass/pass-view'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import BookingPassClientView from './booking-pass-client-view'
import styles from './booking-pass.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '모바일 예약패스 | 소희',
  description: '안전하게 확인하는 고객 모바일 예약패스입니다.',
  referrer: 'no-referrer',
}

type PageProps = {
  searchParams?: Promise<{ token?: string | string[] }> | { token?: string | string[] }
}

export default async function BookingPassPage(props: PageProps) {
  const resolvedParams = props.searchParams ? await props.searchParams : {}
  const rawToken = resolvedParams.token
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken

  if (!token) {
    return (
      <main className={styles.container}>
        <div className={styles.errorCard}>
          <div className={styles.errorIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className={styles.errorTitle}>예약패스를 확인할 수 없습니다</h1>
          <p className={styles.errorDescription}>
            예약패스 토큰이 전달되지 않았습니다. 안내받으신 메시지의 링크를 다시 확인해 주세요.
          </p>
          <Link href="/" className={styles.homeButton}>
            홈으로 이동
          </Link>
        </div>
      </main>
    )
  }

  // Security: Exclusively use PASS_TOKEN_SECRET. Never fallback to KAKAO_STATE_SECRET.
  const secret = process.env.PASS_TOKEN_SECRET?.trim() || ''
  if (!secret) {
    return (
      <main className={styles.container}>
        <div className={styles.errorCard}>
          <div className={styles.errorIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className={styles.errorTitle}>토큰 검증 불가</h1>
          <p className={styles.errorDescription}>
            토큰 검증 서비스를 이용할 수 없습니다. 관리자에게 문의해 주세요.
          </p>
          <Link href="/" className={styles.homeButton}>
            홈으로 이동
          </Link>
        </div>
      </main>
    )
  }

  const dbClient = createAdminSupabaseClient()
  const result = await resolveBookingPass(token, secret, dbClient)

  if (!result.ok) {
    return (
      <main className={styles.container}>
        <div className={styles.errorCard}>
          <div className={styles.errorIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className={styles.errorTitle}>예약패스를 확인할 수 없습니다</h1>
          <p className={styles.errorDescription}>
            {result.error}
          </p>
          <Link href="/" className={styles.homeButton}>
            홈으로 이동
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.container}>
      <BookingPassClientView initialPass={result.pass} token={token} />
    </main>
  )
}
