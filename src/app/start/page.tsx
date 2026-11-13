import { Suspense } from 'react'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { resolveOAuthReturnNotice } from '@/features/auth/oauth-return'
import { OAuthReturnBanner } from '@/features/auth/oauth-return-notice'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag'
import OnboardingEntry from './onboarding-entry'

type StartPageProps = {
  /** ANI-1761 AC-3: 콜백이 구글 로그인 성공 복귀에 붙이는 표시 */
  searchParams?: Promise<{ connected?: string }>
}

/**
 * ANI-1781 (M03): `/start` 를 R2 플래그 뒤로 옮긴다.
 * 플래그는 서버가 계산한다(기본 OFF). OFF·넓은 화면은 지금과 같은 StartWizard 이고,
 * ON + 좁은 화면에서만 가게 정보 입력·사진 선택이 있는 R2 화면이 보인다.
 * 전체 공개(all)에서는 매장 없는 신규 방문자도 모바일 R2 화면을 쓴다. 저장 API의 인증은 별도 유지한다.
 */
export default async function StartPage({ searchParams }: StartPageProps = {}) {
  const params = searchParams ? await searchParams : {}
  const notice = params.connected
    ? resolveOAuthReturnNotice({
        oauth: 'connected',
        next: '/start',
        provider: params.connected === 'kakao' ? 'kakao' : 'google',
      })
    : null

  const workspace = await getCurrentWorkspaceContext()
  const mobileR2 = process.env.MOBILE_R2_UI_ENABLED === 'all' || (workspace
    ? resolveMobileR2Enabled(
        process.env.MOBILE_R2_UI_ENABLED,
        process.env.MOBILE_R2_UI_WORKSPACE_ALLOWLIST,
        workspace.workspaceId,
      )
    : false)

  return (
    <MobileR2Provider enabled={mobileR2}>
      {notice ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-4">
          <OAuthReturnBanner notice={notice} />
        </div>
      ) : null}
      <Suspense fallback={null}>
        <OnboardingEntry />
      </Suspense>
    </MobileR2Provider>
  )
}
