import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { MARKETING_ASSETS } from '@/features/marketing/v085-assets'
import { safeAuthNextPath } from '../../../features/auth/safe-auth-next-path'
import { resolveOAuthReturnNotice } from '../../../features/auth/oauth-return'
import { OAuthReturnBanner } from '../../../features/auth/oauth-return-notice'
import { loadKakaoConfig } from '@/features/kakao/config/kakao-config'
import { isKakaoLoginEnabled } from '@/features/kakao/config/login-flag'
import { LoginForm } from './login-form'
import styles from './login.module.css'

type LoginPageProps = {
  searchParams?: Promise<{ next?: string; error?: string; oauth?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps = {}) {
  const params = searchParams ? await searchParams : {}
  const next = safeAuthNextPath(params.next)
  // ANI-1761 AC-3: 취소·실패·성공 복귀를 구분해 정직하게 안내하고 다음 행동을 준다.
  const oauthNotice = resolveOAuthReturnNotice({
    oauth: params.oauth,
    error: params.error,
    next,
  })

  // 빌드 시점 NEXT_PUBLIC 값에 의존하지 않고, 서버 런타임 설정(시크릿 포함)이 모두 갖춰졌을 때만 카카오 버튼을 노출한다.
  const kakaoConfig = loadKakaoConfig(process.env)
  const kakaoEnabled =
    isKakaoLoginEnabled(process.env) && kakaoConfig.ok && Boolean(kakaoConfig.config.stateSecret)

  return (
    <main className={styles.authShell}>
      <a className={styles.skipLink} href="#login-card">로그인으로 바로가기</a>
      <Link aria-label="소희 홈" className={styles.authBrand} href="/">
        <span aria-hidden="true">S.</span>
        <strong>소희</strong>
        <small>소상공인을 위한 AI 마케팅 직원</small>
      </Link>
      <section className={styles.loginPage} aria-labelledby="login-intro-title">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>사장님의 통합 마케팅 운영실</p>
          <Image
            alt=""
            aria-hidden="true"
            className={styles.heroArt}
            height={MARKETING_ASSETS.hero.height}
            priority
            sizes="(max-width: 760px) 100vw, 0px"
            src={MARKETING_ASSETS.hero.src}
            width={MARKETING_ASSETS.hero.width}
          />
          <h1 id="login-intro-title">
            대화에서 계획하고,
            <br />
            승인하고, 성장해요
          </h1>
          <p className={styles.introText}>
            우리 가게 정보를 알려주고 인스타그램·스레드를 연결하면, 소희가 첫 게시물을 만들어 미리 보여드려요.
            가게 정보 입력부터 첫 게시물 발행까지 10분이면 충분해요.
          </p>
          <ul className={styles.trustList}>
            <li><strong>철저한 매장 정보 보호</strong><span>다른 매장과 데이터가 절대 섞이지 않고 안전해요.</span></li>
            <li><strong>사장님이 직접 확인</strong><span>소희가 쓴 글은 사장님이 OK한 것만 안전하게 게시돼요.</span></li>
            <li><strong>안전한 공식 계정 연동</strong><span>비밀번호를 저장하지 않고 플랫폼 공식 인증으로만 연결해요.</span></li>
          </ul>
        </div>
        <div className={styles.card} id="login-card" tabIndex={-1}>
          <h2>로그인</h2>
          <p className={styles.cardIntro}>이메일로 내 작업공간을 열어 보세요.</p>
          {oauthNotice ? <OAuthReturnBanner notice={oauthNotice} /> : null}
          <Suspense fallback={<div className="animate-pulse p-4 h-32 bg-zinc-100 dark:bg-zinc-800 rounded-xl" />}>
            <LoginForm next={next} kakaoEnabled={kakaoEnabled} />
          </Suspense>
          <Link className={styles.signupCta} href={`/signup?next=${encodeURIComponent(next)}`}>
            <strong>처음이신가요? 무료로 시작하기</strong>
            <span>가입 후 가게 정보만 알려주시면 10분 안에 첫 게시물까지 도착해요.</span>
          </Link>
        </div>
      </section>
      <Link className={styles.adminEntry} href="/admin-login">관리자 페이지</Link>
      <p className={styles.authFootnote}>확인된 정보와 승인된 기준만 업무에 사용합니다.</p>
    </main>
  )
}
