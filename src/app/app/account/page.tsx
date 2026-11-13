import { redirect } from 'next/navigation'
import { AccountDashboard } from '@/features/account/account-dashboard'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { getReadinessSnapshot } from '@/features/reports/repository'
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag'
import { getOperationalSettings } from '@/features/settings/repository'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createProfileImageGateway, getProfileImageUrl } from '@/features/account/profile-image-repository'
import { AccountEntry } from './account-entry'

/**
 * 계정·설정 — `/app/account`.
 *
 * 플래그 OFF(기본)·allowlist 밖 매장은 기존 계정 화면 그대로이고, 설정 조회도 하지 않는다.
 * 플래그 ON 이면 좁은 화면에서만 R2 가게 정보 화면을 마운트하며(넓은 화면은 진입점이 되돌린다),
 * 그 값은 세션 workspace 로 읽은 서버 정본이다. 저장은 기존 명령 계약(`saveSettingsAction`)만 쓴다.
 */
export default async function AccountPage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')

  const supabase = await createServerSupabaseClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  const userId = typeof claimsData?.claims?.sub === 'string' ? claimsData.claims.sub : null
  const [result, avatarUrl] = await Promise.all([
    getReadinessSnapshot(workspace.workspaceId, workspace.role),
    userId ? getProfileImageUrl(userId, createProfileImageGateway(supabase)) : Promise.resolve(null),
  ])
  if (result.error) {
    return (
      <section aria-live="assertive" role="alert">
        <h1>준비 상태를 열지 못했어요</h1>
        <p>{result.error.message}</p>
      </section>
    )
  }

  const legacy = <AccountDashboard avatarUrl={avatarUrl} snapshot={result.data} />
  const enabled = resolveMobileR2Enabled(
    process.env.MOBILE_R2_UI_ENABLED,
    process.env.MOBILE_R2_UI_WORKSPACE_ALLOWLIST,
    workspace.workspaceId,
  )
  if (!enabled) return legacy

  // R2 화면용 서버 정본. 읽지 못하면 빈 값이 아니라 오류로 내려보낸다(fail-closed).
  const settings = await getOperationalSettings(workspace.workspaceId, workspace.role)
  return (
    <AccountEntry
      settings={settings.error
        ? { ok: false }
        : { ok: true, business: settings.data.business, canEdit: settings.data.permissions.canEditProfiles }}
      legacy={legacy}
    />
  )
}
