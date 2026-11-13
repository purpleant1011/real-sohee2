'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { R2EvidenceRecordList } from '@/features/mobile-results/r2-evidence-record-list'
import { resultsPeriodSearch, type ResultsPeriod } from '@/features/mobile-results/results-period'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { useWorkspaceId } from '@/hooks/use-workspace-context'

/**
 * M20 근거 기록 목록 진입점(ANI-1783 2단계).
 *
 * 플래그 OFF(기본)·넓은 화면에서는 이 목록의 PC 대응 화면이 없으므로 드릴다운으로 돌려보낸다.
 * 같은 내용을 두 UI 로 동시에 그리지 않는다.
 */
export function EvidenceRecordListEntry({
  metricId,
  period,
}: {
  metricId: string
  /** 드릴다운에서 보던 기간. 없으면 이번 주. */
  period?: ResultsPeriod
}) {
  const workspaceId = useWorkspaceId()
  const active = useMobileR2Active()
  const router = useRouter()

  useEffect(() => {
    if (!active) router.replace(`/app/results/${encodeURIComponent(metricId)}${resultsPeriodSearch(period ?? 'current')}`)
  }, [active, router, metricId, period])

  if (!active) return null
  return <R2EvidenceRecordList workspaceId={workspaceId} metricId={metricId} period={period} />
}
