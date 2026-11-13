export const dynamic = 'force-dynamic'

import { type Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isReviewModeAllowed } from '@/features/operator-auth/review-mode'
import { AdminPreviewClient } from './admin-preview-client'
import styles from '../login/login.module.css'

export const metadata: Metadata = {
  title: '소희 관리자 검수 전용 로그인 (24H 임시 링크)',
  description: 'AI 에이전트 및 심사 검수를 위한 2단계 인증(MFA) 예외 간편 로그인 전용 페이지',
}

export default function AdminPreviewPage() {
  if (!isReviewModeAllowed()) {
    notFound()
  }

  return (
    <main className={styles.authShell}>
      <Link aria-label="소희 홈" className={styles.authBrand} href="/">
        <span aria-hidden="true">S.</span>
        <strong>소희</strong>
        <small>관리자 운영센터 (검수 모드)</small>
      </Link>

      <section className="w-full flex items-center justify-center py-6 px-4">
        <AdminPreviewClient />
      </section>

      <div className="flex flex-col items-center gap-1 text-center">
        <Link className={styles.customerEntry} href="/admin-login">정규 관리자 로그인으로 이동</Link>
        <p className={styles.authFootnote}>24시간 임시 검수 링크 · AI 에이전트 검토용</p>
      </div>
    </main>
  )
}
