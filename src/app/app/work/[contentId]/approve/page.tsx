import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { getApprovalPreview } from '@/features/approvals/approval-preview-repository'
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag'
import { WorkApproveEntry } from './approve-entry'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * M07 게시 전 최종 확인 — `/app/work/:id/approve` (ANI-1664 proposed 경로 신설).
 *
 * 오늘 이 경로는 404 였고, 승인은 `/app/work/:id` 의 승인 패널에서만 할 수 있었다.
 * 그래서 플래그 OFF(기본)·allowlist 밖 매장은 **기존 상세 화면으로 돌려보낸다**(새 동작 없음).
 * 플래그 ON 이면 좁은 화면에서만 R2 승인 화면을 마운트한다.
 *
 * 승인 판정은 서버 스냅샷(`getApprovalPreview`)만 근거로 한다. 화면이 지문을 만들지 않는다.
 */
export default async function WorkApprovePage({
  params,
}: Readonly<{ params: Promise<{ contentId: string }> }>) {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')

  const { contentId } = await params
  const legacyPath = `/app/work/${encodeURIComponent(contentId)}`

  const enabled = resolveMobileR2Enabled(
    process.env.MOBILE_R2_UI_ENABLED,
    process.env.MOBILE_R2_UI_WORKSPACE_ALLOWLIST,
    workspace.workspaceId,
  )
  // 플래그가 꺼져 있으면 오늘의 승인 화면(작업 상세) 그대로다. 조회도 하지 않는다.
  if (!enabled) redirect(legacyPath)

  const preview = await getApprovalPreview(workspace.workspaceId, contentId)

  return (
    <WorkApproveEntry
      workspaceId={workspace.workspaceId}
      contentId={contentId}
      role={workspace.role}
      // 조회 실패를 '승인할 것 없음'으로 바꾸지 않는다(fail-closed).
      snapshot={preview.error ? null : preview.data}
    />
  )
}
