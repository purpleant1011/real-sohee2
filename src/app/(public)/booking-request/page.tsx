import type { Metadata } from 'next'
import Link from 'next/link'
import { verifyRequestToken, getPassTokenSecret } from '@/features/booking-request/request-token'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import BookingRequestClientForm from './booking-request-client-form'
import styles from './booking-request.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '예약 신청 | 소희',
  description: '매장에 예약 신청을 남겨주시면 확인 후 카카오톡으로 안내해 드려요.',
  referrer: 'no-referrer',
  robots: {
    index: false,
    follow: false,
  },
}

type PageProps = {
  searchParams?: Promise<{ token?: string | string[] }> | { token?: string | string[] }
}

export default async function BookingRequestPage(props: PageProps) {
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
          <h1 className={styles.errorTitle}>예약 링크를 확인할 수 없어요</h1>
          <p className={styles.errorDescription}>
            예약 신청 링크가 전달되지 않았습니다. 매장에서 받으신 링크를 다시 확인해 주세요.
          </p>
          <Link href="/" className={styles.homeButton}>
            홈으로 이동
          </Link>
        </div>
      </main>
    )
  }

  const secret = getPassTokenSecret()
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
          <h1 className={styles.errorTitle}>서비스 준비 중</h1>
          <p className={styles.errorDescription}>
            예약 신청 서비스를 현재 이용할 수 없습니다. 매장에 직접 문의해 주세요.
          </p>
          <Link href="/" className={styles.homeButton}>
            홈으로 이동
          </Link>
        </div>
      </main>
    )
  }

  const tokenResult = await verifyRequestToken(token, { secret })
  if (!tokenResult.ok) {
    const errorDescription = tokenResult.reason === 'expired'
      ? '예약 신청 링크의 유효기간이 지났습니다. 매장에 새 링크를 요청해 주세요.'
      : '유효하지 않거나 손상된 예약 링크입니다. 매장에서 받으신 링크를 다시 확인해 주세요.'

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
          <h1 className={styles.errorTitle}>예약 링크를 확인할 수 없어요</h1>
          <p className={styles.errorDescription}>
            {errorDescription}
          </p>
          <Link href="/" className={styles.homeButton}>
            홈으로 이동
          </Link>
        </div>
      </main>
    )
  }

  const admin = createAdminSupabaseClient()
  let storeName = '예약 신청'

  try {
    const { data: profile } = await admin
      .from('business_profiles')
      .select('business_name')
      .eq('workspace_id', tokenResult.payload.workspaceId)
      .maybeSingle()

    if (profile?.business_name?.trim()) {
      storeName = profile.business_name.trim()
    }
  } catch {
    storeName = '예약 신청'
  }

  return (
    <main className={styles.container}>
      <BookingRequestClientForm token={token} storeName={storeName} />
    </main>
  )
}
