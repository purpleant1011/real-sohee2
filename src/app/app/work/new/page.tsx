import { redirect } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag'
import { FirstPostNewEntry } from './first-post-new-entry'
import { shouldOpenFirstPostRoute, WORK_NEW_FALLBACK_ROUTE } from './first-post-route-flag'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * M06 첫 포스팅 — `/app/work/new` (ANI-1767 실라우트 배선).
 *
 * 오늘 이 경로는 `/app` 로 보내는 빈 리다이렉트였다(`git show 이전 page.tsx`). 그래서 첫 포스팅
 * 3단계(미리보기 → 최종 확인 → 결과)는 `/start/preview-r2` 프리뷰에서만 열렸고, `/app` 실라우트에는
 * 없었다. 이제 R2 플래그 ON + allowlist 매장에서만 이 경로가 흐름을 연다.
 *
 * 플래그 OFF·allowlist 밖 매장이나 PC 환경은 실제 글쓰기 시작 화면(`WORK_NEW_FALLBACK_ROUTE`)으로
 * 연결해 사장님이 '글 만들기' 진입 시 멈추거나 헤매지 않도록 한다.
 * 흐름 자체(PREVIEW/APPROVAL/RESULT)는 `src/features/mobile-firstpost` 소유다 — 이 파일은 마운트만 한다.
 */
export default async function NewWorkPage({ searchParams }: { searchParams?: Promise<{ post?: string | string[] }> } = {}) {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')

  const r2Enabled = resolveMobileR2Enabled(
    process.env.MOBILE_R2_UI_ENABLED,
    process.env.MOBILE_R2_UI_WORKSPACE_ALLOWLIST,
    workspace.workspaceId,
  )
  // 화면이 읽는 것과 같은 환경변수다. 클라이언트 모듈의 함수를 서버에서 부르지 않으려고 문자열로 비교한다.
  if (!shouldOpenFirstPostRoute(r2Enabled, process.env.NEXT_PUBLIC_MOBILE_R2_FIRSTPOST)) {
    redirect(WORK_NEW_FALLBACK_ROUTE)
  }

  const query = await searchParams
  const restoreMissionId = typeof query?.post === 'string' ? query.post : undefined
  return <FirstPostNewEntry workspaceId={workspace.workspaceId} restoreMissionId={restoreMissionId} />
}
