'use client'

import { useEffect, useState } from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { MobileResultsView, resultsScreenConfig, type ResultsViewSnapshot } from './results-view'
import type { KpiId } from './results-model'
import { boundedMobileRead } from '@/features/mobile-shell/bounded-mobile-read'
import { DEFAULT_RESULTS_PERIOD, resultsPeriodSearch, type ResultsPeriod, type ResultsRange } from './results-period'
import { failedResultsSnapshot, isWeeklyReport, toResultsSnapshot } from './server/results-snapshot'

/**
 * M20 성과 — R2 셸 배선(ANI-1771, 플래그 뒤).
 * 기존 GET /api/workspaces/:id/reports/weekly 읽기만 재사용하며 새 API·쓰기 경로를 만들지 않는다.
 * 기간도 같은 읽기 API 의 `?period=previous` 하나로만 바꾼다(ANI-1706).
 * 응답은 no-store 로 받고 브라우저 저장소에 남기지 않는다.
 */
export function R2Results(props: { workspaceId: string; initialPeriod?: ResultsPeriod; initialRange?: ResultsRange | null }) {
  return <R2ResultsContent key={props.workspaceId} {...props} />
}

function R2ResultsContent({
  workspaceId,
  initialPeriod = DEFAULT_RESULTS_PERIOD,
  initialRange = null,
}: {
  workspaceId: string
  /** 드릴다운에서 '뒤로'로 돌아올 때 보던 기간을 그대로 복원한다. */
  initialPeriod?: ResultsPeriod
  /** 주소(`?start=&end=`)에서 복원한 직접 선택 구간. 형식이 깨진 값은 진입점이 이미 버렸다. */
  initialRange?: ResultsRange | null
}) {
  const [period, setPeriod] = useState<ResultsPeriod>(initialPeriod)
  const [range, setRange] = useState<ResultsRange | null>(initialRange)
  const [rangeRejected, setRangeRejected] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [snapshot, setSnapshot] = useState<ResultsViewSnapshot>(() => ({
    ...failedResultsSnapshot(),
    loadState: 'loading',
  }))
  // effect 의존성은 객체가 아니라 문자열 두 개로 둔다(같은 값으로 새 객체를 만들어도 재조회하지 않는다).
  const rangeStart = range?.start ?? null
  const rangeEnd = range?.end ?? null

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const apply = (next: ResultsViewSnapshot) => { if (!cancelled) setSnapshot(next) }
    const rangeQuery = rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null
    boundedMobileRead(`/api/workspaces/${encodeURIComponent(workspaceId)}/reports/weekly${resultsPeriodSearch(period, rangeQuery)}`, async res => {
      // 응답 해석 중에는 상태를 바꾸지 않는다. 시간 초과 뒤 도착한 본문은 적용하지 않는다.
      if (!res.ok) return { snapshot: failedResultsSnapshot(), rejected: res.status === 400 }
      const payload: unknown = await res.json().catch(() => null)
      return { snapshot: isWeeklyReport(payload) ? toResultsSnapshot(payload, workspaceId) : failedResultsSnapshot(), rejected: false }
    }, controller.signal)
      .then(result => {
        if (!cancelled) { setSnapshot(result.snapshot); setRangeRejected(result.rejected) }
      })
      .catch(() => apply(failedResultsSnapshot()))
    return () => { cancelled = true; controller.abort() }
  }, [workspaceId, period, rangeStart, rangeEnd, refreshKey])

  // 기간이 바뀌면 이전 기간의 숫자를 새 기간 라벨 아래 잠깐이라도 그리지 않는다.
  // 주소도 같이 옮겨 새로고침·탭 왕복 후에도 보던 기간이 유지되게 한다(드릴다운을 열지 않아도).
  const changePeriod = (next: ResultsPeriod) => {
    // 직접 선택이 켜져 있으면 같은 프리셋을 눌러도 구간을 닫아야 한다.
    if (next === period && range === null) return
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}${resultsPeriodSearch(next, null)}`)
    }
    setSnapshot({ ...failedResultsSnapshot(), loadState: 'loading' })
    setRangeRejected(false)
    setRange(null)
    setPeriod(next)
  }

  // 직접 선택 구간도 같은 읽기 API 의 `?start=&end=` 로만 넘긴다. 판정은 서버가 한다.
  const changeRange = (next: ResultsRange) => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}${resultsPeriodSearch(period, next)}`)
    }
    setSnapshot({ ...failedResultsSnapshot(), loadState: 'loading' })
    setRangeRejected(false)
    setRange(next)
  }

  // 지표 카드 → 근거 드릴다운. `:id` 는 지표 키다(리포트 보고서 id 가 아니다).
  // 보던 기간을 들고 가야 상세의 숫자와 목록의 기간이 어긋나지 않는다.
  const metricHref = (id: KpiId) => `/app/results/${id}${resultsPeriodSearch(period, range)}`

  const { mode, title } = resultsScreenConfig()
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title}>
        <MobileResultsView
          snapshot={snapshot}
          kpiHref={metricHref}
          period={period}
          onPeriodChange={changePeriod}
          range={range}
          onRangeChange={changeRange}
          rangeRejected={rangeRejected}
          onRetry={() => {
            setSnapshot({ ...failedResultsSnapshot(), loadState: 'loading' })
            setRangeRejected(false)
            setRefreshKey(value => value + 1)
          }}
        />
      </ShellScreen>
    </MobileAppShell>
  )
}
