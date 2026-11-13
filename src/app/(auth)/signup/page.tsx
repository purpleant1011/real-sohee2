import Image from 'next/image'
import Link from 'next/link'
import { MARKETING_ASSETS } from '@/features/marketing/v085-assets'
import { resolveAuthReturn } from '@/features/mobile-onboarding/auth-return'
import { SignupForm } from './signup-form'
import styles from './signup.module.css'

const JOURNEY = [
  { title: '계정 만들기', detail: '이메일 또는 Google로 3분' },
  { title: '우리 가게 알려주기', detail: '기본 정보와 매장 특징 직접 입력' },
  { title: '인스타·스레드 연결', detail: '한 곳만 연결해도 시작, 나중에 해도 돼요' },
  { title: '첫 글 확인하고 발행', detail: '소희 초안을 사장님이 승인' },
] as const

type SignupPageProps = {
  searchParams?: Promise<{ next?: string; error?: string }>
}

export default async function SignupPage({ searchParams }: SignupPageProps = {}) {
  const asset = MARKETING_ASSETS.finalPlan
  const params = searchParams ? await searchParams : {}
  const authReturn = resolveAuthReturn(params)
  const nextPath = authReturn.path

  return (
    <main className={styles.page}>
      <Link className={styles.brand} href="/">
        S. 소희
      </Link>
      <section className={styles.layout}>
        <div className={styles.intro}>
          <p>가게 정보 입력부터 첫 게시물 발행까지 10분</p>
          <h1 className={styles.introTitle}>소희와 내 매장 마케팅을 시작하세요.</h1>
          <span>
            가입하면 네 단계만 거쳐 첫 게시물까지 도착해요. 사업자 인증과 계정 연결은 나중에 하셔도 됩니다.
          </span>
          <ol className={styles.journey} aria-label="가입 후 진행 순서">
            {JOURNEY.map((step, index) => (
              <li key={step.title}>
                <span className={styles.journeyIndex} aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </div>
              </li>
            ))}
          </ol>
          <Image alt={asset.alt} height={asset.height} sizes="(max-width: 760px) 100vw, 52vw" src={asset.src} width={asset.width} />
        </div>
        <div className={styles.card}>
          <h2>회원가입</h2>
          <SignupForm
            authReturnMessage={authReturn.message}
            nextPath={nextPath}
            preserveDraft={authReturn.preserveDraft}
          />
          <Link className={styles.loginLink} href={`/login?next=${encodeURIComponent(nextPath)}`}>
            이미 계정이 있나요? 로그인
          </Link>
        </div>
      </section>
    </main>
  )
}
