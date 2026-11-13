import { AppLink as Link } from '@/components/navigation/app-link'
import { Button } from '@/components/ui/button'
import { StateView } from '@/components/mobile-ui/state-view'
import { isEvidenceListR2Enabled } from '@/features/mobile-results/evidence-list-flag'
import { isResultsPeriod } from '@/features/mobile-results/results-period'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { EvidenceRecordListEntry } from './evidence-record-list-entry'

/**
 * M20 근거 기록 목록(`/app/results/:id/evidence`, ANI-1783 2단계).
 *
 * 플래그(`NEXT_PUBLIC_MOBILE_R2_EVIDENCE_LIST=on`)가 꺼져 있으면 "아직 준비 중이에요" StateView 로 안내하고
 * 성과 화면으로 돌아가는 버튼을 제공한다.
 * 데스크톱 화면에서 셸이 날아가지 않도록 V088AppShell 내부에서 렌더링한다.
 * `:id` 는 지표 키이며, `?period=previous` 는 드릴다운에서 보던 기간이다.
 */
export default async function EvidenceRecordListRoute({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>
  searchParams: Promise<{ period?: string }>
}>) {
  if (!isEvidenceListR2Enabled()) {
    const [{ id }, workspace] = await Promise.all([params, getCurrentWorkspaceContext()])
    const content = (
      <main className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center p-4">
        <StateView
          kind="confirmed_empty"
          title="아직 준비 중이에요"
          description="성과 근거 기록 화면을 준비하고 있어요."
          action={
            <Button asChild variant="outline">
              <Link href={`/app/results/${encodeURIComponent(id)}`}>성과 화면으로 돌아가기</Link>
            </Button>
          }
        />
      </main>
    )

    if (workspace?.workspaceId) {
      return <V088AppShell workspaceId={workspace.workspaceId}>{content}</V088AppShell>
    }
    return content
  }
  const [{ id }, query] = await Promise.all([params, searchParams])
  return <EvidenceRecordListEntry metricId={id} period={isResultsPeriod(query.period) ? query.period : undefined} />
}
