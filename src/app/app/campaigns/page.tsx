import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag'
import { CampaignsEntry } from './campaigns-entry'
import { LEGACY_CAMPAIGNS_PATH } from './legacy-path'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CampaignsPage() {
  // 플래그 OFF(기본)·allowlist 밖 매장은 기존 이동 그대로. 새 API 호출 없음.
  const workspace = await getCurrentWorkspaceContext()
  const enabled = workspace
    ? resolveMobileR2Enabled(process.env.MOBILE_R2_UI_ENABLED, process.env.MOBILE_R2_UI_WORKSPACE_ALLOWLIST, workspace.workspaceId)
    : false
  if (!workspace || !enabled) {
    redirect(LEGACY_CAMPAIGNS_PATH)
    return null
  }
  return <CampaignsEntry workspaceId={workspace.workspaceId} />
}
