'use client'

import { useEffect, useState } from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { evidenceRecordListSnapshot } from './evidence-record-list-state'
import { EvidenceRecordListView } from './evidence-record-list-view'
import { DEFAULT_RESULTS_PERIOD, resultsPeriodSearch, type ResultsPeriod } from './results-period'
import { KPI_LABEL } from './results-model'
import { evidenceRecordBoundary, type EvidenceRecordBoundary } from './server/evidence-record-boundary'
import { isEvidenceRecordMetric } from './server/evidence-record-dto'

/** 기기가 네트워크에 붙어 있는지. 판정할 수 없는 환경(SSR·구형 브라우저)은 오프라인으로 단정하지 않는다. */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * M20 근거 기록 목록 — R2 셸 배선(플래그 뒤, ANI-1783 2단계).
 *
 * 새 읽기 경로(`/api/workspaces/:id/results/:metric/evidence`)만 쓴다. 기존 주간 리포트 응답과
 * 드릴다운 화면은 건드리지 않는다. 401/403/404·오프라인·5xx·본문 파싱 실패는 경계가 각각 다른
 * 결론으로 닫고, 어느 것도 0건이 되지 않는다.
 */
export function R2EvidenceRecordList({
  workspaceId,
  metricId,
  period = DEFAULT_RESULTS_PERIOD,
}: {
  workspaceId: string
  metricId: string
  period?: ResultsPeriod
}) {
  // 없는 지표 주소는 이름을 지어내지 않고 조회도 하지 않는다.
  const metric = isEvidenceRecordMetric(metricId) ? metricId : null
  const [boundary, setBoundary] = useState<EvidenceRecordBoundary | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    const apply = (next: EvidenceRecordBoundary) => {
      if (!cancelled) setBoundary(next)
    }
    if (!metric) return () => { cancelled = true }

    const load = async () => {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/results/${encodeURIComponent(metric)}/evidence${resultsPeriodSearch(period)}`,
        { cache: 'no-store' },
      )
      // 401/403 은 DTO 가 아니다. 상태 코드만 경계에 넘긴다.
      const payload: unknown = res.ok ? await res.json().catch(() => null) : null
      apply(evidenceRecordBoundary({ workspaceId, metric, status: res.status, payload }))
    }
    // 네트워크가 끊긴 실패는 '확인 실패'와 다르다.
    load().catch(() => apply(evidenceRecordBoundary({
      workspaceId,
      metric,
      status: null,
      payload: null,
      offline: isOffline(),
    })))
    return () => { cancelled = true }
  }, [workspaceId, metric, period, reloadToken])

  const retry = () => {
    setBoundary(null)
    setReloadToken((token) => token + 1)
  }

  const snapshot = metric
    ? evidenceRecordListSnapshot({ boundary, metricLabel: KPI_LABEL[metric] })
    : evidenceRecordListSnapshot({ boundary, metricLabel: '성과' })
  const missing = metric === null

  return (
    <MobileAppShell>
      <ShellScreen
        mode="DETAIL"
        title="근거 기록"
        backHref={metric ? `/app/results/${metric}${resultsPeriodSearch(period)}` : `/app/results${resultsPeriodSearch(period)}`}
      >
        <EvidenceRecordListView
          snapshot={missing ? missingSnapshot(snapshot) : snapshot}
          onRetry={retry}
        />
      </ShellScreen>
    </MobileAppShell>
  )
}

/**
 * 없는 지표 주소. 서버 조회 결과가 아니라 경로 판정이므로 '0건'이 아니라 '찾지 못함'으로 닫는다.
 */
function missingSnapshot(snapshot: ReturnType<typeof evidenceRecordListSnapshot>) {
  return {
    ...snapshot,
    kind: 'missing' as const,
    notice: null,
    records: [],
    totalCount: null,
    countText: null,
    omittedText: null,
    showRecords: false,
    chip: null,
  }
}
