import { notFound, redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag'
import { OfflineEntry } from './offline-entry'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * M26 연결 상태 안내 — `/app/offline` (ANI-1664 proposed 경로 신설).
 *
 * 플래그 OFF(기본)·allowlist 밖 매장은 오늘과 같이 404 다. 새 화면을 몰래 열지 않는다.
 * 플래그 ON 인 매장에만 안내를 보여준다.
 */
export default async function OfflinePage() {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')

  const enabled = resolveMobileR2Enabled(
    process.env.MOBILE_R2_UI_ENABLED,
    process.env.MOBILE_R2_UI_WORKSPACE_ALLOWLIST,
    workspace.workspaceId,
  )
  if (!enabled) notFound()

  return <OfflineEntry />
}
