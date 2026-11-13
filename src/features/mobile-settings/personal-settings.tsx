'use client'

import { useState, useEffect, useTransition, type FormEvent } from 'react'
import { AppLink as Link } from '@/components/navigation/app-link'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { ProfileImageCard } from '@/features/account/profile-image-card'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { savePersonalProfileAction } from './actions/save-personal-profile'
import { Lock, ShieldCheck, Mail, UserRound, AlertCircle } from 'lucide-react'

export interface PersonalSettingsProps {
  initialAvatarUrl?: string | null
  initialDisplayName?: string | null
  profileLoadError?: boolean
  previewUser?: {
    email?: string | null
    createdAt?: string | null
    provider?: string | null
    hasPasswordAuth?: boolean
  } | null
  isDemo?: boolean
}

interface AccountInfo {
  email: string | null
  createdAt: string | null
  provider: string | null
  hasPasswordAuth: boolean
}

const FIELD = 'min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2 text-base text-foreground disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/20'
const BUTTON_PRIMARY = 'min-h-11 w-full sm:w-auto inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-base font-medium text-primary-foreground disabled:opacity-60 transition-colors'
const BUTTON_SECONDARY = 'min-h-11 inline-flex items-center justify-center rounded-xl border border-border bg-background px-4 py-2 text-base font-medium text-foreground hover:bg-muted/50 transition-colors'

function resolveProviderLabel(provider: string | null): string {
  if (!provider) return '이메일 계정'
  switch (provider.toLowerCase()) {
    case 'kakao':
      return '카카오'
    case 'google':
      return '구글'
    case 'apple':
      return '애플'
    case 'naver':
      return '네이버'
    case 'email':
      return '이메일 계정'
    default:
      return provider
  }
}

