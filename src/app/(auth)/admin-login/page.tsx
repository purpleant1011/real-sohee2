import { Suspense } from 'react'
import Link from 'next/link'
import { safeOperatorNextPath } from '@/features/auth/safe-operator-next-path'
import { LoginForm } from '../login/login-form'
import styles from '../login/login.module.css'

type AdminLoginPageProps = {
  searchParams?: Promise<{ next?: string; error?: string }>
}

export default async function AdminLoginPage({ searchParams }: AdminLoginPageProps = {}) {
  const params = searchParams ? await searchParams : {}
  const next = safeOperatorNextPath(params.next)

  return (
    <main className={styles.authShell}>
      <a className={styles.skipLink} href="#admin-login-card">관리자 로그인으로 바로가기</a>
      <Link aria-label="소희 홈" className={styles.authBrand} href="/">
        <span aria-hidden="true">S.</span>
        <strong>소희</strong>
        <small>관리자 운영센터</small>
      </Link>
      <section className={styles.loginPage} aria-labelledby="admin-login-intro-title">
        <div className={styles.intro}>
          <p className={styles.adminIntroLabel}>SOHEE ADMIN</p>
          <h1 id="admin-login-intro-title">
            운영을 확인하고,
            <br />
            판단하고, 대응해요
          </h1>
          <p className={styles.introText}>
            고객사 운영 현황부터 승인, 감사 기록과 시스템 상태까지 관리자 전용 공간에서 확인하세요.
          </p>
          <ul className={styles.trustList}>
            <li><strong>운영 현황 통합</strong><span>고객사와 실행 상태를 한곳에서 확인해요.</span></li>
            <li><strong>승인과 감사</strong><span>중요한 변경의 사유와 기록을 남겨요.</span></li>
            <li><strong>개인 관리자 인증</strong><span>등록된 관리자 계정으로만 접근해요.</span></li>
          </ul>
        </div>
        <div className={styles.card} id="admin-login-card" tabIndex={-1}>
          <h2>관리자 로그인</h2>
          <p className={styles.cardIntro}>등록된 관리자 계정으로 운영센터를 열어 보세요.</p>
          {params.error === 'callback' ? (
            <p className={styles.callbackError} role="alert">
              관리자 로그인을 확인할 수 없습니다. 이메일과 비밀번호로 다시 시도해 주세요.
            </p>
          ) : null}
          <Suspense fallback={<div className="animate-pulse p-4 h-32 bg-zinc-100 dark:bg-zinc-800 rounded-xl" />}>
            <LoginForm next={next} variant="admin" />
          </Suspense>
        </div>
      </section>
      <div className="flex flex-col items-center gap-2 mt-4">
        <Link className={styles.customerEntry} href="/login">일반 사용자 로그인</Link>
      </div>
      <p className={styles.authFootnote}>관리자 권한은 로그인 뒤 서버에서 다시 확인합니다.</p>
    </main>
  )
}
