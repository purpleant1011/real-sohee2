'use client'

import dynamic from 'next/dynamic'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2Results } from '@/features/mobile-results/r2-results'
import type { ResultsPeriod, ResultsRange } from '@/features/mobile-results/results-period'
import { useWorkspaceId } from '@/hooks/use-workspace-context'

const LegacyResultsView = dynamic(
  () => import('./results-view'),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6 animate-pulse p-6">
        <div className="h-8 w-64 bg-zinc-200 dark:bg-zinc-800 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="h-48 bg-zinc-100 dark:bg-zinc-900 rounded-3xl" />
          <div className="h-48 bg-zinc-100 dark:bg-zinc-900 rounded-3xl" />
        </div>
      </div>
    ),
  }
)

/** 플래그 OFF(기본)·넓은 화면은 기존 화면 그대로(ANI-1771). */
export function ResultsEntry({
  initialPeriod,
  initialRange,
}: { initialPeriod?: ResultsPeriod; initialRange?: ResultsRange | null } = {}) {
  const workspaceId = useWorkspaceId()
  if (useMobileR2Active()) {
    return <R2Results workspaceId={workspaceId} initialPeriod={initialPeriod} initialRange={initialRange} />
  }
  // PC 화면은 기간을 고를 수 없다. 주소에 직접 고른 구간이 남아 있는데 이번 주 기록을 그대로
  // 그리면 주소와 숫자가 어긋나 보이므로, 무엇을 보여주고 있는지 한 줄로 밝힌다(ANI-1782 AC-7).
  // 구간 파라미터는 모바일에서만 생기므로 평소 PC 화면은 이 문구 없이 지금과 같다.
  return (
    <>
      {initialRange ? (
        <p role="status" className="px-6 pt-6 text-sm leading-relaxed text-muted-foreground">
          직접 고른 기간은 모바일에서 볼 수 있어요. 여기서는 이번 주 기록을 보여드리고 있어요.
        </p>
      ) : null}
      <LegacyResultsView />
    </>
  )
}
