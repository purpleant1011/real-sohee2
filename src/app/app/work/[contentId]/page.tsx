import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { getContentDetail } from '@/features/content/repository'
import { WorkDetail } from '@/features/content/work-detail'
import { getSocialPerformanceReport } from '@/features/reports/repository'
import { getApprovalPreview } from '@/features/approvals/approval-preview-repository'
import { resolveMobileR2Enabled } from '@/features/mobile-shell/r2-flag'
import { getLatestPublishedDestinationUrl } from '@/features/publishing/latest-destination'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { WorkPreviewEntry } from './work-preview-entry'
import { WorkStudioEntry } from './work-studio-entry'
import { loadWorkStudioContext } from '@/features/mobile-work/work-studio-data'
import { isConversationWorkbenchEnabled } from '@/features/chat/conversation-rollout'

export default async function WorkDetailPage({
  params,
}: Readonly<{ params: Promise<{ contentId: string }> }>) {
  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) redirect('/app/onboarding')

  const { contentId } = await params
  const periodEnd = new Date()
  const periodStart = new Date(periodEnd)
  periodStart.setUTCDate(periodStart.getUTCDate() - 30)
  const [result, socialResult, previewResult] = await Promise.all([
    getContentDetail(workspace.workspaceId, contentId),
    getSocialPerformanceReport(workspace.workspaceId, {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      contentId,
    }),
    getApprovalPreview(workspace.workspaceId, contentId),
  ])

  if (result.error) {
    if (result.error.requestId === 'content-not-found') notFound()
    return (
      <V088AppShell workspaceId={workspace.workspaceId}>
        <section role="alert" className="mx-auto flex max-w-xl flex-col gap-4 p-6">
          <h1 className="text-xl font-semibold">작업을 불러오지 못했어요</h1>
          <p>저장된 원고가 없다는 뜻은 아니에요. 잠시 후 다시 확인해 주세요.</p>
          <Link href={`/app/work/${encodeURIComponent(contentId)}`} className="inline-flex min-h-11 items-center text-primary">다시 확인하기</Link>
          <Link href="/app/content" className="inline-flex min-h-11 items-center text-primary">작업 목록으로 돌아가기</Link>
        </section>
      </V088AppShell>
    )
  }

  const existingPermalink = socialResult.data?.posts.find(
    (post) => typeof post.destinationUrl === 'string' && post.destinationUrl.startsWith('https://'),
  )?.destinationUrl ?? null

  const fallbackPermalink = existingPermalink
    ? null
    : await getLatestPublishedDestinationUrl(workspace.workspaceId, contentId)
  const resolvedPermalink = existingPermalink ?? fallbackPermalink

  /**
   * 오늘의 작업 상세(M06 이전 화면). 플래그 OFF 면 이 엘리먼트가 그대로 출력된다(동일성).
   * 플래그 ON 이면 좁은 화면에서만 R2 홍보 세트가 이 엘리먼트를 대신 그리고, 넓은 화면·미지원
   * 채널에서는 children 으로 되돌아온다.
   */
  const legacy = <WorkDetail
    detail={result.data}
    conversationWorkbenchEnabled={isConversationWorkbenchEnabled(workspace.workspaceId)}
    workspaceId={workspace.workspaceId}
    role={workspace.role}
    socialReport={socialResult.data}
    preview={previewResult.data}
    fallbackPermalink={resolvedPermalink}
  />

  const r2Enabled = resolveMobileR2Enabled(
    process.env.MOBILE_R2_UI_ENABLED,
    process.env.MOBILE_R2_UI_WORKSPACE_ALLOWLIST,
    workspace.workspaceId,
  )
  if (!r2Enabled) {
    return <V088AppShell workspaceId={workspace.workspaceId}>{legacy}</V088AppShell>
  }

  // 모바일 표현: 작업 스튜디오(채널 미리보기·수정 이력·대화). 승인 전 점검 스냅샷 화면은 승인 경로(M07)가 맡는다.
  const studioContext = await loadWorkStudioContext(workspace.workspaceId, contentId)
  return (
    <V088AppShell workspaceId={workspace.workspaceId}>
      <WorkStudioEntry
        workspaceId={workspace.workspaceId}
        detail={result.data}
        context={studioContext}
        conversationEnabled={isConversationWorkbenchEnabled(workspace.workspaceId)}
      >
        <WorkPreviewEntry snapshot={previewResult.error ? null : previewResult.data}>
          {legacy}
        </WorkPreviewEntry>
      </WorkStudioEntry>
    </V088AppShell>
  )
}
