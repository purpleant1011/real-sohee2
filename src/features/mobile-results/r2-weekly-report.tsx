'use client'

import { useEffect, useState } from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { MobileResultsView, weeklyReportScreenConfig, type ResultsViewSnapshot } from './results-view'
import { failedResultsSnapshot, isWeeklyReport, toResultsSnapshot } from './server/results-snapshot'

/**
 * M20 모바일 주간 CEO 보고 — R2 셸 배선(플래그 ON · 767px 이하 · workspace allowlist 에서만).
 * 성과 화면과 **같은 읽기 API·같은 fail-closed 규칙**을 쓴다. 새 API·쓰기 경로를 만들지 않는다.
 * 기간 선택은 성과 화면(ANI-1706)에만 두고, 이 화면은 서버가 돌려준 기간만 말한다.
 * PC(/app/reports)는 이번 주만 보여 준다 — 지난주 비교가 없다는 점은 COVERAGE.md 에 기록된 알려진 차이다.
 */
export function R2WeeklyReport({ workspaceId }: { workspaceId: string }) {
  const [snapshot, setSnapshot] = useState<ResultsViewSnapshot>(() => ({
    ...failedResultsSnapshot(),
    loadState: 'loading',
  }))

  useEffect(() => {
    let cancelled = false
    const apply = (next: ResultsViewSnapshot) => { if (!cancelled) setSnapshot(next) }
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/reports/weekly`, { cache: 'no-store' })
      .then(async res => {
        if (!res.ok) { apply(failedResultsSnapshot()); return }
        const payload: unknown = await res.json().catch(() => null)
        apply(isWeeklyReport(payload) ? toResultsSnapshot(payload, workspaceId) : failedResultsSnapshot())
      })
      .catch(() => apply(failedResultsSnapshot()))
    return () => { cancelled = true }
  }, [workspaceId])

  const { mode, title } = weeklyReportScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title}>
        <MobileResultsView snapshot={snapshot} heading="주간 보고" />
      </ShellScreen>
    </MobileAppShell>
  )
}
