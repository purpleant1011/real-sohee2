import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag'
import { CustomerDetailEntry } from './customer-detail-entry'

// 고객 개인정보를 다루는 화면이다. 서버 렌더 결과·라우트 응답을 캐시에 남기지 않는다.
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * M17b 고객 상세 — `/app/customers/:id` (ANI-1664 proposed 경로 신설).
 *
 * 이 경로에는 페이지가 없었다. 플래그 OFF(기본)·allowlist 밖 매장은 **기존 고객 목록으로 이동**한다
 * (새 화면 없음, 새 쓰기 없음). 플래그 ON 이면 좁은 화면에서만 R2 상세를 마운트하고,
 * 넓은 화면은 진입점이 같은 목록으로 되돌린다.
 *
 * 읽기 전용이다. 고객 정보 수정·연락 전송·캠페인 발송 경로를 만들지 않는다.
 */
export default async function CustomerDetailPage({
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
  if (!enabled) redirect('/app/customers')

  return (
    <Suspense fallback={<p role="status" className="p-6">고객 정보를 불러오고 있어요.</p>}>
      <CustomerDetailEntry customerId={id} workspaceId={workspace.workspaceId} />
    </Suspense>
  )
}
