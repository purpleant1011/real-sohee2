'use client'

import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'
import { R2ResultsDrilldown } from '@/features/mobile-results/r2-results-drilldown'
import type { ResultsPeriod, ResultsRange } from '@/features/mobile-results/results-period'
import { useWorkspaceId } from '@/hooks/use-workspace-context'
import ResultsView from '../results-view'

/**
 * M20 근거 드릴다운 진입점(ANI-1706).
 *
 * 좁은 화면 + 플래그 ON 에서는 R2 상세를 마운트한다.
 * 넓은 화면(PC)에서는 같은 MasterDetail 화면에서 해당 지표 상세 패널이 선택된 상태로 연다.
 */
export function ResultsDetailEntry({
  metricId,
  period,
  range,
}: {
  metricId: string
  /** 성과 화면에서 보던 기간. 없으면 이번 주. */
  period?: ResultsPeriod
  /** 성과 화면에서 보던 직접 선택 구간. 있으면 구간 쿼리만 쓴다. */
  range?: ResultsRange | null
}) {
  const workspaceId = useWorkspaceId()
  const active = useMobileR2Active()

  if (!active) {
    return <ResultsView initialMetricId={metricId} />
  }
  return <R2ResultsDrilldown workspaceId={workspaceId} metricId={metricId} period={period} range={range} />
}
