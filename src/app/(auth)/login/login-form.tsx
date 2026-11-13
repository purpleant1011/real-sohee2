'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { clearSupabaseAuthCookies } from '@/lib/supabase/clear-stale-auth-cookies'
import { signInAction } from '@/features/auth/actions'
import { safeAuthNextPath } from '../../../features/auth/safe-auth-next-path'
import { safeOperatorNextPath } from '@/features/auth/safe-operator-next-path'
import styles from './login.module.css'

type LoginFormProps = {
  next?: string
  variant?: 'customer' | 'admin'
  /** 서버가 런타임 환경변수로 판정한 카카오 로그인 사용 가능 여부. 없으면 빌드 시점 공개 플래그로 폴백한다. */
  kakaoEnabled?: boolean
}

export function LoginForm({ next: explicitNext, variant = 'customer', kakaoEnabled }: LoginFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const initialErrorMessage = searchParams?.get('error') === 'exchange_failed'
    ? '로그인을 완료하지 못했어요. 다시 한 번 시도해 주세요.'
    : null
  const [message, setMessage] = useState<string | null>(initialErrorMessage)
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [showPassword, setShowPassword] = useState(false)
  const isAdmin = variant === 'admin'
  const isKakaoEnabled = kakaoEnabled ?? Boolean(
    process.env.NEXT_PUBLIC_KAKAO_JS_KEY ||
    process.env.NEXT_PUBLIC_KAKAO_ENABLED === 'true',
  )

  useEffect(() => {
    if (searchParams?.get('error') === 'exchange_failed') {
      clearSupabaseAuthCookies()
    }
  }, [searchParams])

  const paramNext = searchParams?.get('next')
  const defaultResolvedNext = isAdmin
    ? (paramNext === '/auth/admin-setup' ? '/auth/admin-setup' : safeOperatorNextPath(paramNext ?? undefined))
    : safeAuthNextPath(paramNext ?? undefined)

  const next = explicitNext || defaultResolvedNext || (isAdmin ? '/admin' : '/app')

  function submit(formData: FormData) {
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    const nextFieldErrors: { email?: string; password?: string } = {}
    if (typeof email !== 'string' || email.trim().length === 0) nextFieldErrors.email = '이메일을 입력해 주세요.'
    if (typeof password !== 'string' || password.length === 0) nextFieldErrors.password = '비밀번호를 입력해 주세요.'
    setFieldErrors(nextFieldErrors)
    setMessage(null)
    if (Object.keys(nextFieldErrors).length > 0) return

    startTransition(async () => {
      try {
        const result = await signInAction({ email, password, next })
        if (result?.error) {
          setMessage(result.error.message || '이메일 또는 비밀번호를 확인해 주세요.')
          return
        }

        const nextUrl = result?.data?.next || next || (isAdmin ? '/admin' : '/app')
        router.push(nextUrl)
        router.refresh()
      } catch {
        setMessage('네트워크 연결을 확인한 뒤 다시 시도해 주세요. 입력한 내용은 그대로 유지됩니다.')
      }
    })
  }

  function handleKakaoServerLogin() {
    setMessage(null)
    const nextPath = encodeURIComponent(next || '/app')
    // 카카오 외부 OAuth 인가 페이지로의 리다이렉트를 위해 서버 라우트로 전체 브라우저 네비게이션 실행
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/api/auth/kakao/start?next=${nextPath}`)
  }

  function handleSocialLogin(provider: 'google' | 'kakao' | 'apple') {
    setMessage(null)
    startTransition(async () => {
      try {
        clearSupabaseAuthCookies()
        const supabase = createBrowserSupabaseClient()
        const origin = window.location.origin
        const callbackUrl = `${origin}/auth/callback?next=${encodeURIComponent(next || '/app')}`

        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: callbackUrl,
            queryParams: provider === 'google' ? {
              access_type: 'offline',
              prompt: 'consent',
            } : undefined,
          },
        })

        if (error) {
          setMessage(error.message || `${provider} 로그인에 실패했습니다. 다시 시도해 주세요.`)
        }
      } catch {
        setMessage('소셜 로그인 연결 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
      }
    })
  }

  return (
    <>
      <form
        action={submit}
        aria-label={isAdmin ? '관리자 로그인' : '고객사 로그인'}
        className={styles.form}
        data-next={next}
        noValidate
      >
        <div className={styles.field}>
          <label htmlFor="email">{isAdmin ? '관리자 이메일' : '이메일'}</label>
          <input
            className={styles.input}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            enterKeyHint="next"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            aria-invalid={fieldErrors.email ? true : undefined}
            placeholder="name@example.com"
            required
            onFocus={(e) => e.currentTarget.select()}
            onChange={() => setFieldErrors((current) => ({ ...current, email: undefined }))}
          />
          {fieldErrors.email ? <p className={styles.fieldError} id="email-error" role="alert" aria-live="polite">{fieldErrors.email}</p> : null}
        </div>
        <div className={styles.field}>
          <label htmlFor="password">{isAdmin ? '관리자 비밀번호' : '비밀번호'}</label>
          <div className={styles.passwordWrapper}>
            <input
              className={styles.input}
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              enterKeyHint="go"
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
              aria-invalid={fieldErrors.password ? true : undefined}
              placeholder="비밀번호를 입력해 주세요"
              required
              onFocus={(e) => e.currentTarget.select()}
              onChange={() => setFieldErrors((current) => ({ ...current, password: undefined }))}
            />
            <button
              type="button"
              className={styles.passwordToggle}
              aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((prev) => !prev)}
            >
              {showPassword ? (
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          {fieldErrors.password ? <p className={styles.fieldError} id="password-error" role="alert" aria-live="polite">{fieldErrors.password}</p> : null}
        </div>
        <button className={styles.primaryButton} type="submit" disabled={isPending}>
          {isPending
            ? isAdmin ? '관리자 권한 확인 중' : '작업공간 여는 중'
            : isAdmin ? '관리자 페이지로 로그인' : '이메일로 로그인'}
        </button>
      </form>

      <a className={styles.forgotLink} href="/forgot-password">
        비밀번호를 잊으셨나요?
      </a>

      {isAdmin ? null : (
        <section className={styles.providerSection} aria-label="소셜 로그인">
          <div className={styles.divider}>
            <span>또는 소셜 계정으로 시작</span>
          </div>

          <div className={styles.socialButtonsContainer}>
            {/* 구글 소셜 로그인 (필수) */}
            <button
              type="button"
              onClick={() => handleSocialLogin('google')}
              disabled={isPending}
              className={styles.googleButton}
              aria-label="Google 계정으로 시작"
            >
              {/* 버튼이 이미 이름(aria-label)을 주므로 로고는 장식이다. 접근성 트리에 이름 없는 image 로 새지 않게 한다. */}
              <svg
                className={styles.socialIcon}
                viewBox="0 0 24 24"
                width="20"
                height="20"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Google로 계속하기</span>
            </button>

            {/* 카카오 소셜 로그인 (선택형: 환경변수 설정 시에만 활성화) */}
            {isKakaoEnabled ? (
              <button
                type="button"
                onClick={handleKakaoServerLogin}
                disabled={isPending}
                className={styles.kakaoButton}
                aria-label="카카오톡 계정으로 시작"
              >
                <svg
                  className={styles.socialIcon}
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="#000000"
                    d="M12 3c-5.52 0-10 3.58-10 8 0 2.83 1.86 5.32 4.67 6.7-.2.74-.74 2.69-.85 3.12-.13.53.19.52.4.38.16-.11 2.58-1.75 3.63-2.47.57.08 1.15.13 1.75.13 5.52 0 10-3.58 10-8s-4.48-8-10-8z"
                  />
                </svg>
                <span>카카오로 계속하기</span>
              </button>
            ) : null}
          </div>

          <div className={styles.trialBadgeBanner}>
            <span className={styles.trialSparkle}>🎁</span>
            <span className={styles.trialText}>
              첫 가입 선물: Instagram·Threads 중 1곳 이상 연결하면 첫 포스팅 무료 체험 혜택
            </span>
          </div>
        </section>
      )}

      {message ? (
        <p className={styles.message} role="alert" aria-live="assertive">
          {message}
        </p>
      ) : null}
    </>
  )
}
