import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag'
import { OutcomeDetailEntry } from './outcome-detail-entry'

// 저장된 게시 결과는 매장마다 다르다. 라우트 응답을 캐시에 남기지 않는다.
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * M08 첫 게시 결과 상세 — `/app/outcome/:id` (ANI-1681, proposed → existing).
 *
 * 이 경로에는 페이지가 없었다. 플래그 OFF(기본)·allowlist 밖 매장은 **작업함으로 이동**한다
 * (새 화면 없음, 새 쓰기 없음). 플래그 ON 이면 좁은 화면에서만 R2 결과 상세를 마운트하고,
 * 넓은 화면은 진입점이 같은 작업함으로 되돌린다.
 *
 * 읽기 전용이다. 저장된 마지막 실행 결과를 다시 보여 줄 뿐, 게시를 실행하거나 결과를 만들지 않는다.
 */
export default async function OutcomeDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')

  const { id } = await params
  const enabled = resolveMobileR2Enabled(
    process.env.MOBILE_R2_UI_ENABLED,
    process.env.MOBILE_R2_UI_WORKSPACE_ALLOWLIST,
    workspace.workspaceId,
  )
  // 플래그가 꺼져 있으면 오늘의 화면(작업함) 그대로다. 조회도 하지 않는다.
  if (!enabled) redirect('/app/content')

  return <OutcomeDetailEntry missionId={id} workspaceId={workspace.workspaceId} />
}
