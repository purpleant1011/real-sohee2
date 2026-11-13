import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag'
import { ApprovalDetailEntry } from './approval-detail-entry'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * M19 승인 확인 상세 — `/app/approvals/:id` (ANI-1664 proposed 경로 신설).
 *
 * 오늘 이 경로는 페이지가 없어 404 였고, 상세는 `/app/approvals?item=` 쿼리로만 열렸다.
 * 그래서 플래그 OFF(기본)·allowlist 밖 매장은 **기존 상세 URL 로 이동**한다(새 동작 없음).
 * 플래그 ON 이면 좁은 화면에서만 R2 상세를 마운트하고, 넓은 화면은 같은 기존 URL 로 되돌린다.
 *
 * 읽기 전용이다. 실행(게시·답장·예약) 경로를 만들지 않는다.
 */
export default async function ApprovalDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')

  const enabled = resolveMobileR2Enabled(
    process.env.MOBILE_R2_UI_ENABLED,
    process.env.MOBILE_R2_UI_WORKSPACE_ALLOWLIST,
    workspace.workspaceId,
  )
  // 기존 상세는 쿼리 경로로 열린다. 플래그가 꺼져 있으면 그 화면 그대로다.
  if (!enabled) redirect(`/app/approvals?item=${encodeURIComponent(id)}`)

  return (
    <Suspense fallback={<p role="status" className="p-6">확인할 작업을 불러오고 있어요.</p>}>
      <ApprovalDetailEntry item={id} workspaceId={workspace.workspaceId} />
    </Suspense>
  )
}