export function PersonalSettings({
  initialAvatarUrl = null,
  initialDisplayName = null,
  profileLoadError = false,
  previewUser = null,
  isDemo = false,
}: PersonalSettingsProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [savePending, startTransition] = useTransition()
  const [saveMessage, setSaveMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(() => {
    if (isDemo && previewUser) {
      return {
        email: previewUser.email ?? 'demo@example.com',
        createdAt: previewUser.createdAt ?? '2026-01-01T00:00:00Z',
        provider: previewUser.provider ?? 'email',
        hasPasswordAuth: previewUser.hasPasswordAuth ?? (previewUser.provider === 'email'),
      }
    }
    return null
  })
  const [loadingAccount, setLoadingAccount] = useState(!isDemo)

  useEffect(() => {
    if (isDemo) return

    let cancelled = false
    const supabase = createBrowserSupabaseClient()
    supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return
      if (!error && data?.user) {
        const u = data.user
        const providers = (u.app_metadata?.providers as string[] | undefined) ?? []
        const identities = u.identities ?? []
        const hasEmail = Boolean(
          identities.some(id => id.provider === 'email') ||
          providers.includes('email') ||
          u.app_metadata?.provider === 'email'
        )
        const primaryProvider = (u.app_metadata?.provider as string) ?? (providers[0] || 'email')

        setAccountInfo({
          email: u.email ?? null,
          createdAt: u.created_at ?? null,
          provider: primaryProvider,
          hasPasswordAuth: hasEmail,
        })
      }
      setLoadingAccount(false)
    }).catch(() => {
      if (!cancelled) setLoadingAccount(false)
    })

    return () => {
      cancelled = true
    }
  }, [isDemo])

  function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaveMessage(null)

    if (profileLoadError) {
      setSaveMessage({ tone: 'error', text: '프로필 정보를 먼저 정상적으로 불러와야 저장할 수 있어요.' })
      return
    }

    if (isDemo) {
      setSaveMessage({ tone: 'ok', text: '데모 모드: 실제 계정에는 저장하지 않았어요' })
      return
    }

    startTransition(async () => {
      try {
        const result = await savePersonalProfileAction({ displayName })
        if (result.ok) {
          setSaveMessage({ tone: 'ok', text: result.message })
        } else {
          setSaveMessage({ tone: 'error', text: result.message })
        }
      } catch {
        setSaveMessage({ tone: 'error', text: '프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' })
      }
    })
  }

  function formatJoinDate(isoString: string | null): string {
    if (!isoString) return '-'
    try {
      const d = new Date(isoString)
      return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
    } catch {
      return '-'
    }
  }

  const providerLabel = resolveProviderLabel(accountInfo?.provider ?? null)

  return (
    <MobileAppShell>
      <ShellScreen mode="DETAIL" title="개인정보 관리">
        <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pt-2 pb-16">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">개인정보 관리</h1>
            <p className="text-base leading-relaxed text-muted-foreground">
              내 프로필과 로그인 계정 정보를 확인하고 관리해요.
            </p>
          </header>

          {profileLoadError ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-2xl border border-state-danger/30 bg-state-danger-soft p-4 text-sm text-state-danger"
            >
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold">프로필 정보를 불러오지 못했어요</p>
                <p className="text-xs leading-relaxed opacity-90">
                  네트워크 확인 후 잠시 후 다시 열어 주세요. 기존 저장된 정보 보호를 위해 편집이 비활성화되었어요.
                </p>
              </div>
            </div>
          ) : null}

          {/* 내 프로필 사진 (실환경은 ProfileImageCard 재사용, 데모는 안전한 읽기 전용) */}
          {isDemo ? (
            <section aria-labelledby="profile-image-demo-heading" className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1">
                  <h2 id="profile-image-demo-heading" className="text-lg font-semibold text-foreground">
                    내 프로필 사진
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    등록한 사진은 내 메시지와 계정 메뉴에 표시돼요.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="grid h-16 w-16 place-items-center rounded-full border-2 border-primary/20 bg-primary/10 text-primary">
                    <UserRound className="h-7 w-7" aria-hidden="true" />
                  </div>
                  <span className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    데모 미리보기 (업로드 비활성)
                  </span>
                </div>
              </div>
            </section>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-4">
              <ProfileImageCard avatarUrl={initialAvatarUrl} />
            </div>
          )}

          {/* 표시 이름 변경 */}
          <section aria-labelledby="display-name-heading" className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="space-y-1">
              <h2 id="display-name-heading" className="text-lg font-semibold text-foreground">
                프로필 정보
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                소희와 대화할 때 사용할 이름이에요. 언제든 직접 바꿀 수 있어요.
              </p>
            </div>
            <form className="space-y-4" onSubmit={handleSaveProfile}>
              <div className="space-y-1.5">
                <label htmlFor="display-name-input" className="block text-sm font-medium text-foreground">
                  표시 이름
                </label>
                <input
                  id="display-name-input"
                  className={FIELD}
                  disabled={savePending || profileLoadError}
                  maxLength={80}
                  name="displayName"
                  placeholder="표시할 이름을 입력해 주세요"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <span className="block text-xs text-muted-foreground">
                  1자 이상 80자 이하로 입력해 주세요.
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  className={BUTTON_PRIMARY}
                  disabled={savePending || profileLoadError}
                  type="submit"
                >
                  {savePending ? '저장 중...' : '이름 저장'}
                </button>
              </div>

              {saveMessage ? (
                <p
                  role={saveMessage.tone === 'ok' ? 'status' : 'alert'}
                  className={
                    saveMessage.tone === 'ok'
                      ? 'rounded-xl bg-state-ok-soft px-3.5 py-3 text-sm text-state-ok'
                      : 'rounded-xl bg-state-danger-soft px-3.5 py-3 text-sm text-state-danger'
                  }
                >
                  {saveMessage.text}
                </p>
              ) : null}
            </form>
          </section>

          {/* 로그인 계정 정보 */}
          <section aria-labelledby="account-info-heading" className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <h2 id="account-info-heading" className="text-lg font-semibold text-foreground">
                로그인 계정
              </h2>
            </div>

            {loadingAccount ? (
              <div className="space-y-2 py-2" aria-busy="true">
                <div className="h-4 w-48 rounded bg-muted/60 animate-pulse" />
                <div className="h-4 w-32 rounded bg-muted/60 animate-pulse" />
              </div>
            ) : accountInfo ? (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                  <dt className="text-xs font-medium text-muted-foreground">로그인 이메일</dt>
                  <dd className="mt-1 font-semibold text-foreground break-all">{accountInfo.email ?? '-'}</dd>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                  <dt className="text-xs font-medium text-muted-foreground">로그인 방식</dt>
                  <dd className="mt-1 font-semibold text-foreground">{providerLabel}</dd>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-3 sm:col-span-2">
                  <dt className="text-xs font-medium text-muted-foreground">가입일</dt>
                  <dd className="mt-1 font-medium text-foreground">{formatJoinDate(accountInfo.createdAt)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">계정 정보를 불러오지 못했어요.</p>
            )}

            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                로그인 이메일은 계정 고유 식별자여서 직접 변경할 수 없어요. 이메일 변경이 꼭 필요하시면 고객센터(support@example.com)로 문의해 주세요.
              </p>
              <div>
                <a
                  href="mailto:support@example.com?subject=%EB%A1%9C%EA%B7%B8%EC%9D%B8%20%EC%9D%B4%EB%A9%94%EC%9D%BC%20%EB%B3%80%EA%B2%BD%20%EB%AC%B8%EC%9D%98"
                  className={BUTTON_SECONDARY}
                >
                  이메일 변경 문의하기
                </a>
              </div>
            </div>
          </section>

          {/* 비밀번호 관리 (소셜 단독 계정 vs 이메일/비밀번호 분기, 미확인/로딩 시 fail-closed) */}
          <section aria-labelledby="password-heading" className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <h2 id="password-heading" className="text-lg font-semibold text-foreground">
                비밀번호
              </h2>
            </div>

            {loadingAccount ? (
              <div className="space-y-2 py-1" aria-busy="true">
                <div className="h-4 w-48 rounded bg-muted/60 animate-pulse" />
              </div>
            ) : accountInfo === null ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                계정 로그인 방식을 확인하지 못해 비밀번호 변경을 안내할 수 없어요. 잠시 후 다시 시도해 주세요.
              </p>
            ) : !accountInfo.hasPasswordAuth ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                현재 소셜 로그인 계정({providerLabel})으로 이용 중이에요. 비밀번호는 해당 소셜 계정 제공자({providerLabel})의 설정에서 관리하실 수 있어요.
              </p>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  등록된 이메일로 비밀번호 재설정 링크를 받으실 수 있어요. 안내 페이지에서 이메일을 확인해 주세요.
                </p>
                <div>
                  <Link
                    href="/forgot-password"
                    className={BUTTON_SECONDARY}
                  >
                    비밀번호 변경 안내 받기
                  </Link>
                </div>
              </>
            )}
          </section>

          {/* 개인정보 처리방침 */}
          <section aria-labelledby="privacy-policy-heading" className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <h2 id="privacy-policy-heading" className="text-lg font-semibold text-foreground">
                개인정보 처리방침
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              소희가 사장님의 정보를 어떻게 안전하게 다루는지 확인할 수 있어요.
            </p>
            <div>
              <Link
                href="/privacy"
                className={BUTTON_SECONDARY}
              >
                개인정보 처리방침 보기
              </Link>
            </div>
          </section>

          {/* 회원 탈퇴 (마지막 구분 영역 - 차분한 중립 표면과 실제 support mailto 문의) */}
          <section
            aria-labelledby="withdrawal-heading"
            className="border-t border-border pt-8 mt-10 space-y-4"
          >
            <div className="rounded-2xl border border-border/70 bg-card p-5 space-y-3">
              <h2 id="withdrawal-heading" className="text-base font-semibold text-foreground">
                회원 탈퇴 안내
              </h2>
              <div className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">
                <p>
                  탈퇴는 고객센터에서 본인 확인 후 안내해 드려요. 문의만으로 바로 탈퇴되지는 않아요.
                </p>
                <p>
                  가게 소유자 권한이나 관련 법령에 따른 거래·정산 기록 보관 여부를 먼저 확인한 뒤 안전하게 처리를 도와드립니다.
                </p>
              </div>
              <div className="pt-2 space-y-1.5">
                <a
                  href="mailto:support@example.com?subject=%ED%9A%8C%EC%9B%90%20%ED%83%88%ED%87%B4%20%EB%AC%B8%EC%9D%98"
                  className="min-h-11 inline-flex items-center justify-center rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  회원 탈퇴 문의하기
                </a>
                <p className="text-xs text-muted-foreground">
                  버튼을 누르면 고객센터(support@example.com) 메일 작성 화면이 열리며, 바로 전송되거나 즉시 탈퇴 처리되지 않아요.
                </p>
              </div>
            </div>
          </section>
        </div>
      </ShellScreen>
    </MobileAppShell>
  )
}
